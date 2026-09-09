/**
 * Crea (o reimposta) l'accesso del titolare alla dashboard di un ristorante.
 *
 *   npm run crea-utente --workspace=packages/api -- <slug> <email> <password> [ruolo]
 *
 * Esempio:
 *   npm run crea-utente --workspace=packages/api -- gusto-alcazabilla titolare@gusto.es MiaPassword123
 *
 * Se l'email esiste gia', la password viene semplicemente aggiornata.
 * Serve per ogni cliente nuovo: un ristorante, un accesso.
 */
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

const [slug, email, password, ruolo = 'owner'] = process.argv.slice(2);

if (!slug || !email || !password) {
  console.error('Uso: npm run crea-utente --workspace=packages/api -- <slug> <email> <password> [ruolo]');
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

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await db.query('SELECT id, name FROM restaurants WHERE slug = $1', [slug]);
  if (r.rows.length === 0) {
    console.error(`Nessun ristorante con slug "${slug}".`);
    const tutti = await db.query('SELECT slug, name FROM restaurants ORDER BY name');
    if (tutti.rows.length) {
      console.error('\nRistoranti presenti:');
      tutti.rows.forEach((x: any) => console.error(`  ${x.slug}  (${x.name})`));
    }
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const out = await db.query(
    `INSERT INTO users (restaurant_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           restaurant_id = EXCLUDED.restaurant_id,
           role = EXCLUDED.role
     RETURNING email, role`,
    [r.rows[0].id, email.toLowerCase().trim(), hash, ruolo]
  );

  console.log(`\nAccesso pronto per ${r.rows[0].name}`);
  console.log(`  email:    ${out.rows[0].email}`);
  console.log(`  password: ${password}`);
  console.log(`  ruolo:    ${out.rows[0].role}`);
  await db.end();
}

main().catch(err => { console.error('Errore:', err.message); process.exit(1); });
