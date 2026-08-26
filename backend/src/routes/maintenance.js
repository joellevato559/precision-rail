const express = require('express');
const { query, withTransaction } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { getVehicleInCompany } = require('../services/drivers');
const {
  listSchedulesWithStatus,
  listAlerts,
  advanceSchedule,
  evaluateSchedule
} = require('../services/maintenance');
const { writeAudit } = require('../services/audit');
const { sendToRoles, notifyAsync } = require('../services/notify');

const router = express.Router();

/** Due / due-soon alerts for manager dashboard */
router.get('/alerts', authRequired, requireRoles('supervisor', 'manager', 'admin', 'driver'), async (req, res) => {
  try {
    const alerts = await listAlerts(req.user.companyId);
    // Drivers only see vehicles they might care about — for MVP all company alerts for managers;
    // drivers get full list filtered lightly (company scoped already)
    res.json({
      alerts,
      summary: {
        overdue: alerts.filter((a) => a.status === 'overdue').length,
        dueSoon: alerts.filter((a) => a.status === 'due_soon').length
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load maintenance alerts' } });
  }
});


/** Evaluate due items and push managers (and optional) */
router.post('/check-notify', authRequired, requireRoles('manager', 'admin', 'supervisor'), async (req, res) => {
  try {
    const alerts = await listAlerts(req.user.companyId);
    const overdue = alerts.filter((a) => a.status === 'overdue');
    const dueSoon = alerts.filter((a) => a.status === 'due_soon');
    if (overdue.length || dueSoon.length) {
      notifyAsync(() =>
        sendToRoles(req.user.companyId, ['manager', 'admin'], {
          title: 'Vehicle maintenance',
          body: `${overdue.length} overdue, ${dueSoon.length} due soon`,
          data: { type: 'maintenance', overdue: overdue.length, dueSoon: dueSoon.length }
        })
      );
    }
    res.json({ overdue: overdue.length, dueSoon: dueSoon.length, notified: overdue.length + dueSoon.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Check failed' } });
  }
});

/** All active schedules with computed status */
router.get('/schedules', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const schedules = await listSchedulesWithStatus(req.user.companyId, req.query.vehicleId || null);
    res.json({ schedules });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load schedules' } });
  }
});

/** Create a recurring maintenance schedule */
router.post('/schedules', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.vehicleId || !b.serviceType) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'vehicleId and serviceType required' } });
    }
    if (b.intervalMiles == null && b.intervalDays == null) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'intervalMiles and/or intervalDays required' }
      });
    }

    const vehicle = await getVehicleInCompany(b.vehicleId, req.user.companyId);
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
    }

    const lastOdo = b.lastServiceOdoMi != null ? Number(b.lastServiceOdoMi) : Number(vehicle.current_odometer_mi);
    const lastAt = b.lastServiceAt || new Date().toISOString().slice(0, 10);
    let nextDueOdo = b.nextDueOdoMi != null ? Number(b.nextDueOdoMi) : null;
    let nextDueDate = b.nextDueDate || null;

    if (nextDueOdo == null && b.intervalMiles != null) {
      nextDueOdo = lastOdo + Number(b.intervalMiles);
    }
    if (!nextDueDate && b.intervalDays != null) {
      const d = new Date(lastAt);
      d.setDate(d.getDate() + Number(b.intervalDays));
      nextDueDate = d.toISOString().slice(0, 10);
    }

    const { rows } = await query(
      `INSERT INTO maintenance_schedules
        (company_id, vehicle_id, service_type, description, interval_miles, interval_days,
         last_service_at, last_service_odo_mi, next_due_odo_mi, next_due_date,
         warn_miles_before, warn_days_before)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.user.companyId,
        b.vehicleId,
        b.serviceType,
        b.description || null,
        b.intervalMiles ?? null,
        b.intervalDays ?? null,
        lastAt,
        lastOdo,
        nextDueOdo,
        nextDueDate,
        b.warnMilesBefore ?? 500,
        b.warnDaysBefore ?? 14
      ]
    );

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'maint_schedule_create',
      entityType: 'maintenance_schedule',
      entityId: rows[0].id,
      vehicleId: b.vehicleId,
      detail: `${b.serviceType} every ${b.intervalMiles || '—'} mi / ${b.intervalDays || '—'} days`
    });

    const status = evaluateSchedule(rows[0], vehicle.current_odometer_mi);
    res.status(201).json({ schedule: { ...rows[0], ...status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to create schedule' } });
  }
});

/** Mark service complete — writes log and advances next due */
router.post('/complete', authRequired, requireRoles('manager', 'admin', 'supervisor'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.scheduleId && !(b.vehicleId && b.serviceType)) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'scheduleId (or vehicleId + serviceType) required' }
      });
    }

    let schedule;
    if (b.scheduleId) {
      const { rows } = await query(
        `SELECT * FROM maintenance_schedules WHERE id = $1 AND company_id = $2 AND active = true`,
        [b.scheduleId, req.user.companyId]
      );
      schedule = rows[0];
    }
    if (!schedule) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } });
    }

    const vehicle = await getVehicleInCompany(schedule.vehicle_id, req.user.companyId);
    const performedAt = b.performedAt || new Date().toISOString().slice(0, 10);
    const odo =
      b.odometerMi != null
        ? Number(b.odometerMi)
        : vehicle
          ? Number(vehicle.current_odometer_mi)
          : null;

    const advanced = advanceSchedule(schedule, performedAt, odo);

    const result = await withTransaction(async (client) => {
      const { rows: logs } = await client.query(
        `INSERT INTO maintenance_logs
          (company_id, vehicle_id, schedule_id, service_type, performed_at, odometer_mi, cost, vendor, notes, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          req.user.companyId,
          schedule.vehicle_id,
          schedule.id,
          schedule.service_type,
          performedAt,
          odo,
          b.cost ?? null,
          b.vendor || null,
          b.notes || null,
          req.user.sub
        ]
      );
      const { rows: updated } = await client.query(
        `UPDATE maintenance_schedules SET
           last_service_at = $1,
           last_service_odo_mi = $2,
           next_due_odo_mi = $3,
           next_due_date = $4,
           updated_at = now()
         WHERE id = $5
         RETURNING *`,
        [
          advanced.last_service_at,
          advanced.last_service_odo_mi,
          advanced.next_due_odo_mi,
          advanced.next_due_date,
          schedule.id
        ]
      );
      return { log: logs[0], schedule: updated[0] };
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'maint_complete',
      entityType: 'maintenance_log',
      entityId: result.log.id,
      vehicleId: schedule.vehicle_id,
      detail: `Completed ${schedule.service_type} @ ${odo != null ? odo + ' mi' : performedAt}`
    });

    const status = evaluateSchedule(result.schedule, vehicle?.current_odometer_mi);
    res.status(201).json({ log: result.log, schedule: { ...result.schedule, ...status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to complete service' } });
  }
});

/** Service history for a vehicle */
router.get('/logs', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const params = [req.user.companyId];
    let sql = `
      SELECT l.*, v.code AS vehicle_code
      FROM maintenance_logs l
      JOIN vehicles v ON v.id = l.vehicle_id
      WHERE l.company_id = $1`;
    if (req.query.vehicleId) {
      params.push(req.query.vehicleId);
      sql += ` AND l.vehicle_id = $${params.length}`;
    }
    sql += ` ORDER BY l.performed_at DESC, l.created_at DESC LIMIT 100`;
    const { rows } = await query(sql, params);
    res.json({ logs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load logs' } });
  }
});

/** Deactivate a schedule */
router.delete('/schedules/:id', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE maintenance_schedules SET active = false, updated_at = now()
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [req.params.id, req.user.companyId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to deactivate schedule' } });
  }
});

module.exports = router;
