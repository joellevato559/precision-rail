const express = require('express');
const { query } = require('../db');
const { authRequired } = require('../middleware/auth');
const { getDriverForUser } = require('../services/drivers');
const { calcHosMeters, getOpenDuty } = require('../services/hos');
const { listAlerts } = require('../services/maintenance');

const router = express.Router();

router.get('/today', authRequired, async (req, res) => {
  try {
    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dayIso = startOfDay.toISOString();

    const { rows: workRows } = await query(
      `SELECT COALESCE(SUM(hours),0)::float AS hours,
              COALESCE(SUM(odo_miles),0)::float AS odo_miles,
              COALESCE(SUM(gps_miles),0)::float AS gps_miles
       FROM work_sessions
       WHERE driver_id = $1 AND clock_in >= $2 AND status != 'open'`,
      [driver.id, dayIso]
    );
    const { rows: openWork } = await query(
      `SELECT ws.*, v.current_odometer_mi AS vehicle_odo
       FROM work_sessions ws
       LEFT JOIN vehicles v ON v.id = ws.vehicle_id
       WHERE ws.driver_id = $1 AND ws.status = 'open'
       ORDER BY ws.clock_in DESC LIMIT 1`,
      [driver.id]
    );
    let workHours = Number(workRows[0]?.hours || 0);
    // Miles while clocked in — tracked for ops only; NOT paid as drive time
    let workMilesOdo = Number(workRows[0]?.odo_miles || 0);
    let workMilesGps = Number(workRows[0]?.gps_miles || 0);
    if (openWork[0]) {
      workHours += Math.max(0, (Date.now() - new Date(openWork[0].clock_in)) / 3600000);
      const startO = openWork[0].start_odo_mi != null ? Number(openWork[0].start_odo_mi) : null;
      const curO = openWork[0].vehicle_odo != null ? Number(openWork[0].vehicle_odo) : null;
      if (startO != null && curO != null) {
        workMilesOdo += Math.max(0, curO - startO);
      }
    }

    const { rows: driveRows } = await query(
      `SELECT COALESCE(SUM(hours),0)::float AS hours, COALESCE(SUM(gps_miles),0)::float AS miles
       FROM drive_segments
       WHERE driver_id = $1 AND started_at >= $2 AND ended_at IS NOT NULL`,
      [driver.id, dayIso]
    );
    const { rows: openDrive } = await query(
      `SELECT ds.*, v.code AS vehicle_code, v.current_odometer_mi
       FROM drive_segments ds
       JOIN vehicles v ON v.id = ds.vehicle_id
       WHERE ds.driver_id = $1 AND ds.ended_at IS NULL
       ORDER BY ds.started_at DESC LIMIT 1`,
      [driver.id]
    );
    let driveHours = Number(driveRows[0]?.hours || 0);
    let driveMiles = Number(driveRows[0]?.miles || 0);
    if (openDrive[0]) {
      driveHours += Math.max(0, (Date.now() - new Date(openDrive[0].started_at)) / 3600000);
      const so = openDrive[0].start_odo_mi != null ? Number(openDrive[0].start_odo_mi) : null;
      const co = openDrive[0].current_odometer_mi != null ? Number(openDrive[0].current_odometer_mi) : null;
      if (so != null && co != null) driveMiles += Math.max(0, co - so);
    }

    const hos = await calcHosMeters(driver.id);
    const duty = await getOpenDuty(driver.id);

    const { rows: vehicles } = await query(
      `SELECT id, code, name, current_odometer_mi, default_jurisdiction
       FROM vehicles WHERE company_id = $1 AND active = true ORDER BY code`,
      [req.user.companyId]
    );

    const maintAlerts = await listAlerts(req.user.companyId);
    res.json({
      driver: { id: driver.id, employeeCode: driver.employee_code },
      workHours,
      // Miles while clocked in (may include driving or idling). Tracked only — regular work rate, NOT drive pay.
      workMilesToday: workMilesOdo,
      workMilesGpsToday: workMilesGps,
      workMilesNote: 'Miles while clocked in are tracked for operations. They are not paid as drive time. Drive pay applies only to Start Drive / End Drive segments.',
      driveHours,
      // Paid drive miles only (explicit Start Drive segments)
      driveMilesToday: driveMiles,
      openSession: openWork[0] || null,
      openDrive: openDrive[0] || null,
      duty,
      hos,
      vehicles,
      maintenanceAlerts: maintAlerts.filter(a => a.status === 'overdue' || a.status === 'due_soon').slice(0, 10)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load today summary' } });
  }
});

module.exports = router;
