/**
 * Traduzione dei piatti: si fa UNA VOLTA e si salva nel database.
 * Il cliente che guarda il menu non fa mai partire una traduzione.
 *
 * Regole di sicurezza:
 * - se la traduzione non riesce, il piatto resta nella lingua originale
 *   (il menu non resta mai vuoto o a meta');
 * - le correzioni fatte a mano (source='manual') non vengono mai sovrascritte.
 */
import Groq from 'groq-sdk';
import { db } from '../db/client';

export const LANG_NAMES: Record<string, string> = {
  it: 'Italian', en: 'English', de: 'German', es: 'Spanish', fr: 'French',
  pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)', ja: 'Japanese', ar: 'Arabic',
};

export const TUTTE_LE_LINGUE = Object.keys(LANG_NAMES);

export interface PiattoDaTradurre {
  id: string;
  name: string;
  description: string | null;
}

/** Modelli disponibili con la chiave in uso; scoperti una volta e tenuti in memoria. */
let modelliInCache: string[] | null = null;

const PREFERENZE = [
  'gpt-oss-120b', 'llama-3.3-70b', 'llama-4', 'maverick', 'qwen3', 'minimax',
  'gpt-oss-20b', 'llama-3.1-8b', 'gemma', 'compound',
];
const ESCLUDI = /whisper|tts|orpheus|guard|embed|rerank|moderation/i;

async function modelliDisponibili(groq: Groq): Promise<string[]> {
  if (modelliInCache) return modelliInCache;
  if (process.env.GROQ_MODEL) { modelliInCache = [process.env.GROQ_MODEL]; return modelliInCache; }
  try {
    const lista: any = await groq.models.list();
    const ids: string[] = (lista?.data || []).map((m: any) => m.id).filter(Boolean);
    const punteggio = (id: string) => {
      const i = PREFERENZE.findIndex(p => id.toLowerCase().includes(p));
      return i === -1 ? 99 : i;
    };
    modelliInCache = ids.filter(id => !ESCLUDI.test(id)).sort((a, b) => punteggio(a) - punteggio(b)).slice(0, 2);
  } catch {
    modelliInCache = [];
  }
  return modelliInCache;
}

function estraiJson(raw: string): any[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function costruisciPrompt(piatti: PiattoDaTradurre[], baseLang: string, lang: string): string {
  const payload = piatti.map((p, i) => ({ i, name: p.name, description: p.description || '' }));
  return `You translate restaurant menus from ${LANG_NAMES[baseLang] || baseLang} to ${LANG_NAMES[lang]}.\n` +
    `Reply with ONLY a JSON array. No markdown, no commentary.\n` +
    `Each element exactly: {"i": <same index>, "name": "...", "description": "..."}\n` +
    `Rules:\n` +
    `- Keep the traditional dish name recognizable (Carpaccio, Tiramisu stay as they are).\n` +
    `- Never invent or remove ingredients.\n` +
    `- Empty description stays an empty string.\n` +
    `- Short, appetizing, printed-menu tone.\n` +
    `- Exactly ${payload.length} elements.\n\nInput:\n${JSON.stringify(payload)}`;
}

function mappaDaArray(arr: any[], n: number): Map<number, { name: string; description: string }> {
  const mappa = new Map<number, { name: string; description: string }>();
  for (const el of arr) {
    const i = Number(el?.i);
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    const name = typeof el.name === 'string' ? el.name.trim() : '';
    if (!name) continue;
    mappa.set(i, { name, description: typeof el.description === 'string' ? el.description.trim() : '' });
  }
  return mappa;
}

// Ripiego su Claude: quando Groq non ha modelli o non risponde, il piatto
// appena salvato dal ristoratore viene comunque tradotto (~1 centesimo).
const MODELLO_CLAUDE = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

async function chiediClaude(
  piatti: PiattoDaTradurre[], baseLang: string, lang: string
): Promise<Map<number, { name: string; description: string }> | null> {
  const chiave = process.env.ANTHROPIC_API_KEY;
  if (!chiave || chiave.length < 20) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELLO_CLAUDE, max_tokens: 4096,
        messages: [{ role: 'user', content: costruisciPrompt(piatti, baseLang, lang) }],
      }),
    });
    if (!res.ok) return null;
    const corpo: any = await res.json();
    const testo = (corpo.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    const arr = estraiJson(testo);
    if (!arr) return null;
    const mappa = mappaDaArray(arr, piatti.length);
    return mappa.size > 0 ? mappa : null;
  } catch { return null; }
}

