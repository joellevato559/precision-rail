const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { haversine } = require('../services/miles');

const router = express.Router();

/**
 * Demo-only: generate a short path of GPS points for a vehicle.
 * Replace with real tracker webhooks via /ingest/positions when vendor is chosen.
 */
router.post('/trip', authRequired, requireRoles('manager', 'admin', 'driver', 'supervisor'), async (req, res) => {
  try {
    const { vehicleId, points: nPoints = 8 } = req.body || {};
    if (!vehicleId) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'vehicleId required' } });
    }

    const { rows: vehicles } = await query(
      `SELECT v.*, t.device_imei FROM vehicles v
       LEFT JOIN trackers t ON t.vehicle_id = v.id AND t.active
       WHERE v.id = $1 AND v.company_id = $2`,
      [vehicleId, req.user.companyId]
    );
    const vehicle = vehicles[0];
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
    }

    const { rows: last } = await query(
      `SELECT lat, lng, odometer_mi FROM positions WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [vehicleId]
    );

    let lat = last[0]?.lat ?? 32.7767;
    let lng = last[0]?.lng ?? -96.797;
    let odo = Number(last[0]?.odometer_mi ?? vehicle.current_odometer_mi ?? 0);
    const inserted = [];

    for (let i = 0; i < Math.min(Number(nPoints) || 8, 30); i++) {
      const prevLat = lat;
      const prevLng = lng;
      lat += 0.002 + Math.random() * 0.001;
      lng += 0.0015 + Math.random() * 0.001;
      const seg = haversine(prevLat, prevLng, lat, lng);
      odo += seg;
      const speed = 25 + Math.random() * 35;
      const recordedAt = new Date(Date.now() - (nPoints - i) * 60000).toISOString();

      await query(
        `INSERT INTO positions
          (company_id, vehicle_id, recorded_at, lat, lng, speed_mph, odometer_mi, ignition_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [req.user.companyId, vehicleId, recordedAt, lat, lng, speed, odo]
      );
      inserted.push({ lat, lng, speed, odo, recordedAt });
    }

    await query(
      `UPDATE vehicles SET current_odometer_mi = $1, updated_at = now() WHERE id = $2`,
      [odo, vehicleId]
    );
    if (vehicle.device_imei) {
      await query(`UPDATE trackers SET last_seen_at = now() WHERE device_imei = $1`, [vehicle.device_imei]);
    }

    res.json({
      vehicleId,
      pointsInserted: inserted.length,
      endOdometer: odo,
      note: 'Simulator only — swap for vendor webhook on /ingest/positions'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Simulate trip failed' } });
  }
});

module.exports = router;
