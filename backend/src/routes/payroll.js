const express = require('express');
const { query, withTransaction } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { writeAudit } = require('../services/audit');
const { computeDriverOvertime } = require('../services/overtime');

const router = express.Router();

function weekEndFromStart(weekStart) {
  const d = new Date(weekStart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

async function aggregateWeek(companyId, weekStart) {
  const weekEnd = weekEndFromStart(weekStart);
  const startIso = weekStart + 'T00:00:00.000Z';
  const endIso = weekEnd + 'T23:59:59.999Z';

  const { rows: sessions } = await query(
    `SELECT s.*, u.name AS driver_name, d.id AS driver_pk, d.work_rate_hourly, d.drive_rate_hourly, v.code AS vehicle_code
     FROM work_sessions s
     JOIN drivers d ON d.id = s.driver_id
     JOIN users u ON u.id = d.user_id
     JOIN vehicles v ON v.id = s.vehicle_id
     WHERE s.company_id = $1 AND s.status = 'approved'
       AND s.clock_in >= $2 AND s.clock_in <= $3`,
    [companyId, startIso, endIso]
  );

  const { rows: drives } = await query(
    `SELECT ds.*, u.name AS driver_name, d.id AS driver_pk, d.work_rate_hourly, d.drive_rate_hourly, v.code AS vehicle_code
     FROM drive_segments ds
     JOIN drivers d ON d.id = ds.driver_id
     JOIN users u ON u.id = d.user_id
     JOIN vehicles v ON v.id = ds.vehicle_id
     WHERE ds.company_id = $1 AND ds.ended_at IS NOT NULL
       AND ds.started_at >= $2 AND ds.started_at <= $3`,
    [companyId, startIso, endIso]
  );

  // Group by driver
  const driverMap = {};
  for (const s of sessions) {
    const id = s.driver_pk;
    if (!driverMap[id]) {
      driverMap[id] = {
        driverId: id,
        driverName: s.driver_name,
        workRate: Number(s.work_rate_hourly) || 0,
        driveRate: Number(s.drive_rate_hourly) || 0,
        sessions: [],
        drives: []
      };
    }
    driverMap[id].sessions.push(s);
  }
  for (const d of drives) {
    const id = d.driver_pk;
    if (!driverMap[id]) {
      driverMap[id] = {
        driverId: id,
        driverName: d.driver_name,
        workRate: Number(d.work_rate_hourly) || 0,
        driveRate: Number(d.drive_rate_hourly) || 0,
        sessions: [],
        drives: []
      };
    }
    driverMap[id].drives.push(d);
  }

  const byDriver = {};
  const overtime = {};

  for (const id of Object.keys(driverMap)) {
    const g = driverMap[id];
    const ot = computeDriverOvertime({
      sessions: g.sessions,
      drives: g.drives,
      workRate: g.workRate,
      driveRate: g.driveRate
    });
    overtime[g.driverName] = ot;
    byDriver[g.driverName] = {
      driverId: g.driverId,
      workHours: ot.totals.workHours,
      driveHours: ot.totals.driveHours,
      regularHours: ot.totals.regularHours,
      ot15Hours: ot.totals.ot15Hours,
      ot20Hours: ot.totals.ot20Hours,
      regularPay: ot.totals.regularPay,
      ot15Pay: ot.totals.ot15Pay,
      ot20Pay: ot.totals.ot20Pay,
      drivePay: ot.totals.drivePay,
      totalPay: ot.totals.totalPay,
      workRate: g.workRate,
      driveRate: g.driveRate,
      methodUsed: ot.methodUsed,
      dailyMethodPay: ot.dailyMethodPay,
      weeklyMethodPay: ot.weeklyMethodPay,
      days: ot.days
    };
  }

  return {
    weekStart,
    weekEnd,
    sessions,
    drives,
    byDriver,
    overtime,
    otRules: {
      dailyOtAfterHours: 8,
      dailyDoubleAfterHours: 12,
      weeklyOtAfterHours: 40,
      seventhConsecutiveDay: 'First 8h @ 1.5x, over 8h @ 2x (work hours only)',
      overlap: 'Pay the higher of daily-method vs weekly-method totals (no stacking)',
      note: 'OT on hourly work only. Drive time is flat drive rate only.'
    }
  };
}

router.get('/preview', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const weekStart = req.query.weekStart;
    if (!weekStart) {
      return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'weekStart=YYYY-MM-DD required' } });
    }
    const data = await aggregateWeek(req.user.companyId, weekStart);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Payroll preview failed' } });
  }
});

