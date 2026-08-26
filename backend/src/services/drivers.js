const { query } = require('../db');

async function getDriverForUser(userId, companyId) {
  const { rows } = await query(
    `SELECT d.* FROM drivers d
     WHERE d.user_id = $1 AND d.company_id = $2
     LIMIT 1`,
    [userId, companyId]
  );
  return rows[0] || null;
}

async function getVehicleInCompany(vehicleId, companyId) {
  const { rows } = await query(
    `SELECT * FROM vehicles WHERE id = $1 AND company_id = $2 AND active = true LIMIT 1`,
    [vehicleId, companyId]
  );
  return rows[0] || null;
}

async function getCompany(companyId) {
  const { rows } = await query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
  return rows[0] || null;
}

module.exports = { getDriverForUser, getVehicleInCompany, getCompany };
