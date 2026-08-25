const { query } = require('../db');

const HOS_LABELS = {
  off: 'Off Duty',
  sleeper: 'Sleeper Berth',
  driving: 'Driving',
  onduty: 'On Duty (Not Driving)'
};

function hoursBetween(start, end) {
  return Math.max(0, (new Date(end) - new Date(start)) / 3600000);
}

/** Close open duty event and open a new one */
async function setDutyStatus(client, { companyId, driverId, vehicleId, status, source }) {
  const now = new Date().toISOString();
  await client.query(
    `UPDATE duty_status_events
     SET ended_at = $1
     WHERE driver_id = $2 AND ended_at IS NULL`,
    [now, driverId]
  );
  const { rows } = await client.query(
    `INSERT INTO duty_status_events
      (company_id, driver_id, vehicle_id, status, started_at, source)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [companyId, driverId, vehicleId || null, status, now, source || 'user']
  );
  return rows[0];
}

async function getOpenDuty(driverId) {
  const { rows } = await query(
    `SELECT * FROM duty_status_events
     WHERE driver_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [driverId]
  );
  return rows[0] || null;
}

async function sumDutyHours(driverId, statuses, sinceIso) {
  const { rows } = await query(
    `SELECT status, started_at, ended_at FROM duty_status_events
     WHERE driver_id = $1
       AND status = ANY($2::duty_status[])
       AND started_at >= $3`,
    [driverId, statuses, sinceIso]
  );
  const now = Date.now();
  let total = 0;
  for (const r of rows) {
    const s = Math.max(new Date(r.started_at).getTime(), new Date(sinceIso).getTime());
    const e = r.ended_at ? new Date(r.ended_at).getTime() : now;
    if (e > s) total += (e - s) / 3600000;
  }
  return total;
}

async function calcHosMeters(driverId, timezone = 'America/Chicago') {
  // Local midnight approximation using UTC offset-friendly day boundary for MVP
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600000);

  const driveToday = await sumDutyHours(driverId, ['driving'], startOfDay.toISOString());
  const onDutyToday = await sumDutyHours(driverId, ['driving', 'onduty'], startOfDay.toISOString());
  const eightDay = await sumDutyHours(driverId, ['driving', 'onduty'], eightDaysAgo.toISOString());
  const current = await getOpenDuty(driverId);

  const warnings = [];
  if (driveToday >= 11) warnings.push({ level: 'critical', text: '11-hour driving limit reached.' });
  else if (driveToday >= 10) warnings.push({ level: 'warning', text: `Approaching 11-hour drive limit (${driveToday.toFixed(2)} h).` });
  if (onDutyToday >= 14) warnings.push({ level: 'critical', text: '14-hour on-duty window limit reached.' });
  else if (onDutyToday >= 13) warnings.push({ level: 'warning', text: `Approaching 14-hour on-duty window (${onDutyToday.toFixed(2)} h).` });
  if (eightDay >= 70) warnings.push({ level: 'critical', text: '70-hour / 8-day limit reached.' });
  else if (eightDay >= 65) warnings.push({ level: 'warning', text: `Approaching 70-hour / 8-day limit (${eightDay.toFixed(2)} h).` });

  return {
    status: current ? current.status : 'off',
    statusLabel: HOS_LABELS[current ? current.status : 'off'],
    since: current ? current.since || current.started_at : null,
    driveToday,
    onDutyToday,
    eightDay,
    warnings
  };
}

async function hasValidPreTrip(vehicleId, maxAgeHours) {
  const { rows } = await query(
    `SELECT id FROM inspections
     WHERE vehicle_id = $1
       AND type = 'pretrip'
       AND safe_to_operate = true
       AND created_at >= now() - ($2 || ' hours')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [vehicleId, String(maxAgeHours)]
  );
  return rows.length > 0;
}

module.exports = {
  HOS_LABELS,
  hoursBetween,
  setDutyStatus,
  getOpenDuty,
  calcHosMeters,
  hasValidPreTrip
};