router.post('/export', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const weekStart = req.body?.weekStart || req.query.weekStart;
    if (!weekStart) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'weekStart required' } });
    }
    const data = await aggregateWeek(req.user.companyId, weekStart);

    let csv = 'Type,Employee,Vehicle,Start,End,Hours,GPS mi,Odometer mi,Week Start,Week End,Pay Category\n';
    for (const s of data.sessions) {
      const wGps = s.gps_miles != null ? Number(s.gps_miles).toFixed(2) : '';
      const wOdo = s.odo_miles != null ? Number(s.odo_miles).toFixed(2) : '';
      csv += `"Work","${s.driver_name}","${s.vehicle_code}","${s.clock_in}","${s.clock_out || ''}",${Number(s.hours || 0).toFixed(2)},${wGps},${wOdo},"${data.weekStart}","${data.weekEnd}","Regular base (OT applied in summary)"\n`;
    }
    for (const d of data.drives) {
      csv += `"Drive","${d.driver_name}","${d.vehicle_code}","${d.started_at}","${d.ended_at}",${Number(d.hours || 0).toFixed(2)},${d.gps_miles != null ? Number(d.gps_miles).toFixed(2) : ''},${d.odo_miles != null ? Number(d.odo_miles).toFixed(2) : ''},"${data.weekStart}","${data.weekEnd}","Drive base (OT applied in summary)"\n`;
    }

    csv += '\nEmployee,Work Hours,Drive Hours,Work Regular h,Work OT 1.5x h,Work Double 2x h,Work Rate,Drive Rate,Work Regular Pay,Work OT Pay,Work Double Pay,Drive Pay (flat),Total Pay\n';
    for (const name of Object.keys(data.byDriver).sort()) {
      const r = data.byDriver[name];
      csv += `"${name}",${r.workHours.toFixed(2)},${r.driveHours.toFixed(2)},${r.regularHours.toFixed(2)},${r.ot15Hours.toFixed(2)},${r.ot20Hours.toFixed(2)},${Number(r.workRate).toFixed(2)},${Number(r.driveRate).toFixed(2)},${r.regularPay.toFixed(2)},${r.ot15Pay.toFixed(2)},${r.ot20Pay.toFixed(2)},${Number(r.drivePay || 0).toFixed(2)},${r.totalPay.toFixed(2)}\n`;
    }

    csv += '\nDaily detail: Employee,Date,Work h,Drive h,Total h,7th Day,Regular h,OT 1.5x h,Double 2x h,Day Pay\n';
    for (const name of Object.keys(data.byDriver).sort()) {
      const r = data.byDriver[name];
      for (const day of r.days || []) {
        csv += `"${name}","${day.date}",${day.workHours.toFixed(2)},${day.driveHours.toFixed(2)},${day.totalHours.toFixed(2)},${day.isSeventhConsecutive ? 'Y' : 'N'},${day.regular.toFixed(2)},${day.ot15.toFixed(2)},${day.ot20.toFixed(2)},${day.dayPay.toFixed(2)}\n`;
      }
    }

    csv += '\nOT Rules,"OT on hourly WORK only: over 8h/day = 1.5x; over 12h/day = 2x; over 40h/week = 1.5x on remaining straight work time; 7th consecutive work day: first 8h = 1.5x, over 8h = 2x. Drive time is flat drive rate only — no OT."\n';

    await withTransaction(async (client) => {
      for (const s of data.sessions) {
        await client.query(
          `UPDATE work_sessions SET status = 'submitted', submitted_at = now() WHERE id = $1 AND status = 'approved'`,
          [s.id]
        );
      }
      const { rows: periodRows } = await client.query(
        `INSERT INTO pay_periods (company_id, week_start, week_end, status, exported_at, exported_by)
         VALUES ($1,$2,$3,'exported',now(),$4)
         ON CONFLICT (company_id, week_start) DO UPDATE SET
           status = 'exported', exported_at = now(), exported_by = $4
         RETURNING id`,
        [req.user.companyId, data.weekStart, data.weekEnd, req.user.sub]
      );
      const periodId = periodRows[0]?.id;
      if (periodId) {
        for (const name of Object.keys(data.byDriver)) {
          const r = data.byDriver[name];
          await client.query(
            `INSERT INTO pay_period_lines (
               pay_period_id, driver_id, work_hours, drive_hours,
               regular_hours, ot15_hours, ot20_hours,
               regular_pay, ot15_pay, ot20_pay, total_pay
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (pay_period_id, driver_id) DO UPDATE SET
               work_hours = EXCLUDED.work_hours,
               drive_hours = EXCLUDED.drive_hours,
               regular_hours = EXCLUDED.regular_hours,
               ot15_hours = EXCLUDED.ot15_hours,
               ot20_hours = EXCLUDED.ot20_hours,
               regular_pay = EXCLUDED.regular_pay,
               ot15_pay = EXCLUDED.ot15_pay,
               ot20_pay = EXCLUDED.ot20_pay,
               total_pay = EXCLUDED.total_pay`,
            [
              periodId,
              r.driverId,
              r.workHours,
              r.driveHours,
              r.regularHours,
              r.ot15Hours,
              r.ot20Hours,
              r.regularPay,
              r.ot15Pay,
              r.ot20Pay,
              r.totalPay
            ]
          );
        }
      }
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'payroll_export',
      detail: `Week ${data.weekStart} to ${data.weekEnd} (with OT)`
    });

    res.json({
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
      csv,
      filename: `payroll_${data.weekStart}_to_${data.weekEnd}.csv`,
      summary: data.byDriver,
      otRules: data.otRules
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Payroll export failed' } });
  }
});

/** Pending sessions for approval queue */
router.get('/pending-sessions', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.*, u.name AS driver_name, v.code AS vehicle_code
       FROM work_sessions s
       JOIN drivers d ON d.id = s.driver_id
       JOIN users u ON u.id = d.user_id
       JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.company_id = $1 AND s.status = 'pending'
       ORDER BY s.clock_in DESC LIMIT 100`,
      [req.user.companyId]
    );
    res.json({ sessions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load pending sessions' } });
  }
});

router.post('/sessions/:id/approve', authRequired, requireRoles('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE work_sessions SET status = 'approved', approved_at = now(), approved_by = $1
       WHERE id = $2 AND company_id = $3 AND status = 'pending'
       RETURNING *`,
      [req.user.sub, req.params.id, req.user.companyId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pending session not found' } });
    }
    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'timesheet_approve',
      entityType: 'work_session',
      entityId: rows[0].id,
      vehicleId: rows[0].vehicle_id,
      detail: `Approved session ${Number(rows[0].hours || 0).toFixed(2)} h`
    });
    res.json({ session: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Approve failed' } });
  }
});

module.exports = router;
