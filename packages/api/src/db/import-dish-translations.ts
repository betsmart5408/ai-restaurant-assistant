/**
 * Carica in blocco traduzioni piatti gia' pronte (generate a mano/da Claude in
 * chat, non dal motore Groq) da un file JSON.
 *
 * Formato del file:
 *   [
 *     { "dish_id": "uuid", "translations": { "ko": { "name": "...", "description": "..." }, "id": {...}, ... } },
 *     ...
 *   ]
 *
 * Scrive a blocchi (multi-riga per query, dentro una transazione) invece che
 * una query per riga: su centinaia di migliaia di righe la differenza e'
 * ore contro minuti.
 *
 * Le correzioni fatte a mano da un vero ristoratore (source='manual' su un
 * ristorante NON demo) non vengono MAI toccate. Sulle demo invece esistono
 * righe 'manual' che sono in realta' segnaposto lasciati da un processo
 * precedente (identiche al nome originale, nessun ristoratore le ha mai
 * potute correggere: le demo non hanno un pannello a cui accedere) — quelle
 * si possono sovrascrivere.
 *
 *   npm run import-dish-translations --workspace=packages/api -- <file.json>
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run import-dish-translations --workspace=packages/api -- <file.json>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env della cartella principale del progetto.');
  process.exit(1);
}

interface Riga {
  dish_id: string;
  translations: Record<string, { name?: string; description?: string }>;
}

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const BLOCCO = 300; // righe per query

async function main() {
  const righe: Riga[] = JSON.parse(readFileSync(file, 'utf-8'));

  const flat: { dish_id: string; lang: string; name: string; description: string }[] = [];
  let saltate = 0;
  for (const riga of righe) {
    if (!riga.dish_id || !riga.translations) continue;
    for (const [lang, t] of Object.entries(riga.translations)) {
      const name = (t.name ?? '').trim();
      const description = (t.description ?? '').trim();
      if (!name) { saltate++; continue; }
      flat.push({ dish_id: riga.dish_id, lang, name, description });
    }
  }

  const client = await db.connect();
  let scritte = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < flat.length; i += BLOCCO) {
      const blocco = flat.slice(i, i + BLOCCO);
      const r = await client.query(
        `INSERT INTO dish_translations (dish_id, lang, name, description, source)
         SELECT x.dish_id, x.lang, x.name, x.description, 'auto'
         FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::text[]) AS x(dish_id, lang, name, description)
         ON CONFLICT (dish_id, lang) DO UPDATE
           SET name = EXCLUDED.name, description = EXCLUDED.description, source = 'auto', updated_at = NOW()
         WHERE dish_translations.source IS DISTINCT FROM 'manual'
            OR EXISTS (
                 SELECT 1 FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id
                 WHERE d.id = dish_translations.dish_id AND r.is_demo = TRUE
               )`,
        [
          blocco.map(b => b.dish_id),
          blocco.map(b => b.lang),
          blocco.map(b => b.name),
          blocco.map(b => b.description),
        ]
      );
      scritte += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`Traduzioni scritte/aggiornate: ${scritte}${saltate ? ` (saltate ${saltate} senza nome)` : ''}`);
  await db.end();
}

main().catch(err => {
  console.error('Errore:', err.message);
  process.exit(1);
});