async function chiedi(
  groq: Groq, modelli: string[], piatti: PiattoDaTradurre[], baseLang: string, lang: string
): Promise<Map<number, { name: string; description: string }> | null> {
  const prompt = costruisciPrompt(piatti, baseLang, lang);

  for (const model of modelli) {
    for (let tentativo = 1; tentativo <= 2; tentativo++) {
      try {
        const res = await groq.chat.completions.create({
          model, temperature: 0.2, max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });
        const arr = estraiJson(res.choices[0]?.message?.content ?? '');
        if (!arr) continue;
        const mappa = mappaDaArray(arr, piatti.length);
        if (mappa.size > 0) return mappa;
      } catch (err: any) {
        if (/model|not found|decommission/i.test(String(err?.message))) break;
      }
    }
  }
  return null;
}

/**
 * Traduce i piatti passati e salva. Non lancia mai eccezioni:
 * restituisce quante traduzioni ha scritto.
 */
export async function traduciESalva(
  piatti: PiattoDaTradurre[],
  baseLang: string,
  lingue: string[],
  groqApiKey?: string | null
): Promise<{ scritte: number; errore?: string }> {
  if (piatti.length === 0) return { scritte: 0 };
  const chiave = groqApiKey || process.env.GROQ_API_KEY;
  const claudeAttivo = !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length >= 20;

  const groq = chiave ? new Groq({ apiKey: chiave }) : null;
  const modelli = groq ? await modelliDisponibili(groq) : [];
  if (modelli.length === 0 && !claudeAttivo) {
    return { scritte: 0, errore: 'Nessun traduttore disponibile (né Groq né Claude)' };
  }

  const daFare = lingue.filter(l => l !== baseLang && LANG_NAMES[l]);
  let scritte = 0;

  for (const lang of daFare) {
    for (let i = 0; i < piatti.length; i += 8) {
      const blocco = piatti.slice(i, i + 8);
      // Prima Groq (gratis); se non risponde, ripiega su Claude.
      let mappa = (groq && modelli.length > 0)
        ? await chiedi(groq, modelli, blocco, baseLang, lang)
        : null;
      if (!mappa && claudeAttivo) mappa = await chiediClaude(blocco, baseLang, lang);
      if (!mappa) continue;                       // resta l'originale
      for (let k = 0; k < blocco.length; k++) {
        const t = mappa.get(k);
        if (!t) continue;
        try {
          await db.query(
            `INSERT INTO dish_translations (dish_id, lang, name, description, source)
             VALUES ($1, $2, $3, $4, 'auto')
             ON CONFLICT (dish_id, lang) DO UPDATE
               SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW()
             WHERE dish_translations.source IS DISTINCT FROM 'manual'`,
            [blocco[k].id, lang, t.name, t.description]
          );
          scritte++;
        } catch { /* una riga persa non deve fermare il resto */ }
      }
    }
  }
  return { scritte };
}

/** Lingue attive di un ristorante (colonna languages), con riserva su tutte. */
export async function lingueDelRistorante(restaurantId: string): Promise<{ base: string; lingue: string[] }> {
  try {
    const r = await db.query('SELECT languages, base_lang FROM restaurants WHERE id = $1', [restaurantId]);
    const row = r.rows[0] || {};
    const lingue: string[] = Array.isArray(row.languages) && row.languages.length > 1 ? row.languages : TUTTE_LE_LINGUE;
    return { base: row.base_lang || 'es', lingue };
  } catch {
    return { base: 'es', lingue: TUTTE_LE_LINGUE };
  }
}
