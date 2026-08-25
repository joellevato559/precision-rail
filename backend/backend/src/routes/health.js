const express = require('express');
const { pool } = require('../db');
const { fcmStatus, PROVIDER } = require('../services/notify');

const router = express.Router();

router.get('/health', async (_req, res) => {
  let db = 'unknown';
  try {
    await pool.query('SELECT 1');
    db = 'ok';
  } catch {
    db = 'error';
  }
  res.json({
    service: 'precision-rail-api',
    status: 'ok',
    db,
    notify: fcmStatus(),
    time: new Date().toISOString()
  });
});

module.exports = router;
