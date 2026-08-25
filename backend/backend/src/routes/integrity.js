const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { scanVehicleFuelIntegrity, scanCompanyIntegrity } = require('../services/integrity');
const { writeAudit } = require('../services/audit');
const { sendToRoles, notifyAsync } = require('../services/notify');

const router = express.Router();

router.get('/flags', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const { rows } = await query(
      `SELECT f.*, v.code AS vehicle_code
       FROM anomaly_flags f
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       WHERE f.company_id = $1 AND f.status = $2
       ORDER BY
         CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         f.created_at DESC
       LIMIT 100`,
      [req.user.companyId, status]
    );
    res.json({ flags: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load flags' } });
  }
});

router.post('/scan', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const vehicleId = req.body?.vehicleId;
    let created;
    if (vehicleId) {
      const r = await scanVehicleFuelIntegrity(req.user.companyId, vehicleId);
      created = r.alerts;
    } else {
      created = await scanCompanyIntegrity(req.user.companyId);
    }
    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'integrity_scan',
      detail: `Created ${created.length} flag(s)`
    });

    const critical = (created || []).filter((f) => f.severity === 'critical');
    if (critical.length) {
      notifyAsync(() =>
        sendToRoles(req.user.companyId, ['manager', 'admin'], {
          title: 'Fuel integrity alert',
          body: `${critical.length} critical flag(s) — ${critical[0].title}`,
          data: { type: 'integrity', count: critical.length }
        })
      );
    }

    res.json({ created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Scan failed' } });
  }
});

router.post('/flags/:id/dismiss', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE anomaly_flags SET status = 'dismissed', resolved_at = now()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [req.params.id, req.user.companyId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Flag not found' } });
    }
    res.json({ flag: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Dismiss failed' } });
  }
});

module.exports = router;
