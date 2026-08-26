const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { getDriverForUser, getVehicleInCompany } = require('../services/drivers');
const { writeAudit } = require('../services/audit');

const router = express.Router();

router.post('/', authRequired, requireRoles('driver', 'supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { vehicleId, type, items, safeToOperate, notes } = req.body || {};
    if (!vehicleId || !['pretrip', 'posttrip'].includes(type) || !Array.isArray(items)) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'vehicleId, type (pretrip|posttrip), and items[] required' }
      });
    }
    if (typeof safeToOperate !== 'boolean') {
      return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'safeToOperate boolean required' } });
    }

    const driver = await getDriverForUser(req.user.sub, req.user.companyId);
    if (!driver) {
      return res.status(400).json({ error: { code: 'NO_DRIVER_PROFILE', message: 'No driver profile' } });
    }
    const vehicle = await getVehicleInCompany(vehicleId, req.user.companyId);
    if (!vehicle) {
      return res.status(404).json({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found' } });
    }

    const defectItems = items.filter((i) => i && i.status === 'defect');
    const defectCount = defectItems.length;

    const { rows } = await query(
      `INSERT INTO inspections
        (company_id, vehicle_id, driver_id, type, safe_to_operate, items, notes, defect_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.user.companyId,
        vehicleId,
        driver.id,
        type,
        safeToOperate,
        JSON.stringify(items),
        notes || null,
        defectCount
      ]
    );
    const inspection = rows[0];

    for (const d of defectItems) {
      await query(
        `INSERT INTO defects (company_id, inspection_id, vehicle_id, item_name, description, status)
         VALUES ($1,$2,$3,$4,$5,'open')`,
        [req.user.companyId, inspection.id, vehicleId, d.name || 'Item', d.note || notes || null]
      );
    }

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: `inspection_${type}`,
      entityType: 'inspection',
      entityId: inspection.id,
      vehicleId,
      detail: `${type}: ${defectCount} defect(s), safe=${safeToOperate}`
    });

    res.status(201).json({ inspection });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Inspection save failed' } });
  }
});

module.exports = router;
