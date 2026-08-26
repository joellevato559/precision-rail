const express = require('express');
const { withTransaction, query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { getDriverForUser, getVehicleInCompany } = require('../services/drivers');
const { setDutyStatus, hoursBetween } = require('../services/hos');
const { writeAudit } = require('../services/audit');
const { gpsMilesInWindow } = require('../services/miles');
const { closeOpenDriveForDriver } = require('../services/driveClose');

const router = express.Router();

router.post('/clock-in', authRequired, requireRoles('driver', 'supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { vehicleId } = req.body || {};
    if (!vehicleId) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'vehicleId required' } });
    }

    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile for this user' } });
    }
    const vehicle = await getVehicleInCompany(vehicleId, req.user.companyId);
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
    }

    const { rows: open } = await query(
      `SELECT id FROM work_sessions
       WHERE driver_id = $1 AND status = 'open' LIMIT 1`,
      [driver.id]
    );
    if (open.length) {
      return res.status(409).json({ error: { code: 'ALREADY_CLOCKED_IN', message: 'Already clocked in' } });
    }

    // Stale paid drive must not carry into a new clock-in
    await closeOpenDriveForDriver(driver.id, {
      endOdo: vehicle.current_odometer_mi,
      reason: 'clock-in',
      actorUserId: req.user.sub,
      actorName: req.user.name,
      setDutyTo: null
    });

    const session = await withTransaction(async (client) => {
      const now = new Date().toISOString();
      const { rows } = await client.query(
        `INSERT INTO work_sessions
          (company_id, vehicle_id, driver_id, clock_in, start_odo_mi, status)
         VALUES ($1,$2,$3,$4,$5,'open')
         RETURNING *`,
        [req.user.companyId, vehicleId, driver.id, now, vehicle.current_odometer_mi]
      );
      await setDutyStatus(client, {
        companyId: req.user.companyId,
        driverId: driver.id,
        vehicleId,
        status: 'onduty',
        source: 'clock_in'
      });
      return rows[0];
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'clock_in',
      entityType: 'work_session',
      entityId: session.id,
      vehicleId,
      detail: `${req.user.name} clocked in`
    });

    res.status(201).json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Clock-in failed' } });
  }
});

router.post('/clock-out', authRequired, requireRoles('driver', 'supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }

    let sessionRow;
    if (sessionId) {
      const { rows } = await query(
        `SELECT * FROM work_sessions WHERE id = $1 AND driver_id = $2 AND status = 'open'`,
        [sessionId, driver.id]
      );
      sessionRow = rows[0];
    } else {
      const { rows } = await query(
        `SELECT * FROM work_sessions WHERE driver_id = $1 AND status = 'open'
         ORDER BY clock_in DESC LIMIT 1`,
        [driver.id]
      );
      sessionRow = rows[0];
    }
    if (!sessionRow) {
      return res.status(404).json({ error: { code: 'NO_OPEN_SESSION', message: 'No open work session' } });
    }

    const vehicle = await getVehicleInCompany(sessionRow.vehicle_id, req.user.companyId);
    const now = new Date().toISOString();
    const hours = hoursBetween(sessionRow.clock_in, now);
    const endOdo = vehicle ? Number(vehicle.current_odometer_mi) : null;
    const startOdo = sessionRow.start_odo_mi != null ? Number(sessionRow.start_odo_mi) : null;
    // Miles while clocked in (idling or moving) — tracked for ops, NOT paid as drive time
    const odoMiles = startOdo != null && endOdo != null ? Math.max(0, endOdo - startOdo) : null;
    let gpsMiles = null;
    try {
      gpsMiles = await gpsMilesInWindow(sessionRow.vehicle_id, sessionRow.clock_in, now);
    } catch (_) { /* positions optional */ }

    // Paid drive still open → close at clock-out (drive rate stops)
    await closeOpenDriveForDriver(driver.id, {
      endOdo,
      reason: 'clock-out',
      actorUserId: req.user.sub,
      actorName: req.user.name,
      setDutyTo: null
    });

    const session = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE work_sessions SET
           clock_out = $1,
           hours = $2,
           end_odo_mi = $3,
           odo_miles = $4,
           gps_miles = $5,
           status = 'pending'
         WHERE id = $6
         RETURNING *`,
        [now, hours, endOdo, odoMiles, gpsMiles, sessionRow.id]
      );
      await setDutyStatus(client, {
        companyId: req.user.companyId,
        driverId: driver.id,
        vehicleId: sessionRow.vehicle_id,
        status: 'off',
        source: 'clock_out'
      });
      return rows[0];
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'clock_out',
      entityType: 'work_session',
      entityId: session.id,
      vehicleId: session.vehicle_id,
      detail: `${req.user.name} clocked out · ${Number(hours).toFixed(2)} h · ${odoMiles != null ? odoMiles.toFixed(1) + ' mi tracked (not drive pay)' : 'no odo'}`
    });

    res.json({ session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Clock-out failed' } });
  }
});

module.exports = router;
