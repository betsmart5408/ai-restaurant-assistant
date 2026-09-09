/**
 * Carica nel database le traduzioni gia' pronte dai file JSON di database/traduzioni/.
 *
 *   npm run load-translations --workspace=packages/api -- <slug>
 *
 * Ogni file si chiama <slug>.<lingua>.json e contiene:
 *   { "Nome del piatto": "descrizione tradotta", ... }
 *
 * Le traduzioni vengono salvate come 'manual', quindi il traduttore automatico
 * non le sovrascrivera' mai.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

const slug = process.argv[2] || 'gusto-alcazabilla';
const cartella = join(__dirname, '../../../../database/traduzioni');

if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env.');
  process.exit(1);
}
if (!existsSync(cartella)) {
  console.error(`Cartella non trovata: ${cartella}`);
  process.exit(1);
}

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // la tabella (idempotente)
  await db.query(readFileSync(join(cartella, '../migrations/005_dish_translations.sql'), 'utf-8'));

  const r = await db.query('SELECT id, name FROM restaurants WHERE slug = $1', [slug]);
  if (r.rows.length === 0) {
    console.error(`Nessun ristorante con slug "${slug}".`);
    process.exit(1);
  }
  const restaurantId = r.rows[0].id;

  const piatti = await db.query('SELECT id, name FROM dishes WHERE restaurant_id = $1', [restaurantId]);
  const perNome = new Map<string, string>();
  for (const p of piatti.rows) perNome.set(p.name.trim().toLowerCase(), p.id);

  const files = readdirSync(cartella).filter(f => f.startsWith(slug + '.') && f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`Nessun file di traduzione per "${slug}" in ${cartella}`);
    process.exit(1);
  }

  console.log(`\nRistorante: ${r.rows[0].name}`);
  console.log(`Piatti nel database: ${piatti.rows.length}`);
  console.log(`File trovati: ${files.length}\n`);

  let totale = 0;
  const nonTrovati = new Set<string>();

  for (const file of files) {
    const lang = file.replace(slug + '.', '').replace('.json', '');
    const dati: Record<string, string> = JSON.parse(readFileSync(join(cartella, file), 'utf-8'));
    let n = 0;

    for (const [nome, descrizione] of Object.entries(dati)) {
      const dishId = perNome.get(nome.trim().toLowerCase());
      if (!dishId) { nonTrovati.add(nome); continue; }
      await db.query(
        `INSERT INTO dish_translations (dish_id, lang, name, description, source)
         VALUES ($1, $2, $3, $4, 'manual')
         ON CONFLICT (dish_id, lang) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               source = 'manual',
               updated_at = NOW()`,
        [dishId, lang, nome, descrizione]
      );
      n++;
    }
    totale += n;
    console.log(`${lang}: ${n} piatti caricati`);
  }

  console.log(`\nTotale: ${totale} traduzioni nel database.`);
  if (nonTrovati.size > 0) {
    console.log(`\nQuesti nomi non esistono nel menu (probabilmente rinominati):`);
    [...nonTrovati].slice(0, 20).forEach(n => console.log('  - ' + n));
  }
  await db.end();
}

main().catch(err => {
  console.error('Errore:', err.message);
  process.exit(1);
});
