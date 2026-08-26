const { query } = require('../db');

const EARTH_MI = 3958.7613;
const MAX_JUMP_MI = 1.25;

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** GPS path miles between two timestamps for a vehicle */
async function gpsMilesInWindow(vehicleId, startIso, endIso) {
  const { rows } = await query(
    `SELECT lat, lng, recorded_at
     FROM positions
     WHERE vehicle_id = $1
       AND recorded_at >= $2
       AND recorded_at <= $3
     ORDER BY recorded_at ASC`,
    [vehicleId, startIso, endIso || new Date().toISOString()]
  );
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const seg = haversine(rows[i - 1].lat, rows[i - 1].lng, rows[i].lat, rows[i].lng);
    if (seg <= MAX_JUMP_MI) total += seg;
  }
  return total;
}

module.exports = { haversine, gpsMilesInWindow, MAX_JUMP_MI };
