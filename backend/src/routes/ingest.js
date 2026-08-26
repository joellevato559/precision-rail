const express = require('express');
const { query } = require('../db');
const { maybeAutoEndIdleDrive } = require('../services/driveClose');

const router = express.Router();

/**
 * Tracker position ingest.
 * Auth: X-Api-Key must match companies.ingest_api_key_hash (store hashed keys in production).
 * MVP: accepts plain key compared to env COMPANY_INGEST_KEY or row lookup — replace with hash verify.
 */
router.post('/positions', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'X-Api-Key required' } });
    }

    // Production: look up company by hashed key. Scaffold accepts body.companyId + shared env key.
    const expected = process.env.COMPANY_INGEST_KEY;
    if (expected && apiKey !== expected) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    }

    const body = req.body || {};
    const points = Array.isArray(body) ? body : [body];
    let inserted = 0;

    for (const p of points) {
      const imei = p.deviceImei || p.imei;
      if (!imei || p.lat == null || p.lng == null || !p.recordedAt) continue;

      const { rows: trackers } = await query(
        `SELECT t.vehicle_id, t.company_id, v.current_odometer_mi
         FROM trackers t
         JOIN vehicles v ON v.id = t.vehicle_id
         WHERE t.device_imei = $1 AND t.active = true
         LIMIT 1`,
        [String(imei)]
      );
      const tracker = trackers[0];
      if (!tracker) continue;

      await query(
        `INSERT INTO positions
          (company_id, vehicle_id, recorded_at, lat, lng, speed_mph, odometer_mi, ignition_on, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tracker.company_id,
          tracker.vehicle_id,
          p.recordedAt,
          p.lat,
          p.lng,
          p.speedMph ?? p.speed_mph ?? null,
          p.odometerMi ?? p.odometer_mi ?? null,
          p.ignitionOn ?? p.ignition_on ?? null,
          JSON.stringify(p)
        ]
      );

      await query(
        `UPDATE trackers SET last_seen_at = $1 WHERE device_imei = $2`,
        [p.recordedAt, String(imei)]
      );

      if (p.odometerMi != null) {
        await query(
          `UPDATE vehicles SET current_odometer_mi = GREATEST(current_odometer_mi, $1), updated_at = now()
           WHERE id = $2`,
          [p.odometerMi, tracker.vehicle_id]
        );
      }

      // Auto-end paid drive if vehicle has been idle long enough (forgot End Drive)
      try {
        await maybeAutoEndIdleDrive(tracker.vehicle_id, {
          currentOdo: p.odometerMi ?? p.odometer_mi ?? null
        });
      } catch (e) {
        console.error('auto-end idle drive', e.message);
      }

      inserted += 1;
    }

    res.json({ inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Ingest failed' } });
  }
});

module.exports = router;
