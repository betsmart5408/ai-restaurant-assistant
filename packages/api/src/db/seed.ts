import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const sql = readFileSync(
    join(__dirname, '../../../../database/seeds/001_demo_restaurant.sql'),
    'utf-8'
  );
  await db.query(sql);
  console.log('✅ Seed completato — Ristorante Da Mario pronto');
  await db.end();
}

seed().catch(err => {
  console.error('❌ Seed fallito:', err.message);
  process.exit(1);
});
