const { query } = require('../db');

/**
 * Append-only audit entry. Never update/delete from application code.
 */
async function writeAudit({ companyId, actorUserId, actorName, action, entityType, entityId, vehicleId, detail }) {
  await query(
    `INSERT INTO audit_events
      (company_id, actor_user_id, actor_name, action, entity_type, entity_id, vehicle_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      companyId,
      actorUserId || null,
      actorName || null,
      action,
      entityType || null,
      entityId || null,
      vehicleId || null,
      detail || null
    ]
  );
}

module.exports = { writeAudit };
