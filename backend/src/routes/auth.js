const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');
const { writeAudit } = require('../services/audit');

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

module.exports = router;
