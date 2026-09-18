/**
 * Toglie un ristorante creato per errore, con tutto quello che gli sta sotto.
 * Serve a ripulire i doppioni "demo-xxx" nati prima di adottare is_demo.
 *
 *   node prospezione/togli-doppione.mjs demo-amalfi-restaurant-bondi-beach
 *   node prospezione/togli-doppione.mjs --elenco-demo-vecchie
 *
 * Non tocca MAI un ristorante che non abbia lo slug che gli passi, e mostra
 * cosa sta per cancellare prima di farlo.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
function daEnv(n) {
  if (process.env[n]) return process.env[n];
  const env = join(RADICE, '.env');
  if (!existsSync(env)) return '';
  for (const r of readFileSync(env, 'utf-8').split('\n')) {
    const t = r.trim();
    if (t.startsWith(n + '=')) return t.slice(n.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

const slug = process.argv[2];
const pool = new pg.Pool({ connectionString: daEnv('DATABASE_URL') });

if (!slug || slug === '--elenco-demo-vecchie') {
  const r = await pool.query(
    `SELECT r.slug, r.name, COUNT(d.id)::int AS piatti
       FROM restaurants r LEFT JOIN dishes d ON d.restaurant_id = r.id
      WHERE r.slug LIKE 'demo-%' GROUP BY r.id ORDER BY r.name`);
  console.log(`\nRistoranti con lo slug vecchio "demo-...": ${r.rows.length}`);
  r.rows.forEach(x => console.log(`  ${x.slug.padEnd(42)} ${String(x.piatti).padStart(3)} piatti  ${x.name}`));
  console.log(`\nPer toglierne uno:  node prospezione/togli-doppione.mjs <slug>`);
  await pool.end();
  process.exit(0);
}

const r = await pool.query(
  `SELECT r.id, r.name, r.is_demo,
          (SELECT COUNT(*) FROM dishes WHERE restaurant_id = r.id)::int AS piatti
     FROM restaurants r WHERE r.slug = $1`, [slug]);

if (!r.rows.length) { console.log(`Nessun ristorante con slug "${slug}".`); await pool.end(); process.exit(0); }

const x = r.rows[0];
console.log(`\nSto per cancellare:`);
console.log(`  ${x.name}  (slug ${slug}, ${x.piatti} piatti)`);
console.log(`  con i suoi piatti, traduzioni e tavoli.`);

await pool.query('DELETE FROM restaurants WHERE id = $1', [x.id]);
console.log(`\nFatto.`);
await pool.end();
