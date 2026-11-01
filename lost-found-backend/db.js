const { Pool } = require('pg');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL is not set. The deployment environment should provide it.');
}

const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  ssl: SUPABASE_DB_URL ? { rejectUnauthorized: false } : false,
});

pool.on('connect', (conn) => {
  conn.query("SET timezone TO 'UTC'");
});

async function initDatabase() {
  const res = await pool.query(`
    SELECT to_regclass('public.users') AS users,
           to_regclass('public.items') AS items,
           to_regclass('public.item_photos') AS photos
  `);
  if (!res.rows[0].users || !res.rows[0].items || !res.rows[0].photos) {
    throw new Error('Database tables not found. Ensure migrations have been applied.');
  }
}

module.exports = { pool, initDatabase };
