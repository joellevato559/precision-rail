const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');
const { writeAudit } = require('../services/audit');
const { sendEmail, resetEmailContent, PUBLIC_APP_URL } = require('../services/email');

const RESET_MINUTES = Number(process.env.PASSWORD_RESET_MINUTES || 60);

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'email and password required' } });
    }

    const { rows } = await query(
      `SELECT id, company_id, email, password_hash, name, role, active
       FROM users WHERE email = $1 LIMIT 1`,
      [String(email).toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.active) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    const accessToken = jwt.sign(
      { sub: user.id, companyId: user.company_id, role: user.role, name: user.name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    await writeAudit({
      companyId: user.company_id,
      actorUserId: user.id,
      actorName: user.name,
      action: 'login',
      detail: 'User signed in'
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.company_id
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Login failed' } });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.name, u.role, u.company_id,
              d.id AS driver_id, d.employee_code, d.license_expires_on, d.medical_expires_on
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id
       WHERE u.id = $1`,
      [req.user.sub]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load profile' } });
  }
});




/** Request password reset email — always returns ok (no email enumeration) */
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'email required' } });
    }

    const { rows } = await query(
      `SELECT id, company_id, email, name, active FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    const user = rows[0];

    if (user && user.active) {
      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      const expires = new Date(Date.now() + RESET_MINUTES * 60 * 1000);

      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expires]
      );

      const base =
        (req.body && req.body.resetBaseUrl) ||
        PUBLIC_APP_URL ||
        process.env.MANAGER_APP_URL ||
        process.env.DRIVER_APP_URL ||
        '';
      const resetUrl = base
        ? `${String(base).replace(/\/$/, '')}/?resetToken=${raw}`
        : `Use token with POST /api/v1/auth/reset-password: ${raw}`;

      try {
        const content = resetEmailContent({
          name: user.name,
          resetUrl,
          minutes: RESET_MINUTES
        });
        await sendEmail({ to: user.email, ...content });
      } catch (mailErr) {
        console.error('[forgot-password] email failed', mailErr);
        // Still return ok — token is valid; ops can read console logs when EMAIL_PROVIDER=console
      }

      await writeAudit({
        companyId: user.company_id,
        actorUserId: user.id,
        actorName: user.name,
        action: 'password.forgot',
        detail: 'Password reset requested'
      });
    }

    res.json({
      ok: true,
      message: 'If that email is registered, a reset link was sent.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Request failed' } });
  }
});

/** Complete password reset with token from email */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'token and password required' }
      });
    }
    if (String(password).length < 8) {
      return res.status(400).json({
        error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' }
      });
    }

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const { rows } = await query(
      `SELECT t.id AS token_id, t.user_id, t.expires_at, t.used_at,
              u.company_id, u.email, u.name, u.active
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [tokenHash]
    );
    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date() || !row.active) {
      return res.status(400).json({
        error: { code: 'INVALID_TOKEN', message: 'Reset link is invalid or expired' }
      });
    }

    const hash = await bcrypt.hash(String(password), 10);
    await query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [
      hash,
      row.user_id
    ]);
    await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [row.token_id]);
    // Invalidate other open tokens for this user
    await query(
      `UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [row.user_id]
    );

    await writeAudit({
      companyId: row.company_id,
      actorUserId: row.user_id,
      actorName: row.name,
      action: 'password.reset',
      detail: 'Password reset completed via email token'
    });

    res.json({ ok: true, message: 'Password updated. You can sign in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Reset failed' } });
  }
});


module.exports = router;
