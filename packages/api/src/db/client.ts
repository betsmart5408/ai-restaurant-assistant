import { Pool } from 'pg';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

db.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});
