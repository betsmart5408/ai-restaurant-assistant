import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sql = readFileSync(
    join(__dirname, '../../../../database/migrations/001_initial_schema.sql'),
    'utf-8'
  );
  await db.query(sql);
  console.log('✅ Migration completata');
  await db.end();
}

migrate().catch(err => {
  console.error('❌ Migration fallita:', err.message);
  process.exit(1);
});
