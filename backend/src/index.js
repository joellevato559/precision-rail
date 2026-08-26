const express = require('express');
const cors = require('cors');
const config = require('./config');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const ingestRoutes = require('./routes/ingest');
const fleetRoutes = require('./routes/fleet');
const sessionsRoutes = require('./routes/sessions');
const drivesRoutes = require('./routes/drives');
const meRoutes = require('./routes/me');
const dutyRoutes = require('./routes/duty');
const inspectionsRoutes = require('./routes/inspections');
const expensesRoutes = require('./routes/expenses');
const payrollRoutes = require('./routes/payroll');
const integrityRoutes = require('./routes/integrity');
const auditRoutes = require('./routes/audit');
const simulateRoutes = require('./routes/simulate');
const maintenanceRoutes = require('./routes/maintenance');
const notificationsRoutes = require('./routes/notifications');
let usersRoutes;
try {
  usersRoutes = require('./routes/users');
} catch (e) {
  console.warn('[boot] users routes unavailable:', e.message);
  const express = require('express');
  usersRoutes = express.Router();
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use(healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/ingest', ingestRoutes);
app.use('/api/v1/fleet', fleetRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/drives', drivesRoutes);
app.use('/api/v1/me', meRoutes);
app.use('/api/v1/duty-status', dutyRoutes);
app.use('/api/v1/inspections', inspectionsRoutes);
app.use('/api/v1/expenses', expensesRoutes);
app.use('/api/v1/payroll', payrollRoutes);
app.use('/api/v1/integrity', integrityRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/simulate', simulateRoutes);
app.use('/api/v1/maintenance', maintenanceRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/users', usersRoutes);

app.get('/api/v1', (_req, res) => {
  res.json({
    name: 'Precision Rail Time and Mileage API',
    version: '1.0.0-mvp',
    integrations: 'See docs/INTEGRATIONS.md — plug in trackers, fuel cards, accounting later',
    endpoints: [
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/forgot-password',
      'POST /api/v1/auth/reset-password',
      'GET  /api/v1/me/today',
      'POST /api/v1/sessions/clock-in|clock-out',
      'POST /api/v1/drives/start|end',
      'POST /api/v1/duty-status',
      'POST /api/v1/inspections',
      'POST /api/v1/expenses',
      'GET  /api/v1/fleet/live',
      'GET  /api/v1/payroll/preview',
      'POST /api/v1/payroll/export',
      'GET  /api/v1/payroll/pending-sessions',
      'POST /api/v1/payroll/sessions/:id/approve',
      'GET  /api/v1/integrity/flags',
      'POST /api/v1/integrity/scan',
      'GET  /api/v1/audit',
      'POST /api/v1/ingest/positions',
      'POST /api/v1/simulate/trip',
      'GET  /api/v1/maintenance/alerts',
      'GET  /api/v1/maintenance/schedules',
      'POST /api/v1/maintenance/schedules',
      'POST /api/v1/maintenance/complete',
      'POST /api/v1/notifications/register-device',
      'POST /api/v1/notifications/test',
      'POST /api/v1/notifications/broadcast',
      'GET  /api/v1/users',
      'POST /api/v1/users',
      'POST /api/v1/users/:id/password',
      'PATCH /api/v1/users/:id'
    ]
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Unexpected error' } });
});

app.listen(config.port, () => {
  console.log(`Precision Rail API v1.0-mvp on :${config.port}`);
});
