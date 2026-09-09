/**
 * Applica le migrazioni non ancora eseguite, in ordine, una alla volta.
 *
 *   npm run migrate:all --workspace=packages/api
 *
 * Tiene il conto in una tabella schema_migrations. Alla prima esecuzione
 * considera gia' applicate le migrazioni fino alla 004 (erano state lanciate
 * a mano), quindi parte dalla 005.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env.');
  process.exit(1);
}

const cartella = join(__dirname, '../../../../database/migrations');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  const files = readdirSync(cartella).filter(f => f.endsWith('.sql')).sort();
  const gia = await db.query('SELECT name FROM schema_migrations');
  const applicate = new Set(gia.rows.map(r => r.name));

  // primo avvio: segna come gia' fatte quelle vecchie
  if (applicate.size === 0) {
    for (const f of files.filter(f => f < '005')) {
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
      applicate.add(f);
      console.log(`(gia' applicata in precedenza) ${f}`);
    }
  }

  let nuove = 0;
  for (const f of files) {
    if (applicate.has(f)) continue;
    const sql = readFileSync(join(cartella, f), 'utf-8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log(`applicata: ${f}`);
      nuove++;
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error(`ERRORE in ${f}: ${err.message}`);
      client.release();
      await db.end();
      process.exit(1);
    }
    client.release();
  }

  console.log(nuove === 0 ? '\nNiente da applicare, database gia' + "' aggiornato." : `\n${nuove} migrazioni applicate.`);
  await db.end();
}

main().catch(err => { console.error('Errore:', err.message); process.exit(1); });
