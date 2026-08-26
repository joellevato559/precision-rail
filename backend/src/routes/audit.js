const express = require('express');
const { query } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const params = [req.user.companyId];
    let sql = `SELECT * FROM audit_events WHERE company_id = $1`;
    if (req.query.vehicleId) {
      params.push(req.query.vehicleId);
      sql += ` AND vehicle_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 200`;
    const { rows } = await query(sql, params);
    res.json({ events: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load audit' } });
  }
});

module.exports = router;
