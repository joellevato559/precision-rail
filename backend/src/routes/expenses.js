const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { getDriverForUser, getVehicleInCompany } = require('../services/drivers');
const { writeAudit } = require('../services/audit');
const { scanVehicleFuelIntegrity } = require('../services/integrity');

const router = express.Router();

router.post('/', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.vehicleId || b.amount == null || !b.type) {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'vehicleId, type, amount required' } });
    }
    const vehicle = await getVehicleInCompany(b.vehicleId, req.user.companyId);
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
    }
    const driver = await getDriverForUser(req.user.sub, req.user.companyId);

    const { rows } = await query(
      `INSERT INTO expenses
        (company_id, vehicle_id, driver_id, type, amount, quantity, unit_price, vendor,
         payment_method, jurisdiction, odometer_mi, notes, receipt_url, purchased_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.user.companyId,
        b.vehicleId,
        driver?.id || null,
        b.type,
        b.amount,
        b.quantity ?? null,
        b.unitPrice ?? null,
        b.vendor || null,
        b.paymentMethod || null,
        b.jurisdiction || vehicle.default_jurisdiction || null,
        b.odometerMi ?? vehicle.current_odometer_mi,
        b.notes || null,
        b.receiptUrl || null,
        b.purchasedAt || new Date().toISOString().slice(0, 10)
      ]
    );

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'expense_log',
      entityType: 'expense',
      entityId: rows[0].id,
      vehicleId: b.vehicleId,
      detail: `${b.type} $${Number(b.amount).toFixed(2)}`
    });

    if (b.type === 'Fuel') {
      scanVehicleFuelIntegrity(req.user.companyId, b.vehicleId).catch(console.error);
    }

    res.status(201).json({ expense: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to log expense' } });
  }
});

router.get('/', authRequired, requireRoles('supervisor', 'manager', 'admin', 'driver'), async (req, res) => {
  try {
    const { vehicleId, from, to } = req.query;
    const params = [req.user.companyId];
    let sql = `SELECT e.*, v.code AS vehicle_code FROM expenses e
               JOIN vehicles v ON v.id = e.vehicle_id
               WHERE e.company_id = $1`;
    if (vehicleId) {
      params.push(vehicleId);
      sql += ` AND e.vehicle_id = $${params.length}`;
    }
    if (from) {
      params.push(from);
      sql += ` AND COALESCE(e.purchased_at, e.logged_at::date) >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND COALESCE(e.purchased_at, e.logged_at::date) <= $${params.length}`;
    }
    sql += ` ORDER BY e.logged_at DESC LIMIT 200`;
    const { rows } = await query(sql, params);
    res.json({ expenses: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to list expenses' } });
  }
});

module.exports = router;
