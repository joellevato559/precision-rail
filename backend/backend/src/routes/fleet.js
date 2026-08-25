const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');

const router = express.Router();

/**
 * Live fleet snapshot for manager map + cards.
 */
router.get('/live', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { rows } = await query(
      `SELECT v.id, v.code, v.name, v.current_odometer_mi, v.active,
              t.device_imei, t.last_seen_at,
              p.lat, p.lng, p.speed_mph, p.recorded_at AS last_position_at,
              ds.id AS open_drive_id, ds.started_at AS drive_started_at,
              u.name AS driver_name,
              dstat.status AS duty_status
       FROM vehicles v
       LEFT JOIN trackers t ON t.vehicle_id = v.id AND t.active = true
       LEFT JOIN LATERAL (
         SELECT lat, lng, speed_mph, recorded_at
         FROM positions
         WHERE vehicle_id = v.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT id, started_at, driver_id
         FROM drive_segments
         WHERE vehicle_id = v.id AND ended_at IS NULL
         ORDER BY started_at DESC
         LIMIT 1
       ) ds ON true
       LEFT JOIN drivers dr ON dr.id = ds.driver_id
       LEFT JOIN users u ON u.id = dr.user_id
       LEFT JOIN LATERAL (
         SELECT status FROM duty_status_events
         WHERE driver_id = ds.driver_id AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1
       ) dstat ON true
       WHERE v.company_id = $1 AND v.active = true
       ORDER BY v.code`,
      [companyId]
    );
    res.json({ vehicles: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load fleet' } });
  }
});

module.exports = router;
