const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db');
const { authRequired, requireRoles } = require('../middleware/auth');
const { writeAudit } = require('../services/audit');

const router = express.Router();

const ALLOWED_ROLES = ['driver', 'supervisor', 'manager', 'admin'];

/** List users in the company */
router.get('/', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
              d.id AS driver_id, d.employee_code, d.work_rate_hourly, d.drive_rate_hourly,
              d.license_number, d.license_state
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id
       WHERE u.company_id = $1
       ORDER BY u.role, u.name`,
      [req.user.companyId]
    );
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to list users' } });
  }
});

/**
 * Create a user (and driver profile when role is driver).
 * Body: { email, password, name, role, employeeCode?, workRate?, driveRate?, licenseNumber?, licenseState? }
 */
router.post('/', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      role = 'driver',
      employeeCode,
      workRate,
      driveRate,
      licenseNumber,
      licenseState
    } = req.body || {};

    if (!email || !password || !name) {
      return res.status(400).json({
        error: { code: 'INVALID_BODY', message: 'email, password, and name are required' }
      });
    }
    if (String(password).length < 8) {
      return res.status(400).json({
        error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' }
      });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        error: { code: 'INVALID_ROLE', message: `role must be one of: ${ALLOWED_ROLES.join(', ')}` }
      });
    }

    const hash = await bcrypt.hash(String(password), 10);

    const created = await withTransaction(async (client) => {
      const userIns = await client.query(
        `INSERT INTO users (company_id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, active, created_at`,
        [req.user.companyId, String(email).toLowerCase().trim(), hash, String(name).trim(), role]
      );
      const user = userIns.rows[0];

      let driver = null;
      if (role === 'driver' || role === 'supervisor') {
        const dIns = await client.query(
          `INSERT INTO drivers (
             user_id, company_id, employee_code, work_rate_hourly, drive_rate_hourly,
             license_number, license_state
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, employee_code, work_rate_hourly, drive_rate_hourly`,
          [
            user.id,
            req.user.companyId,
            employeeCode || null,
            workRate != null ? Number(workRate) : 25,
            driveRate != null ? Number(driveRate) : 30,
            licenseNumber || null,
            licenseState ? String(licenseState).slice(0, 2).toUpperCase() : null
          ]
        );
        driver = dIns.rows[0];
      }

      return { user, driver };
    });

    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'user.create',
      detail: `Created ${created.user.role} ${created.user.email}`
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: { code: 'EMAIL_EXISTS', message: 'A user with that email already exists' }
      });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to create user' } });
  }
});

/** Reset password */
router.post('/:id/password', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({
        error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' }
      });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const { rowCount } = await query(
      `UPDATE users SET password_hash = $1, updated_at = now()
       WHERE id = $2 AND company_id = $3`,
      [hash, req.params.id, req.user.companyId]
    );
    if (!rowCount) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    await writeAudit({
      companyId: req.user.companyId,
      actorUserId: req.user.sub,
      actorName: req.user.name,
      action: 'user.password_reset',
      detail: `Password reset for user ${req.params.id}`
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to reset password' } });
  }
});

/** Update name, role, active, and pay rates */
router.patch('/:id', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    const { active, name, role, workRate, driveRate, employeeCode } = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;
    if (typeof active === 'boolean') {
      sets.push(`active = $${i++}`);
      params.push(active);
    }
    if (name) {
      sets.push(`name = $${i++}`);
      params.push(String(name).trim());
    }
    if (role && ALLOWED_ROLES.includes(role)) {
      sets.push(`role = $${i++}`);
      params.push(role);
    }
    if (sets.length) {
      sets.push('updated_at = now()');
      params.push(req.params.id, req.user.companyId);
      const { rows } = await query(
        `UPDATE users SET ${sets.join(', ')}
         WHERE id = $${i++} AND company_id = $${i}
         RETURNING id, email, name, role, active`,
        params
      );
      if (!rows[0]) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
    } else {
      const { rows } = await query(
        `SELECT id, email, name, role, active FROM users WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.companyId]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
    }

    const driverSets = [];
    const driverParams = [];
    let d = 1;
    if (workRate != null && workRate !== '') {
      driverSets.push(`work_rate_hourly = $${d++}`);
      driverParams.push(Number(workRate));
    }
    if (driveRate != null && driveRate !== '') {
      driverSets.push(`drive_rate_hourly = $${d++}`);
      driverParams.push(Number(driveRate));
    }
    if (employeeCode != null) {
      driverSets.push(`employee_code = $${d++}`);
      driverParams.push(String(employeeCode).trim() || null);
    }
    if (driverSets.length) {
      driverParams.push(req.params.id, req.user.companyId);
      await query(
        `UPDATE drivers SET ${driverSets.join(', ')}
         WHERE user_id = $${d++} AND company_id = $${d}`,
        driverParams
      );
    }

    const { rows } = await query(
      `SELECT u.id, u.email, u.name, u.role, u.active,
              d.employee_code, d.work_rate_hourly, d.drive_rate_hourly
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id
       WHERE u.id = $1 AND u.company_id = $2`,
      [req.params.id, req.user.companyId]
    );
    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to update user' } });
  }
});

/** Remove a user and their time / drive records. */
router.delete('/:id', authRequired, requireRoles('manager', 'admin'), async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.sub)) {
      return res.status(400).json({
        error: { code: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own login' }
      });
    }

    const found = await query(
      `SELECT u.id, u.email, d.id AS driver_id
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id
       WHERE u.id = $1 AND u.company_id = $2`,
      [req.params.id, req.user.companyId]
    );
    if (!found.rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const userId = found.rows[0].id;
    const driverId = found.rows[0].driver_id;
    const companyId = req.user.companyId;

    await withTransaction(async (client) => {
      const q = (sql, params) => client.query(sql, params);

      await q(`UPDATE work_sessions SET approved_by = NULL WHERE approved_by = $1 AND company_id = $2`, [userId, companyId]);
      await q(`UPDATE defects SET resolved_by = NULL WHERE resolved_by = $1 AND company_id = $2`, [userId, companyId]);
      await q(`UPDATE pay_periods SET exported_by = NULL WHERE exported_by = $1 AND company_id = $2`, [userId, companyId]);
      await q(`UPDATE maintenance_logs SET performed_by = NULL WHERE performed_by = $1 AND company_id = $2`, [userId, companyId]);

      if (driverId) {
        await q(`DELETE FROM pay_period_lines WHERE driver_id = $1`, [driverId]);
        await q(`DELETE FROM work_sessions WHERE driver_id = $1 AND company_id = $2`, [driverId, companyId]);
        await q(`DELETE FROM drive_segments WHERE driver_id = $1 AND company_id = $2`, [driverId, companyId]);
        await q(`DELETE FROM duty_status_events WHERE driver_id = $1 AND company_id = $2`, [driverId, companyId]);
        await q(`DELETE FROM inspections WHERE driver_id = $1 AND company_id = $2`, [driverId, companyId]);
        await q(`DELETE FROM expenses WHERE driver_id = $1 AND company_id = $2`, [driverId, companyId]);
        await q(`DELETE FROM drivers WHERE id = $1 AND company_id = $2`, [driverId, companyId]);
      }

      try {
        await q(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
      } catch (e) { /* table may not exist */ }

      await q(`DELETE FROM users WHERE id = $1 AND company_id = $2`, [userId, companyId]);
    });

    res.json({ ok: true, removed: true, email: found.rows[0].email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to delete user' } });
  }
});

module.exports = router;
