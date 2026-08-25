const express = require('express');
const { withTransaction, query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { getDriverForUser, getVehicleInCompany, getCompany } = require('../services/drivers');
const { setDutyStatus, hoursBetween, hasValidPreTrip, calcHosMeters } = require('../services/hos');
const { gpsMilesInWindow } = require('../services/miles');
const { writeAudit } = require('../services/audit');
const { sendToUser, notifyAsync } = require('../services/notify');

const router = express.Router();

router.post('/start', authRequired, requireRoles('driver', 'supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { vehicleId, jurisdiction, force } = req.body || {};
    if (!vehicleId) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'vehicleId required' } });
    }

    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }
    const vehicle = await getVehicleInCompany(vehicleId, req.user.companyId);
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
    }

    const { rows: openDrive } = await query(
      `SELECT id FROM drive_segments WHERE vehicle_id = $1 AND ended_at IS NULL LIMIT 1`,
      [vehicleId]
    );
    if (openDrive.length) {
      return res.status(409).json({ error: { code: 'DRIVE_ACTIVE', message: 'Drive already in progress on this vehicle' } });
    }

    const company = await getCompany(req.user.companyId);
    if (company?.require_pretrip) {
      const ok = await hasValidPreTrip(vehicleId, company.pretrip_max_age_hours || 12);
      if (!ok && !(force && company.allow_pretrip_override)) {
        return res.status(409).json({
          error: {
            code: 'PRETRIP_REQUIRED',
            message: 'Valid pre-trip inspection required before starting drive'
          }
        });
      }
    }

    const hos = await calcHosMeters(driver.id);
    const hosBlocked = hos.driveToday >= 11 || hos.onDutyToday >= 14 || hos.eightDay >= 70;
    if (hosBlocked && !force) {
      notifyAsync(() =>
        sendToUser(req.user.sub, req.user.companyId, {
          title: 'HOS limit reached',
          body: (hos.warnings && hos.warnings[0] && hos.warnings[0].text) || 'Driving or on-duty limit reached.',
          data: { type: 'hos_limit' }
        })
      );
      return res.status(409).json({
        error: {
          code: 'HOS_LIMIT',
          message: 'HOS limit reached',
          warnings: hos.warnings
        }
      });
    }

    const juris = (jurisdiction || vehicle.default_jurisdiction || company?.default_jurisdiction || 'TX').slice(0, 2).toUpperCase();
    const now = new Date().toISOString();

    const { rows: lastPos } = await query(
      `SELECT lat, lng FROM positions WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [vehicleId]
    );

    const drive = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO drive_segments
          (company_id, vehicle_id, driver_id, started_at, start_odo_mi, start_lat, start_lng, jurisdiction, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open')
         RETURNING *`,
        [
          req.user.companyId,
          vehicleId,
          driver.id,
          now,
          vehicle.current_odometer_mi,
          lastPos[0]?.lat ?? null,
          lastPos[0]?.lng ?? null,
          juris
        ]
      );
      await setDutyStatus(client, {
        companyId: req.user.companyId,
        driverId: driver.id,
        vehicleId,
        status: 'driving',
        source: 'drive_start'
      });
      return rows[0];
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'drive_start',
      entityType: 'drive_segment',
      entityId: drive.id,
      vehicleId,
      detail: `${req.user.name} started drive · ${juris}`
    });

    res.status(201).json({ drive, hos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Start drive failed' } });
  }
});

router.post('/end', authRequired, requireRoles('driver', 'supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { driveId, vehicleId } = req.body || {};
    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }

    let open;
    if (driveId) {
      const { rows } = await query(
        `SELECT * FROM drive_segments WHERE id = $1 AND driver_id = $2 AND ended_at IS NULL`,
        [driveId, driver.id]
      );
      open = rows[0];
    } else {
      const { rows } = await query(
        `SELECT * FROM drive_segments
         WHERE driver_id = $1 AND ended_at IS NULL
         ${vehicleId ? 'AND vehicle_id = $2' : ''}
         ORDER BY started_at DESC LIMIT 1`,
        vehicleId ? [driver.id, vehicleId] : [driver.id]
      );
      open = rows[0];
    }
    if (!open) {
      return res.status(404).json({ error: { code: 'NO_OPEN_DRIVE', message: 'No active drive' } });
    }

    const vehicle = await getVehicleInCompany(open.vehicle_id, req.user.companyId);
    const now = new Date().toISOString();
    const hours = hoursBetween(open.started_at, now);
    const gpsMiles = await gpsMilesInWindow(open.vehicle_id, open.started_at, now);
    const endOdo = vehicle ? Number(vehicle.current_odometer_mi) : null;
    const startOdo = open.start_odo_mi != null ? Number(open.start_odo_mi) : null;
    const odoMiles = startOdo != null && endOdo != null ? Math.max(0, endOdo - startOdo) : gpsMiles;

    const { rows: lastPos } = await query(
      `SELECT lat, lng FROM positions WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [open.vehicle_id]
    );

    const drive = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE drive_segments SET
           ended_at = $1,
           hours = $2,
           gps_miles = $3,
           odo_miles = $4,
           end_odo_mi = $5,
           end_lat = $6,
           end_lng = $7,
           status = 'completed'
         WHERE id = $8
         RETURNING *`,
        [
          now,
          hours,
          Number(gpsMiles.toFixed(3)),
          odoMiles != null ? Number(Number(odoMiles).toFixed(3)) : null,
          endOdo,
          lastPos[0]?.lat ?? null,
          lastPos[0]?.lng ?? null,
          open.id
        ]
      );
      // On Duty only while clocked in; otherwise Off Duty
      const { rows: openWork } = await client.query(
        `SELECT id FROM work_sessions
         WHERE driver_id = $1 AND status = 'open'
         LIMIT 1`,
        [driver.id]
      );
      await setDutyStatus(client, {
        companyId: req.user.companyId,
        driverId: driver.id,
        vehicleId: open.vehicle_id,
        status: openWork.length ? 'onduty' : 'off',
        source: 'drive_end'
      });
      return rows[0];
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'drive_end',
      entityType: 'drive_segment',
      entityId: drive.id,
      vehicleId: drive.vehicle_id,
      detail: `${req.user.name} ended drive · ${Number(hours).toFixed(2)} h · ${Number(gpsMiles).toFixed(1)} mi`
    });

    res.json({ drive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'End drive failed' } });
  }
});

module.exports = router;
