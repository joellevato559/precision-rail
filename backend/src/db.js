const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) {
  console.warn('[db] DATABASE_URL not set — database calls will fail until configured.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
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
