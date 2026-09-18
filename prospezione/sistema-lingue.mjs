/**
 * Allinea le lingue DICHIARATE da ogni ristorante a quelle che ha DAVVERO
 * tradotte nel database.
 *
 *   node prospezione/sistema-lingue.mjs            mostra cosa cambierebbe
 *   node prospezione/sistema-lingue.mjs --applica  lo fa davvero
 *
 * Serve perche' l'app mostra al cliente solo le lingue elencate nel campo
 * "languages". Se il campo dice due lingue ma le traduzioni sono nove, il
 * cliente vede due bandierine e le altre sette non le trova nessuno.
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

// Solo le lingue che l'app sa mostrare: dichiararne una che non ha etichetta
// significherebbe un bottone invisibile.
const SUPPORTATE = ['en','it','es','de','fr','pt','ru','ar','zh','ja','ko','id','hi'];
const applica = process.argv.includes('--applica');
const pool = new pg.Pool({ connectionString: daEnv('DATABASE_URL') });

const r = await pool.query(`
  SELECT r.id, r.slug, r.name, r.base_lang, r.languages,
         COALESCE(ARRAY_AGG(DISTINCT t.lang) FILTER (WHERE t.lang IS NOT NULL), '{}') AS tradotte,
         COUNT(DISTINCT d.id)::int AS piatti
    FROM restaurants r
    LEFT JOIN dishes d ON d.restaurant_id = r.id
    LEFT JOIN dish_translations t ON t.dish_id = d.id
   GROUP BY r.id ORDER BY r.name`);

console.log('');
let daSistemare = 0;
for (const x of r.rows) {
  const base = x.base_lang || 'en';
  // la lingua originale c'e' sempre: le descrizioni originali sono nei piatti
  const vere = [...new Set([base, ...x.tradotte])].filter(l => SUPPORTATE.includes(l));
  const ordinate = SUPPORTATE.filter(l => vere.includes(l));
  const attuali = (x.languages || []).join(',');
  const nuove = ordinate.join(',');

  if (attuali === nuove) {
    console.log(`  ok        ${x.name.slice(0,30).padEnd(32)} ${ordinate.length} lingue`);
    continue;
  }
  daSistemare++;
  console.log(`  DA SISTEMARE ${x.name.slice(0,28).padEnd(30)} ${x.piatti} piatti`);
  console.log(`      dichiara : ${attuali || '(niente)'}`);
  console.log(`      ha invece: ${nuove}`);
  if (applica) {
    await pool.query('UPDATE restaurants SET languages = $1 WHERE id = $2', [ordinate, x.id]);
    console.log(`      -> aggiornato`);
  }
}

console.log('');
if (daSistemare === 0) console.log('Tutti allineati, niente da fare.');
else if (applica)      console.log(`${daSistemare} ristoranti sistemati.`);
else                   console.log(`${daSistemare} da sistemare. Rilancia con --applica per farlo davvero.`);
await pool.end();
