const { query } = require('../db');
const { hoursBetween, setDutyStatus } = require('./hos');
const { gpsMilesInWindow } = require('./miles');
const { writeAudit } = require('./audit');

const IDLE_MINUTES = Number(process.env.AUTO_END_DRIVE_IDLE_MINUTES || 15);
const IDLE_MAX_SPEED = Number(process.env.AUTO_END_DRIVE_MAX_SPEED_MPH || 3);

/**
 * Complete an open drive segment with odo/GPS totals.
 * @returns closed drive row or null
 */
async function completeDriveSegment(open, { endOdo = null, reason = 'auto', actorUserId = null, actorName = 'system', setDutyTo = 'auto' } = {}) {
  if (!open || open.ended_at) return null;
  const now = new Date().toISOString();
  const hours = hoursBetween(open.started_at, now);
  let gpsMiles = null;
  try {
    gpsMiles = await gpsMilesInWindow(open.vehicle_id, open.started_at, now);
  } catch (_) {}
  const startOdo = open.start_odo_mi != null ? Number(open.start_odo_mi) : null;
  const end = endOdo != null ? Number(endOdo) : null;
  const odoMiles =
    startOdo != null && end != null
      ? Math.max(0, end - startOdo)
      : gpsMiles != null
        ? Number(gpsMiles)
        : null;

  const { rows: lastPos } = await query(
    `SELECT lat, lng FROM positions WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
    [open.vehicle_id]
  );

  const { rows } = await query(
    `UPDATE drive_segments SET
       ended_at = $1,
       hours = $2,
       gps_miles = COALESCE($3, gps_miles),
       odo_miles = COALESCE($4, odo_miles),
       end_odo_mi = COALESCE($5, end_odo_mi),
       end_lat = COALESCE($6, end_lat),
       end_lng = COALESCE($7, end_lng),
       status = 'completed'
     WHERE id = $8 AND ended_at IS NULL
     RETURNING *`,
    [
      now,
      hours,
      gpsMiles != null ? Number(Number(gpsMiles).toFixed(3)) : null,
      odoMiles != null ? Number(Number(odoMiles).toFixed(3)) : null,
      end,
      lastPos[0]?.lat ?? null,
      lastPos[0]?.lng ?? null,
      open.id
    ]
  );
  const closed = rows[0];
  if (!closed) return null;

  // Duty after drive ends:
  // - On Duty only if driver is still clocked in
  // - Off Duty if not clocked in
  // - null / false skips duty change
  if (setDutyTo !== null && setDutyTo !== false) {
    let status = setDutyTo;
    if (setDutyTo === 'auto') {
      const { rows: openWork } = await query(
        `SELECT id FROM work_sessions
         WHERE driver_id = $1 AND status = 'open'
         LIMIT 1`,
        [open.driver_id]
      );
      status = openWork.length ? 'onduty' : 'off';
    }
    try {
      const client = { query: (sql, params) => query(sql, params) };
      await setDutyStatus(client, {
        companyId: open.company_id,
        driverId: open.driver_id,
        vehicleId: open.vehicle_id,
        status,
        source: reason
      });
    } catch (err) {
      console.error('auto-end duty status update failed', err.message);
    }
  }

  await writeAudit({
    companyId: open.company_id,
    actorUserId,
    actorName: actorName || 'system',
    action: 'drive_end',
    entityType: 'drive_segment',
    entityId: closed.id,
    vehicleId: open.vehicle_id,
    detail: `Drive closed (${reason}) · ${Number(hours).toFixed(2)} h (drive rate)`
  });

  return closed;
}

async function closeOpenDriveForDriver(driverId, opts = {}) {
  const { rows } = await query(
    `SELECT * FROM drive_segments
     WHERE driver_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [driverId]
  );
  if (!rows[0]) return null;
  return completeDriveSegment(rows[0], opts);
}

async function closeOpenDriveForVehicle(vehicleId, opts = {}) {
  const { rows } = await query(
    `SELECT * FROM drive_segments
     WHERE vehicle_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [vehicleId]
  );
  if (!rows[0]) return null;
  return completeDriveSegment(rows[0], opts);
}

/**
 * If vehicle has an open paid drive and has been effectively idle long enough,
 * auto-end drive time (driver forgot End Drive while still clocked in).
 */
async function maybeAutoEndIdleDrive(vehicleId, { currentOdo = null } = {}) {
  if (!vehicleId || IDLE_MINUTES <= 0) return null;

  const { rows: openRows } = await query(
    `SELECT * FROM drive_segments
     WHERE vehicle_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [vehicleId]
  );
  const open = openRows[0];
  if (!open) return null;

  const since = new Date(Date.now() - IDLE_MINUTES * 60 * 1000).toISOString();
  const { rows: recent } = await query(
    `SELECT speed_mph, recorded_at, lat, lng
     FROM positions
     WHERE vehicle_id = $1 AND recorded_at >= $2
     ORDER BY recorded_at ASC`,
    [vehicleId, since]
  );

  // Need enough samples covering the idle window
  if (recent.length < 2) return null;
  const oldest = new Date(recent[0].recorded_at).getTime();
  if (Date.now() - oldest < IDLE_MINUTES * 60 * 1000 * 0.9) return null;

  const moving = recent.some((p) => p.speed_mph != null && Number(p.speed_mph) > IDLE_MAX_SPEED);
  if (moving) return null;

  // Optional path distance check: if GPS moved more than ~0.3 mi in window, still considered moving
  let path = 0;
  const { haversine } = require('./miles');
  for (let i = 1; i < recent.length; i++) {
    path += haversine(recent[i - 1].lat, recent[i - 1].lng, recent[i].lat, recent[i].lng);
  }
  if (path > 0.35) return null;

  return completeDriveSegment(open, {
    endOdo: currentOdo,
    reason: `auto-idle-${IDLE_MINUTES}m`,
    actorName: 'system',
    setDutyTo: 'auto' // onduty only if still clocked in; else off
  });
}

module.exports = {
  completeDriveSegment,
  closeOpenDriveForDriver,
  closeOpenDriveForVehicle,
  maybeAutoEndIdleDrive,
  IDLE_MINUTES,
  IDLE_MAX_SPEED
};
