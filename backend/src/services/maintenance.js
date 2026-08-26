const { query } = require('../db');

/**
 * Compute due status from schedule + current vehicle odometer.
 * status: overdue | due_soon | ok
 */
function evaluateSchedule(schedule, currentOdo) {
  const odo = currentOdo != null ? Number(currentOdo) : null;
  const warnMi = Number(schedule.warn_miles_before ?? 500);
  const warnDays = Number(schedule.warn_days_before ?? 14);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let milesOverdue = false;
  let milesDueSoon = false;
  let milesRemaining = null;
  if (schedule.next_due_odo_mi != null && odo != null) {
    const dueOdo = Number(schedule.next_due_odo_mi);
    milesRemaining = dueOdo - odo;
    if (milesRemaining <= 0) milesOverdue = true;
    else if (milesRemaining <= warnMi) milesDueSoon = true;
  }

  let daysOverdue = false;
  let daysDueSoon = false;
  let daysRemaining = null;
  if (schedule.next_due_date) {
    const due = new Date(schedule.next_due_date);
    due.setHours(0, 0, 0, 0);
    daysRemaining = Math.round((due - today) / 86400000);
    if (daysRemaining <= 0) daysOverdue = true;
    else if (daysRemaining <= warnDays) daysDueSoon = true;
  }

  let status = 'ok';
  if (milesOverdue || daysOverdue) status = 'overdue';
  else if (milesDueSoon || daysDueSoon) status = 'due_soon';

  return {
    status,
    milesRemaining,
    daysRemaining,
    milesOverdue,
    daysOverdue
  };
}

function advanceSchedule(schedule, performedAt, odometerMi) {
  const odo = odometerMi != null ? Number(odometerMi) : null;
  let nextDueOdo = schedule.next_due_odo_mi;
  let nextDueDate = schedule.next_due_date;

  if (schedule.interval_miles != null && odo != null) {
    nextDueOdo = odo + Number(schedule.interval_miles);
  }
  if (schedule.interval_days != null && performedAt) {
    const d = new Date(performedAt);
    d.setDate(d.getDate() + Number(schedule.interval_days));
    nextDueDate = d.toISOString().slice(0, 10);
  }

  return {
    last_service_at: performedAt,
    last_service_odo_mi: odo,
    next_due_odo_mi: nextDueOdo,
    next_due_date: nextDueDate
  };
}

async function listSchedulesWithStatus(companyId, vehicleId = null) {
  const params = [companyId];
  let sql = `
    SELECT s.*, v.code AS vehicle_code, v.name AS vehicle_name, v.current_odometer_mi
    FROM maintenance_schedules s
    JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.company_id = $1 AND s.active = true`;
  if (vehicleId) {
    params.push(vehicleId);
    sql += ` AND s.vehicle_id = $${params.length}`;
  }
  sql += ` ORDER BY v.code, s.service_type`;

  const { rows } = await query(sql, params);
  return rows.map((r) => {
    const eval_ = evaluateSchedule(r, r.current_odometer_mi);
    return { ...r, ...eval_ };
  });
}

async function listAlerts(companyId) {
  const all = await listSchedulesWithStatus(companyId);
  return all
    .filter((s) => s.status === 'overdue' || s.status === 'due_soon')
    .sort((a, b) => {
      const rank = { overdue: 0, due_soon: 1, ok: 2 };
      return rank[a.status] - rank[b.status];
    });
}

module.exports = {
  evaluateSchedule,
  advanceSchedule,
  listSchedulesWithStatus,
  listAlerts
};
