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


/** List vehicles */
router.get('/vehicles', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, code, name, plate, current_odometer_mi, baseline_odometer_mi, active, default_jurisdiction
       FROM vehicles WHERE company_id = $1 ORDER BY code`,
      [req.user.companyId]
    );
    res.json({ vehicles: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to list vehicles' } });
  }
});

/** Add vehicle */
router.post('/vehicles', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { code, name, plate, odometerMi, jurisdiction } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'code required (e.g. TRUCK-03)' } });
    }
    const odo = odometerMi != null ? Number(odometerMi) : 0;
    const { rows } = await query(
      `INSERT INTO vehicles (
         company_id, code, name, plate, baseline_odometer_mi, current_odometer_mi, default_jurisdiction
       ) VALUES ($1, $2, $3, $4, $5, $5, $6)
       RETURNING id, code, name, plate, current_odometer_mi, active`,
      [
        req.user.companyId,
        String(code).trim().toUpperCase(),
        name ? String(name).trim() : null,
        plate ? String(plate).trim() : null,
        odo,
        jurisdiction ? String(jurisdiction).slice(0, 2).toUpperCase() : null
      ]
    );
    res.status(201).json({ vehicle: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { code: 'EXISTS', message: 'Vehicle code already exists' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to create vehicle' } });
  }
});

module.exports = router;

