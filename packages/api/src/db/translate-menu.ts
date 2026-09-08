/**
 * Traduce UNA VOLTA SOLA il menu di un ristorante e salva le traduzioni nel database.
 * Da lanciare dal PC, non dal server:
 *
 *   npm run translate --workspace=packages/api -- <slug> [lingua-originale] [lingue,separate,da,virgola]
 *
 * Esempi:
 *   npm run translate --workspace=packages/api -- gusto-alcazabilla
 *   npm run translate --workspace=packages/api -- gusto-alcazabilla es it,en,de
 *   npm run translate --workspace=packages/api -- gusto-alcazabilla es "" --force
 *
 * Rilanciarlo e' sicuro: salta cio' che e' gia' tradotto e non tocca mai le
 * correzioni fatte a mano (source='manual').
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';
import Groq from 'groq-sdk';

// npm avvia lo script dentro packages/api, ma il file .env sta nella cartella
// principale del progetto: lo cerchiamo li' e, per sicurezza, anche qui.
caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

const LANG_NAMES: Record<string, string> = {
  it: 'Italian', en: 'English', de: 'German', es: 'Spanish', fr: 'French',
  pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)', ja: 'Japanese', ar: 'Arabic',
};

// I nomi dei modelli cambiano nel tempo e quelli vecchi vengono spenti: invece di
// scriverli fissi qui, chiediamo a Groq quali sono disponibili con la tua chiave.
let MODELS: string[] = [];

const PREFERENZE = [
  'gpt-oss-120b', 'llama-3.3-70b', 'llama-4', 'maverick', 'qwen3', 'minimax',
  'gpt-oss-20b', 'llama-3.1-8b', 'gemma', 'compound',
];
const ESCLUDI = /whisper|tts|orpheus|guard|embed|rerank|moderation/i;

async function scopriModelli(): Promise<string[]> {
  if (process.env.GROQ_MODEL) return [process.env.GROQ_MODEL];
  const lista: any = await groq.models.list();
  const ids: string[] = (lista?.data || []).map((m: any) => m.id).filter(Boolean);
  const utilizzabili = ids.filter(id => !ESCLUDI.test(id));
  const punteggio = (id: string) => {
    const i = PREFERENZE.findIndex(p => id.toLowerCase().includes(p));
    return i === -1 ? 99 : i;
  };
  return utilizzabili.sort((a, b) => punteggio(a) - punteggio(b)).slice(0, 3);
}
const CHUNK_SIZE = 8;
const PAUSA_MS = 2200;          // resta sotto le 30 richieste/minuto del piano gratuito
const MAX_TENTATIVI = 2;

// Argomenti posizionali, ignorando i flag --xxx che possono capitare in mezzo.
const posizionali = process.argv.slice(2).filter(a => !a.startsWith('--'));
const slug = posizionali[0];
const baseLang = (posizionali[1] || 'es').toLowerCase();
const langsArg = (posizionali[2] || '').trim();
const force = process.argv.includes('--force');
// --claude: traduce con Claude (Anthropic), tutte le lingue in una chiamata
// per blocco. Niente limiti del piano gratuito Groq. Serve ANTHROPIC_API_KEY.
const usaClaude = process.argv.includes('--claude');
const MODELLO_CLAUDE = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

if (!slug) {
  console.error('Uso: npm run translate --workspace=packages/api -- <slug-ristorante> [lingua-originale] [lingue]');
  process.exit(1);
}

const targetLangs = (langsArg ? langsArg.split(',') : Object.keys(LANG_NAMES))
  .map(l => l.trim().toLowerCase())
  .filter(l => l && l !== baseLang && LANG_NAMES[l]);

if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env della cartella principale del progetto.');
  process.exit(1);
}
if (usaClaude && !process.env.ANTHROPIC_API_KEY) {
  console.error('--claude richiede ANTHROPIC_API_KEY nel file .env.');
  process.exit(1);
}
if (!usaClaude && !process.env.GROQ_API_KEY) {
  console.error('Manca GROQ_API_KEY nel file .env della cartella principale del progetto.');
  console.error('(Oppure aggiungi --claude per tradurre con Claude.)');
  process.exit(1);
}

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'non-usata-con-claude' });

type Dish = { id: string; name: string; description: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Estrae l'array JSON dalla risposta anche se il modello aggiunge testo o ``` intorno. */
function estraiJson(raw: string): any[] | null {
  if (!raw) return null;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function chiediTraduzione(dishes: Dish[], lang: string): Promise<Map<number, { name: string; description: string }> | null> {
  const payload = dishes.map((d, i) => ({ i, name: d.name, description: d.description || '' }));
  const prompt =
    `You translate restaurant menus from ${LANG_NAMES[baseLang] || baseLang} to ${LANG_NAMES[lang]}.\n` +
    `Reply with ONLY a JSON array. No markdown, no code fences, no commentary.\n` +
    `Each element must be exactly: {"i": <same index as input>, "name": "...", "description": "..."}\n` +
    `Rules:\n` +
    `- Keep the traditional dish name recognizable (e.g. "Carpaccio", "Tiramisu" stay as they are); translate the rest naturally.\n` +
    `- Never invent or remove ingredients. Translate only what is written.\n` +
    `- If a description is empty, return an empty string for it.\n` +
    `- Keep the tone short and appetizing, like a printed menu.\n` +
    `- Return exactly ${payload.length} elements, one per input index.\n\n` +
    `Input:\n${JSON.stringify(payload)}`;

  for (const model of MODELS) {
    for (let tentativo = 1; tentativo <= MAX_TENTATIVI; tentativo++) {
      try {
        const res = await groq.chat.completions.create({
          model,
          temperature: 0.2,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });
        const arr = estraiJson(res.choices[0]?.message?.content ?? '');
        if (!arr) { await sleep(PAUSA_MS); continue; }

        const mappa = new Map<number, { name: string; description: string }>();
        for (const el of arr) {
          const i = Number(el?.i);
          if (!Number.isInteger(i) || i < 0 || i >= dishes.length) continue;
          const name = typeof el.name === 'string' ? el.name.trim() : '';
          const description = typeof el.description === 'string' ? el.description.trim() : '';
          if (!name) continue;                       // senza nome la riga non vale
          mappa.set(i, { name, description });
        }
        if (mappa.size === dishes.length) return mappa;
        // parziale: se e' l'ultimo tentativo la restituiamo comunque, il resto ricadra' sull'originale
        if (tentativo === MAX_TENTATIVI && model === MODELS[MODELS.length - 1] && mappa.size > 0) return mappa;
        await sleep(PAUSA_MS);
      } catch (err: any) {
        const msg = String(err?.message || err);
        console.log(`      ! ${model}: ${msg.slice(0, 90)}`);
        if (/model|not found|decommission/i.test(msg)) break;   // passa al modello successivo
        await sleep(PAUSA_MS * 2);                              // rate limit o rete: aspetta di piu'
      }
    }
  }
  return null;
}

function estraiObj(raw: string): any | null {
  if (!raw) return null;
  const s = raw.replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Claude: traduce un blocco di piatti in TUTTE le lingue richieste con una
 * sola chiamata. Ritorna Map<lang, Map<indice, {name, description}>>.
 */
async function chiediTraduzioneClaude(
  dishes: Dish[], langs: string[]
): Promise<Map<string, Map<number, { name: string; description: string }>>> {
  const chiave = process.env.ANTHROPIC_API_KEY!;
  const payload = dishes.map((d, i) => ({ i, name: d.name, description: d.description || '' }));
  const nomiLingue = langs.map(l => `"${l}" (${LANG_NAMES[l]})`).join(', ');
  const prompt =
    `Translate this restaurant menu from ${LANG_NAMES[baseLang] || baseLang} into these languages: ${nomiLingue}.\n` +
    `Reply with ONLY a JSON object, no markdown, shaped exactly:\n` +
    `{ ${langs.map(l => `"${l}": [{"i":0,"name":"...","description":"..."}]`).join(', ')} }\n` +
    `Each language array must have exactly ${payload.length} elements, one per input index i.\n` +
    `Rules:\n` +
    `- Keep traditional dish names recognizable (Carpaccio, Tiramisu stay); translate the rest naturally.\n` +
    `- Never invent or remove ingredients. If a description is empty, return "".\n` +
    `- Short, appetizing, printed-menu tone.\n\n` +
    `Input:\n${JSON.stringify(payload)}`;

  let res: any = null, errore = '';
  for (let t = 1; t <= 4; t++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELLO_CLAUDE,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.ok) break;
    errore = await res.text();
    if ((res.status !== 429 && res.status !== 529 && res.status !== 500) || t === 4) break;
    const s = Math.min(Number(res.headers.get('retry-after')) || 8 * t, 60);
    console.log(`      (limite Claude: aspetto ${Math.round(s)}s)`);
    await sleepMs(s * 1000);
  }
  if (!res || !res.ok) throw new Error(`Claude ${res?.status}: ${errore.slice(0, 140)}`);
  const corpo: any = await res.json();
  const testo = (corpo.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  const obj = estraiObj(testo);
  if (!obj) throw new Error('Claude non ha restituito un JSON valido');

  const fuori = new Map<string, Map<number, { name: string; description: string }>>();
  for (const lang of langs) {
    const arr = Array.isArray(obj[lang]) ? obj[lang] : [];
    const m = new Map<number, { name: string; description: string }>();
    for (const el of arr) {
      const i = Number(el?.i);
      if (!Number.isInteger(i) || i < 0 || i >= dishes.length) continue;
      const name = typeof el.name === 'string' ? el.name.trim() : '';
      if (!name) continue;
      m.set(i, { name, description: typeof el.description === 'string' ? el.description.trim() : '' });
    }
    fuori.set(lang, m);
  }
  return fuori;
}

/**
 * Traduttore gratuito che non richiede nessuna chiave ne' account (MyMemory).
 * Piu' lento dell'IA ma non si rompe mai: nessun modello da aggiornare.
 */
async function traduciConMyMemory(
  dishes: Dish[],
  lang: string
): Promise<Map<number, { name: string; description: string }>> {
  const email = process.env.MYMEMORY_EMAIL?.trim();
  const risultato = new Map<number, { name: string; description: string }>();

  async function traduciFrase(testo: string): Promise<string | null> {
    if (!testo) return '';
    const url =
      'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(testo.slice(0, 480)) +
      '&langpair=' + baseLang + '|' + lang +
      (email ? '&de=' + encodeURIComponent(email) : '');
    for (let tentativo = 1; tentativo <= 3; tentativo++) {
      try {
        const res = await fetch(url);
        const data: any = await res.json();
        const t = data?.responseData?.translatedText;
        const stato = Number(data?.responseStatus);
        if (typeof t === 'string' && t && stato === 200 && !/MYMEMORY WARNING|QUOTA/i.test(t)) {
          return t;
        }
        if (/QUOTA/i.test(String(t))) {
          console.error('\nLimite giornaliero del traduttore gratuito raggiunto.');
          console.error(email
            ? 'Riprova domani: riprendera\' da dove si e\' fermato.'
            : 'Aggiungi la riga MYMEMORY_EMAIL=tuaemail nel file .env: il limite passa da 5.000 a 50.000 parole al giorno.');
          return null;
        }
      } catch { /* rete: riprova */ }
      await sleep(1500 * tentativo);
    }
    return null;
  }

  for (let i = 0; i < dishes.length; i++) {
    const nome = await traduciFrase(dishes[i].name);
    if (nome === null) break;                       // quota finita: ci fermiamo qui
    await sleep(600);
    let descrizione = '';
    if (dishes[i].description) {
      const d = await traduciFrase(dishes[i].description);
      if (d === null) break;
      descrizione = d;
      await sleep(600);
    }
    risultato.set(i, { name: nome || dishes[i].name, description: descrizione });
  }
  return risultato;
}

async function main() {
  // 1. la tabella (idempotente)
  const sqlPath = join(__dirname, '../../../../database/migrations/005_dish_translations.sql');
  await db.query(readFileSync(sqlPath, 'utf-8'));

  // 2. il ristorante
  const r = await db.query('SELECT id, name FROM restaurants WHERE slug = $1', [slug]);
  if (r.rows.length === 0) {
    console.error(`Nessun ristorante con slug "${slug}".`);
    process.exit(1);
  }
  const restaurant = r.rows[0];

  const d = await db.query(
    'SELECT id, name, COALESCE(description, \'\') AS description FROM dishes WHERE restaurant_id = $1 ORDER BY category, name',
    [restaurant.id]
  );
  const tuttiIPiatti: Dish[] = d.rows;

  console.log(`\nRistorante: ${restaurant.name} (${slug})`);
  console.log(`Piatti: ${tuttiIPiatti.length}`);
  console.log(`Lingua originale: ${baseLang}`);
  console.log(`Traduco in: ${targetLangs.join(', ')}`);

  const mancanti: string[] = [];
  let fallitiDiFila = 0;

  // ── Percorso Claude: tutte le lingue in una chiamata per blocco ──────────
  if (usaClaude) {
    console.log(`Motore: Claude (${MODELLO_CLAUDE}) — tutte le lingue in una chiamata\n`);
    const CHUNK_CLAUDE = 18;
    // done[lang] = set dei dish_id gia' tradotti
    const done: Record<string, Set<string>> = {};
    for (const lang of targetLangs) {
      done[lang] = new Set();
      if (!force) {
        const gia = await db.query(
          `SELECT dish_id FROM dish_translations
           WHERE lang = $1 AND name IS NOT NULL AND name <> '' AND dish_id = ANY($2::uuid[])`,
          [lang, tuttiIPiatti.map(p => p.id)]
        );
        gia.rows.forEach((x: any) => done[lang].add(x.dish_id));
      }
    }
    const langsDaFare = targetLangs.filter(l => tuttiIPiatti.some(p => !done[l].has(p.id)));
    if (langsDaFare.length === 0) { console.log('Gia\' tutto tradotto.'); }
    const piattiDaFare = tuttiIPiatti.filter(p => langsDaFare.some(l => !done[l].has(p.id)));
    console.log(`${piattiDaFare.length} piatti da tradurre in ${langsDaFare.length} lingue.`);

    for (let i = 0; i < piattiDaFare.length; i += CHUNK_CLAUDE) {
      const blocco = piattiDaFare.slice(i, i + CHUNK_CLAUDE);
      let perLingua: Map<string, Map<number, { name: string; description: string }>>;
      try {
        perLingua = await chiediTraduzioneClaude(blocco, langsDaFare);
        fallitiDiFila = 0;
      } catch (e: any) {
        console.log(`   blocco ${Math.floor(i / CHUNK_CLAUDE) + 1}: fallito (${e.message})`);
        blocco.forEach(p => langsDaFare.forEach(l => mancanti.push(`${l} - ${p.name}`)));
        if (++fallitiDiFila >= 3) { console.error('\nTre blocchi falliti di fila: mi fermo.'); await db.end(); process.exit(1); }
        await sleepMs(3000);
        continue;
      }
      for (const lang of langsDaFare) {
        const m = perLingua.get(lang) || new Map();
        for (let k = 0; k < blocco.length; k++) {
          if (!force && done[lang].has(blocco[k].id)) continue;
          const t = m.get(k);
          if (!t) { mancanti.push(`${lang} - ${blocco[k].name}`); continue; }
          await db.query(
            `INSERT INTO dish_translations (dish_id, lang, name, description, source)
             VALUES ($1, $2, $3, $4, 'auto')
             ON CONFLICT (dish_id, lang) DO UPDATE
               SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()
             WHERE dish_translations.source IS DISTINCT FROM 'manual'`,
            [blocco[k].id, lang, t.name, t.description]
          );
        }
      }
      console.log(`   ${Math.min(i + CHUNK_CLAUDE, piattiDaFare.length)}/${piattiDaFare.length}`);
      await sleepMs(400);
    }

    console.log('\n--- Riepilogo ---');
    for (const lang of targetLangs) {
      const c = await db.query(
        `SELECT COUNT(*)::int AS n FROM dish_translations t
         JOIN dishes d ON d.id = t.dish_id
         WHERE d.restaurant_id = $1 AND t.lang = $2 AND t.name <> ''`,
        [restaurant.id, lang]
      );
      console.log(`${lang}: ${c.rows[0].n}/${tuttiIPiatti.length}`);
    }
    if (mancanti.length) console.log(`\nNon tradotti: ${mancanti.length} (rilancia per riprovare solo questi)`);
    else console.log('\nTutto tradotto.');
    await db.end();
    return;
  }

  // Sceglie da solo il motore: se la chiave Groq funziona usa quella (piu' veloce
  // e piu' curata), altrimenti passa al traduttore gratuito che non richiede nulla.
  try {
    MODELS = process.env.GROQ_API_KEY ? await scopriModelli() : [];
  } catch {
    MODELS = [];
  }
  const motore: 'groq' | 'gratuito' = MODELS.length > 0 ? 'groq' : 'gratuito';
  console.log(motore === 'groq'
    ? `Motore: Groq (${MODELS[0]})\n`
    : `Motore: traduttore gratuito senza chiave — piu' lento, circa 40 minuti.\n`);

  for (const lang of targetLangs) {
    // cosa manca davvero per questa lingua
    let daFare = tuttiIPiatti;
    if (!force) {
      const gia = await db.query(
        `SELECT dish_id FROM dish_translations
         WHERE lang = $1 AND name IS NOT NULL AND name <> ''
           AND dish_id = ANY($2::uuid[])`,
        [lang, tuttiIPiatti.map(p => p.id)]
      );
      const fatti = new Set(gia.rows.map(x => x.dish_id));
      daFare = tuttiIPiatti.filter(p => !fatti.has(p.id));
    }

    if (daFare.length === 0) {
      console.log(`[${lang}] gia' completo, salto`);
      continue;
    }
    console.log(`[${lang}] ${daFare.length} piatti da tradurre`);

    for (let i = 0; i < daFare.length; i += CHUNK_SIZE) {
      const blocco = daFare.slice(i, i + CHUNK_SIZE);
      const mappa = motore === 'groq'
        ? await chiediTraduzione(blocco, lang)
        : await traduciConMyMemory(blocco, lang);

      if (!mappa || mappa.size === 0) {
        console.log(`   blocco ${i / CHUNK_SIZE + 1}: fallito, questi piatti restano in originale`);
        blocco.forEach(p => mancanti.push(`${lang} - ${p.name}`));
        fallitiDiFila++;
        if (fallitiDiFila >= 3) {
          console.error('\nTre blocchi falliti di fila: mi fermo invece di andare avanti a vuoto.');
          console.error('Guarda il messaggio di errore qui sopra (chiave Groq o modello non disponibile).');
          await db.end();
          process.exit(1);
        }
        await sleep(PAUSA_MS);
        continue;
      }
      fallitiDiFila = 0;

      for (let k = 0; k < blocco.length; k++) {
        const t = mappa.get(k);
        if (!t) { mancanti.push(`${lang} - ${blocco[k].name}`); continue; }
        await db.query(
          `INSERT INTO dish_translations (dish_id, lang, name, description, source)
           VALUES ($1, $2, $3, $4, 'auto')
           ON CONFLICT (dish_id, lang) DO UPDATE
             SET name = EXCLUDED.name,
                 description = EXCLUDED.description,
                 updated_at = NOW()
           WHERE dish_translations.source IS DISTINCT FROM 'manual'`,
          [blocco[k].id, lang, t.name, t.description]
        );
      }
      const fatti = Math.min(i + CHUNK_SIZE, daFare.length);
      console.log(`   ${fatti}/${daFare.length}`);
      if (motore === 'groq') await sleep(PAUSA_MS);
    }
  }

  console.log('\n--- Riepilogo ---');
  for (const lang of targetLangs) {
    const c = await db.query(
      `SELECT COUNT(*)::int AS n FROM dish_translations t
       JOIN dishes d ON d.id = t.dish_id
       WHERE d.restaurant_id = $1 AND t.lang = $2 AND t.name <> ''`,
      [restaurant.id, lang]
    );
    console.log(`${lang}: ${c.rows[0].n}/${tuttiIPiatti.length}`);
  }
  if (mancanti.length) {
    console.log(`\nNon tradotti (restano nell'originale, rilancia il comando per riprovare solo questi):`);
    mancanti.slice(0, 30).forEach(m => console.log('  - ' + m));
    if (mancanti.length > 30) console.log(`  ... e altri ${mancanti.length - 30}`);
  } else {
    console.log('\nTutto tradotto.');
  }

  await db.end();
}

main().catch(err => {
  console.error('Errore:', err.message);
  process.exit(1);
});
