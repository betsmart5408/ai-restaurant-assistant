/**
 * Traduce i NOMI DELLE CATEGORIE del menu ("Charcoal Grill", "To Share",
 * "STARTERS") nelle lingue che il ristorante offre.
 *
 *   node prospezione/traduci-categorie.mjs                 tutte le demo
 *   node prospezione/traduci-categorie.mjs --slug al-aseel una sola
 *   node prospezione/traduci-categorie.mjs --prova         mostra e basta
 *
 * Fino a ora si traducevano solo i piatti: un turista cinese leggeva i piatti
 * in cinese ma le intestazioni delle sezioni restavano in inglese. Le scritte
 * finiscono nella tabella category_translations.
 *
 * Le righe scritte a mano (source='manual') non vengono mai sovrascritte.
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

const NOMI_LINGUA = {
  en: 'English', it: 'Italian', es: 'Spanish', de: 'German', fr: 'French',
  pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', zh: 'Simplified Chinese',
  ja: 'Japanese', ko: 'Korean', id: 'Indonesian', hi: 'Hindi',
};

// Le categorie interne di Gusto hanno gia' le etichette dentro l'app:
// tradurle di nuovo sarebbe uno spreco e rischierebbe di peggiorarle.
const GIA_TRADOTTE = ['antipasti','pizze','primi','secondi','dolci','cocktails','spirits','birre','vini','soft_drinks'];

const argomenti = process.argv.slice(2);
function opzione(nome) {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : '';
}
const soloSlug = opzione('--slug');
const soloProva = argomenti.includes('--prova');
const MODELLI = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

const chiaveGroq = daEnv('GROQ_API_KEY');
if (!chiaveGroq && !soloProva) { console.error('Manca GROQ_API_KEY nel file .env.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: daEnv('DATABASE_URL') });

function aspetta(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Una sola chiamata per lingua: poche parole, costo trascurabile. */
async function traduci(categorie, lingua, lingueOrigine) {
  const richiesta =
    `You are translating the section headings of a restaurant menu into ${NOMI_LINGUA[lingua] || lingua}.\n` +
    `These are category names (not dish names). Keep them SHORT: 1-3 words, like a menu heading.\n` +
    `Keep proper names and cooking styles recognisable (e.g. "Charcoal Grill", "Mezze").\n` +
    `Reply with ONLY a JSON object: the key is the original heading exactly as given, the value is the translation.\n\n` +
    `Original language: ${NOMI_LINGUA[lingueOrigine] || 'English'}\n` +
    `Headings:\n${categorie.map(c => '- ' + c).join('\n')}`;

  for (const modello of MODELLI) {
    for (let tentativo = 0; tentativo < 3; tentativo++) {
      const risposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chiaveGroq}` },
        body: JSON.stringify({
          model: modello, temperature: 0.1, max_tokens: 800,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: richiesta }],
        }),
      });
      if (risposta.status === 429) {
        const attesa = Number(risposta.headers.get('retry-after')) || 8;
        console.log(`      limite Groq, aspetto ${attesa}s`);
        await aspetta(attesa * 1000);
        continue;
      }
      if (!risposta.ok) break;
      const dati = await risposta.json();
      try {
        return JSON.parse(dati.choices?.[0]?.message?.content ?? '{}');
      } catch { break; }
    }
  }
  return null;
}

const filtro = soloSlug ? 'WHERE r.slug = $1' : '';
const parametri = soloSlug ? [soloSlug] : [];
const ristoranti = await pool.query(`
  SELECT r.id, r.slug, r.name, COALESCE(r.base_lang, 'en') AS base_lang, r.languages
    FROM restaurants r ${filtro} ORDER BY r.name`, parametri);

console.log('');
let scritte = 0;
for (const r of ristoranti.rows) {
  const cat = await pool.query(
    `SELECT DISTINCT category FROM dishes
      WHERE restaurant_id = $1 AND category IS NOT NULL AND category <> ''
      ORDER BY category`, [r.id]);
  const daFare = cat.rows.map(x => x.category).filter(c => !GIA_TRADOTTE.includes(c));

  const lingue = (r.languages || []).filter(l => l !== r.base_lang && NOMI_LINGUA[l]);
  if (daFare.length === 0 || lingue.length === 0) {
    console.log(`  salto     ${r.name.slice(0, 34).padEnd(36)} ${daFare.length} categorie / ${lingue.length} lingue`);
    continue;
  }

  console.log(`  ${r.name.slice(0, 34).padEnd(36)} ${daFare.length} categorie x ${lingue.length} lingue`);
  console.log(`      ${daFare.join(' | ')}`);
  if (soloProva) continue;

  for (const lingua of lingue) {
    // gia' fatte? (e mai toccare quelle scritte a mano)
    const esistenti = await pool.query(
      `SELECT category, source FROM category_translations
        WHERE restaurant_id = $1 AND lang = $2`, [r.id, lingua]);
    const aMano = new Set(esistenti.rows.filter(x => x.source === 'manual').map(x => x.category));
    const mancanti = daFare.filter(c => !aMano.has(c));
    if (mancanti.length === 0) continue;

    const tradotte = await traduci(mancanti, lingua, r.base_lang);
    if (!tradotte) { console.log(`      ${lingua}: non riuscita`); continue; }

    let n = 0;
    for (const c of mancanti) {
      const testo = String(tradotte[c] ?? '').trim();
      if (!testo || testo === c) continue;
      await pool.query(
        `INSERT INTO category_translations (restaurant_id, category, lang, name, source)
         VALUES ($1, $2, $3, $4, 'auto')
         ON CONFLICT (restaurant_id, category, lang)
         DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
         WHERE category_translations.source <> 'manual'`,
        [r.id, c, lingua, testo]);
      n++; scritte++;
    }
    console.log(`      ${lingua}: ${n} categorie`);
    await aspetta(700);
  }
}

console.log(soloProva ? '\nProva: niente scritto.' : `\nFatto: ${scritte} traduzioni di categoria salvate.`);
await pool.end();
