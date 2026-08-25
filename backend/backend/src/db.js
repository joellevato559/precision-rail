const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  console.warn('[db] DATABASE_URL not set — database calls will fail until configured.');
}

const pool = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl, max: 20, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;

async function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
}

async function withTransaction(fn) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
