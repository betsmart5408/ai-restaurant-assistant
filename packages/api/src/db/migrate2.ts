import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sql = readFileSync(
    join(__dirname, '../../../../database/migrations/002_pos_and_auth.sql'),
    'utf-8'
  );
  await db.query(sql);
  console.log('✅ Migration 002 completata (POS + Auth columns)');
  await db.end();
}

migrate().catch(err => {
  console.error('❌ Migration fallita:', err.message);
  process.exit(1);
});
