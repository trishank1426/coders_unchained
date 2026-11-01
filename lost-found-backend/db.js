const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'lost_found';
if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) {
  throw new Error('DB_NAME may only contain letters, numbers and underscores.');
}

const connection = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  // Managed MySQL services usually require an encrypted connection: set DB_SSL=true.
  ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
};

const pool = mysql.createPool({
  ...connection,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: ['DATE'], // keep DATE columns as "YYYY-MM-DD" strings
});

// Store and read every timestamp in UTC.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

// Creates the database (if allowed) and all tables.
async function initDatabase() {
  const conn = await mysql.createConnection({ ...connection, multipleStatements: true });
  try {
    try {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } catch (err) {
      console.warn(`Could not create database (${err.code}). Assuming "${DB_NAME}" already exists.`);
    }
    await conn.query(`USE \`${DB_NAME}\``);
    await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    // Databases created before the WhatsApp feature do not have the column yet.
    const [cols] = await conn.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'whatsapp'`,
      [DB_NAME]
    );
    if (!cols.length) await conn.query('ALTER TABLE users ADD COLUMN whatsapp VARCHAR(20) NULL AFTER password_hash');
  } finally {
    await conn.end();
  }
}

module.exports = { pool, initDatabase };
