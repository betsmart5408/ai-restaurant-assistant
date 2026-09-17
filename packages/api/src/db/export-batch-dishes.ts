/**
 * Esporta i piatti (id, name, description) dei ristoranti elencati in un file
 * di slug (uno per riga), in JSON compatto pronto per essere tradotto.
 * Usato solo per la traduzione manuale in blocco delle demo — non fa parte
 * del prodotto in produzione.
 *
 *   tsx src/db/export-batch-dishes.ts <file-slug.txt> <file-output.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

const fileSlug = process.argv[2];
const fileOut = process.argv[3];
if (!fileSlug || !fileOut) {
  console.error('Uso: tsx src/db/export-batch-dishes.ts <file-slug.txt> <file-output.json>');
  process.exit(1);
}

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const slugs = readFileSync(fileSlug, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean);
  const r = await db.query(
    `SELECT d.id, d.name, d.description, r.slug
     FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id
     WHERE r.slug = ANY($1::text[])
     ORDER BY r.slug, d.category, d.sort_order`,
    [slugs]
  );
  // Una riga JSON per piatto (JSONL): permette di leggere il file a pagine
  // con Read offset/limit invece di dover caricare un'unica riga enorme.
  writeFileSync(fileOut, r.rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  console.log(`Esportati ${r.rows.length} piatti di ${slugs.length} ristoranti in ${fileOut}`);
  await db.end();
}

main().catch(err => { console.error('Errore:', err.message); process.exit(1); });
