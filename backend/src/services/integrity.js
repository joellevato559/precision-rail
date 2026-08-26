const { query } = require('../db');
const { gpsMilesInWindow } = require('./miles');

async function milesNearExpense(vehicleId, whenIso, hoursWindow = 36) {
  const t = new Date(whenIso).getTime();
  const start = new Date(t - hoursWindow * 3600000).toISOString();
  const end = new Date(t + (hoursWindow / 3) * 3600000).toISOString();

  const { rows: segs } = await query(
    `SELECT gps_miles, odo_miles, started_at, ended_at FROM drive_segments
     WHERE vehicle_id = $1 AND started_at <= $2 AND COALESCE(ended_at, now()) >= $3`,
    [vehicleId, end, start]
  );
  let miles = 0;
  for (const s of segs) {
    miles += Number(s.gps_miles || s.odo_miles || 0);
  }
  if (miles < 0.1) {
    miles = await gpsMilesInWindow(vehicleId, start, end);
  }
  return miles;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Scan fuel expenses vs miles; insert anomaly_flags for open issues.
 * Idempotent-ish: skips if same code+expense already open.
 */
async function scanVehicleFuelIntegrity(companyId, vehicleId) {
  const { rows: fuels } = await query(
    `SELECT * FROM expenses
     WHERE company_id = $1 AND vehicle_id = $2 AND type = 'Fuel'
     ORDER BY COALESCE(purchased_at::timestamptz, logged_at) ASC`,
    [companyId, vehicleId]
  );

  const alerts = [];
  const mpgSamples = [];

  for (const e of fuels) {
    if (e.quantity && Number(e.quantity) > 0) {
      const when = e.purchased_at
        ? `${e.purchased_at}T12:00:00.000Z`
        : e.logged_at;
      const miles = await milesNearExpense(vehicleId, when, 48);
      if (miles > 1) mpgSamples.push(miles / Number(e.quantity));
    }
  }
  const baselineMpg = median(mpgSamples);

  const { rows: gps } = await query(
    `SELECT COALESCE(SUM(
        CASE WHEN lag_lat IS NOT NULL THEN 0 ELSE 0 END
      ), 0) AS dummy FROM positions WHERE vehicle_id = $1`,
    [vehicleId]
  );
  void gps;

  const { rows: posCount } = await query(
    `SELECT COUNT(*)::int AS n FROM positions WHERE vehicle_id = $1`,
    [vehicleId]
  );
  const { rows: mileAgg } = await query(
    `SELECT COALESCE(SUM(gps_miles),0)::float AS mi FROM drive_segments WHERE vehicle_id = $1`,
    [vehicleId]
  );
  const totalFuelSpend = fuels.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalMiles = Number(mileAgg[0]?.mi || 0);

  if (totalFuelSpend > 50 && totalMiles < 5 && (posCount[0]?.n || 0) < 5) {
    alerts.push({
      code: 'FUEL_NO_MILES',
      severity: 'critical',
      title: 'Fuel spend with almost no miles',
      detail: `$${totalFuelSpend.toFixed(2)} fuel vs ~${totalMiles.toFixed(1)} mi on record`,
      expenseId: null
    });
  }

  for (let i = 1; i < fuels.length; i++) {
    const prev = fuels[i - 1];
    const cur = fuels[i];
    const t0 = new Date(prev.logged_at || prev.purchased_at).getTime();
    const t1 = new Date(cur.logged_at || cur.purchased_at).getTime();
    const hoursApart = Math.abs(t1 - t0) / 3600000;
    if (hoursApart < 2) {
      alerts.push({
        code: 'RAPID_FILLS',
        severity: 'critical',
        title: 'Two fuel purchases within 2 hours',
        detail: `$${Number(prev.amount).toFixed(2)} then $${Number(cur.amount).toFixed(2)} (${hoursApart.toFixed(1)} h apart)`,
        expenseId: cur.id
      });
    }
  }

  for (const e of fuels) {
    const qty = Number(e.quantity || 0);
    const amt = Number(e.amount || 0);
    const when = e.purchased_at ? `${e.purchased_at}T12:00:00.000Z` : e.logged_at;
    const miles = await milesNearExpense(vehicleId, when, 36);

    if (qty >= 5 && miles < 3) {
      alerts.push({
        code: 'FILL_LOW_MILES',
        severity: 'critical',
        title: 'Large fill with very few nearby miles',
        detail: `${qty} gal · $${amt.toFixed(2)} · ${miles.toFixed(1)} mi nearby`,
        expenseId: e.id
      });
    } else if (qty > 0) {
      const mpg = miles / qty;
      if (mpg > 0 && mpg < 4) {
        alerts.push({
          code: 'MPG_TOO_LOW',
          severity: 'warning',
          title: 'Implausibly low MPG',
          detail: `${mpg.toFixed(1)} MPG (${miles.toFixed(1)} mi / ${qty} gal)`,
          expenseId: e.id
        });
      } else if (mpg > 45) {
        alerts.push({
          code: 'MPG_TOO_HIGH',
          severity: 'warning',
          title: 'Unusually high MPG',
          detail: `${mpg.toFixed(1)} MPG (${miles.toFixed(1)} mi / ${qty} gal)`,
          expenseId: e.id
        });
      } else if (baselineMpg && mpgSamples.length >= 3 && mpg < baselineMpg * 0.6) {
        alerts.push({
          code: 'MPG_BELOW_BASELINE',
          severity: 'warning',
          title: 'MPG below vehicle baseline',
          detail: `${mpg.toFixed(1)} vs median ${baselineMpg.toFixed(1)} MPG`,
          expenseId: e.id
        });
      }
    } else if (amt >= 75) {
      alerts.push({
        code: 'NO_QUANTITY',
        severity: 'info',
        title: 'Fuel purchase missing quantity',
        detail: `$${amt.toFixed(2)} — MPG cannot be verified`,
        expenseId: e.id
      });
    }
  }

  const created = [];
  for (const a of alerts) {
    const { rows: existing } = await query(
      `SELECT id FROM anomaly_flags
       WHERE company_id = $1 AND vehicle_id = $2 AND code = $3 AND status = 'open'
         AND ($4::uuid IS NULL OR expense_id = $4)
       LIMIT 1`,
      [companyId, vehicleId, a.code, a.expenseId]
    );
    if (existing.length) continue;
    const { rows } = await query(
      `INSERT INTO anomaly_flags
        (company_id, vehicle_id, expense_id, code, severity, title, detail, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open')
       RETURNING *`,
      [companyId, vehicleId, a.expenseId, a.code, a.severity, a.title, a.detail]
    );
    created.push(rows[0]);
  }

  return { alerts: created, baselineMpg, sampleCount: mpgSamples.length };
}

async function scanCompanyIntegrity(companyId) {
  const { rows: vehicles } = await query(
    `SELECT id FROM vehicles WHERE company_id = $1 AND active = true`,
    [companyId]
  );
  const all = [];
  for (const v of vehicles) {
    const r = await scanVehicleFuelIntegrity(companyId, v.id);
    all.push(...r.alerts);
  }
  return all;
}

module.exports = { scanVehicleFuelIntegrity, scanCompanyIntegrity, milesNearExpense };
