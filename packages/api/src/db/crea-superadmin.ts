/**
 * Crea (o reimposta) l'accesso SUPERADMIN, quello che vede tutti i ristoranti.
 *
 *   npm run crea-superadmin --workspace=packages/api -- <email> <password>
 *
 * Il superadmin NON sta nella tabella "users" insieme ai titolari: ha una
 * tabella sua, "superadmins", perche' non appartiene a nessun ristorante.
 * Se l'email esiste gia', la password viene semplicemente aggiornata.
 */
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

const [emailArg, password] = process.argv.slice(2);

if (!emailArg || !password) {
  console.error('Uso: npm run crea-superadmin --workspace=packages/api -- <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('La password deve avere almeno 8 caratteri.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env.');
  process.exit(1);
}

const email = emailArg.toLowerCase().trim();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // La tabella dovrebbe gia' esistere (migrazione 004): la creiamo comunque
  // se manca, cosi' lo script funziona anche su un database nuovo.
  await db.query(`CREATE TABLE IF NOT EXISTS superadmins (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`);

  const hash = await bcrypt.hash(password, 10);
  const out = await db.query(
    `INSERT INTO superadmins (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING email`,
    [email, hash]
  );

  const quanti = await db.query('SELECT COUNT(*)::int AS n FROM superadmins');

  console.log('\nAccesso superadmin pronto');
  console.log(`  email:    ${out.rows[0].email}`);
  console.log(`  password: ${password}`);
  console.log(`  superadmin registrati in totale: ${quanti.rows[0].n}`);
  await db.end();
}

main().catch(err => { console.error('Errore:', err.message); process.exit(1); });
