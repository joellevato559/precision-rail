const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { sendToUser, sendToRoles, PROVIDER } = require('../services/notify');
const { writeAudit } = require('../services/audit');

const router = express.Router();

/**
 * Register or refresh a device push token (mobile app or web push endpoint).
 * Body: { token, platform: 'ios'|'android'|'web', deviceLabel? }
 */
router.post('/register-device', authRequired, async (req, res) => {
  try {
    const { token, platform, deviceLabel } = req.body || {};
    if (!token || !['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'token and platform (ios|android|web) required' }
      });
    }

    const { rows } = await query(
      `INSERT INTO device_tokens (company_id, user_id, platform, token, device_label, active, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,true,now())
       ON CONFLICT (user_id, token) DO UPDATE SET
         platform = EXCLUDED.platform,
         device_label = COALESCE(EXCLUDED.device_label, device_tokens.device_label),
         active = true,
         last_seen_at = now()
       RETURNING id, platform, device_label, created_at, last_seen_at`,
      [req.user.companyId, req.user.sub, platform, String(token), deviceLabel || null]
    );

    res.status(201).json({ device: rows[0], provider: PROVIDER });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to register device' } });
  }
});

/** Unregister current token (logout / disable push) */
router.post('/unregister-device', authRequired, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'token required' } });
    }
    await query(
      `UPDATE device_tokens SET active = false
       WHERE user_id = $1 AND token = $2`,
      [req.user.sub, String(token)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to unregister' } });
  }
});

/** List my devices */
router.get('/devices', authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, platform, device_label, active, last_seen_at, created_at
       FROM device_tokens WHERE user_id = $1
       ORDER BY last_seen_at DESC`,
      [req.user.sub]
    );
    res.json({ devices: rows, provider: PROVIDER });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to list devices' } });
  }
});

/** Recent notifications for current user */
router.get('/history', authRequired, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, title, body, data, status, provider, created_at
       FROM notification_log
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.sub]
    );
    res.json({ notifications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load history' } });
  }
});

/** Manager: send a test push to yourself or roles */
router.post('/test', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const title = req.body?.title || 'Precision Rail test';
    const body = req.body?.body || 'Push notifications are working.';
    const result = await sendToUser(req.user.sub, req.user.companyId, {
      title,
      body,
      data: { type: 'test' }
    });
    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'notify_test',
      detail: `Test push · sent=${result.sent}`
    });
    res.json({ result, provider: PROVIDER });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Test failed' } });
  }
});

/** Manager: broadcast to drivers (ops message) */
router.post('/broadcast', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { title, body, roles } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'title and body required' } });
    }
    const targetRoles = Array.isArray(roles) && roles.length ? roles : ['driver'];
    const results = await sendToRoles(req.user.companyId, targetRoles, {
      title,
      body,
      data: { type: 'broadcast' }
    });
    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'notify_broadcast',
      detail: `${title} → ${targetRoles.join(',')}`
    });
    res.json({ results, provider: PROVIDER });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Broadcast failed' } });
  }
});

module.exports = router;
