const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Supabase
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

/**
 * Execute a parameterized query safely.
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {Array}  params - parameter values
 */
const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
