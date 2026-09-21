// Legge il database di produzione SENZA poterlo modificare.
// Uso: node packages/api/scripts/db-leggi.cjs "SELECT ..."
// La query gira dentro una transazione READ ONLY: INSERT/UPDATE/DELETE/DROP
// vengono rifiutati da Postgres stesso.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const sql = process.argv[2];
if (!sql) {
  console.error('Uso: node packages/api/scripts/db-leggi.cjs "SELECT ..."');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN TRANSACTION READ ONLY');
    const r = await c.query(sql);
    console.table(r.rows);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
