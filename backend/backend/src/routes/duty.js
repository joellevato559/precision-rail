const express = require('express');
const { withTransaction, query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { getDriverForUser } = require('../services/drivers');
const { setDutyStatus, calcHosMeters, HOS_LABELS } = require('../services/hos');
const { writeAudit } = require('../services/audit');
const { closeOpenDriveForDriver } = require('../services/driveClose');

const router = express.Router();
const ALLOWED = ['off', 'sleeper', 'driving', 'onduty'];

router.get('/current', authRequired, async (req, res) => {
  try {
    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }
    const hos = await calcHosMeters(driver.id);
    res.json({ hos, labels: HOS_LABELS });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load duty status' } });
  }
});

router.post('/', authRequired, requireRoles('driver', 'supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { status, vehicleId } = req.body || {};
    if (!ALLOWED.includes(status)) {
      return res.status(400).json({ error: { code: 'INVALID_STATUS', message: 'Invalid duty status' } });
    }
    if (status === 'driving') {
      return res.status(400).json({
        error: { code: 'USE_DRIVE_START', message: 'Use POST /drives/start to enter Driving status' }
      });
    }

    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }

    // On Duty is only valid while clocked in
    if (status === 'onduty') {
      const { rows: openSession } = await query(
        `SELECT id FROM work_sessions WHERE driver_id = $1 AND status = 'open' LIMIT 1`,
        [driver.id]
      );
      if (!openSession.length) {
        return res.status(409).json({
          error: { code: 'MUST_CLOCK_IN', message: 'Clock in before setting On Duty' }
        });
      }
    }

    // Leaving Driving without End Drive → auto-close paid drive
    if (status === 'off' || status === 'sleeper' || status === 'onduty') {
      await closeOpenDriveForDriver(driver.id, {
        reason: `duty-${status}`,
        actorUserId: req.user.sub,
        actorName: req.user.name,
        setDutyTo: null
      });
    }

    const event = await withTransaction(async (client) => {
      return setDutyStatus(client, {
        companyId: req.user.companyId,
        driverId: driver.id,
        vehicleId: vehicleId || null,
        status,
        source: 'user'
      });
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'hos_status',
      entityType: 'duty_status_event',
      entityId: event.id,
      vehicleId: vehicleId || null,
      detail: `Status → ${HOS_LABELS[status]}`
    });

    const hos = await calcHosMeters(driver.id);
    res.json({ event, hos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to set duty status' } });
  }
});

module.exports = router;
