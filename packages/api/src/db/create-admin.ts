import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from './client';

async function main() {
  const hash = await bcrypt.hash('superadmin123', 10);
  const r = await db.query(
    `INSERT INTO users (restaurant_id, email, password_hash, role)
     VALUES ('11111111-1111-1111-1111-111111111111', 'admin@restaurant.ai', $1, 'superadmin')
     ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'superadmin'
     RETURNING email, role`,
    [hash]
  );
  console.log('✅ Superadmin:', r.rows[0].email, '/', r.rows[0].role);
  await db.end();
}

main().catch(console.error);
