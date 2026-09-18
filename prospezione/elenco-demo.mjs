/**
 * Elenca i ristoranti nel database, dice quali sono demo create da noi e
 * quali no, e stampa il link di ognuno.
 *
 *   node prospezione/elenco-demo.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MENU_PUBBLICO = 'https://restaurant-chat-gustobolsa.vercel.app';

function daEnv(nome) {
  if (process.env[nome]) return process.env[nome];
  const env = join(RADICE, '.env');
  if (!existsSync(env)) return '';
  for (const riga of readFileSync(env, 'utf-8').split('\n')) {
    const t = riga.trim();
    if (t.startsWith(nome + '=')) return t.slice(nome.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

const pool = new pg.Pool({ connectionString: daEnv('DATABASE_URL') });
const r = await pool.query(`
  SELECT r.slug, r.name, r.created_at, r.city,
         COUNT(DISTINCT d.id)::int AS piatti,
         COUNT(DISTINCT t.id)::int AS traduzioni
  FROM restaurants r
  LEFT JOIN dishes d ON d.restaurant_id = r.id
  LEFT JOIN dish_translations t ON t.dish_id = d.id
  GROUP BY r.id ORDER BY r.created_at
`);

const demo = r.rows.filter(x => x.slug.startsWith('demo-'));
const altri = r.rows.filter(x => !x.slug.startsWith('demo-'));

const stampa = (righe) => righe.forEach(x => {
  console.log(`  ${x.name.slice(0, 32).padEnd(34)} ${String(x.piatti).padStart(3)} piatti  ${String(x.traduzioni).padStart(4)} traduzioni  ${new Date(x.created_at).toLocaleDateString('it-IT')}`);
  console.log(`     ${MENU_PUBBLICO}/?restaurant=${x.slug}`);
});

console.log(`\n── DEMO create da noi (slug che inizia con "demo-"): ${demo.length} ──`);
demo.length ? stampa(demo) : console.log('  nessuna');
console.log(`\n── Altri ristoranti (gia' presenti prima): ${altri.length} ──`);
altri.length ? stampa(altri) : console.log('  nessuno');
console.log(`\nTotale: ${r.rows.length}`);
await pool.end();
