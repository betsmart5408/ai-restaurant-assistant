/**
 * Scrive PRIMA le risposte che oggi il modello improvvisa davanti al cliente.
 *
 *   npm run genera-risposte --workspace=packages/api
 *   npm run genera-risposte --workspace=packages/api -- --slug al-aseel
 *   npm run genera-risposte --workspace=packages/api -- --lingue it,en,ja
 *   npm run genera-risposte --workspace=packages/api -- --claude
 *   npm run genera-risposte --workspace=packages/api -- --rifai
 *
 * Per ogni piatto e ogni lingua genera due cose:
 *   racconto     - il piatto spiegato bene: ingredienti, sapore, come si fa
 *   abbinamento  - cosa bere con quel piatto
 *
 * Si puo' fermare e rilanciare: salta quello che c'e' gia'. Le righe corrette
 * a mano (source='manual') non vengono mai toccate, nemmeno con --rifai.
 *
 * Usa la catena dei fornitori configurata in AI_PROVIDERS (vedi
 * services/fornitori-ia.ts); con --claude passa da Anthropic, che costa
 * qualche centesimo a ristorante ma non ha limiti di frequenza.
 *
 * COSA NON FA: non scrive niente su allergeni, intolleranze o sicurezza
 * alimentare. Quelle risposte restano prese dal campo allergens del database,
 * dal vivo. Una frase generata e congelata su un allergene sarebbe piu'
 * pericolosa del modello: resta li' per mesi e nessuno la rilegge.
 */
import { join } from 'path';
import { config as caricaEnv } from 'dotenv';
import { Pool } from 'pg';
import { LANG_NAMES } from '../services/translate';
import { catenaFornitori, clientePer } from '../services/fornitori-ia';
import { modelliDisponibili } from '../services/groq-model';

caricaEnv({ path: join(__dirname, '../../../../.env') });
caricaEnv();

if (!process.env.DATABASE_URL) {
  console.error('Manca DATABASE_URL nel file .env.');
  process.exit(1);
}

const argomenti = process.argv.slice(2);
function valore(nome: string): string | undefined {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : undefined;
}
const soloSlug = valore('--slug');
const soloLingue = (valore('--lingue') || '').split(',').map(s => s.trim()).filter(Boolean);
const usaClaude = argomenti.includes('--claude');
const rifai = argomenti.includes('--rifai');
const prova = argomenti.includes('--prova');

const MODELLO_CLAUDE = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const BLOCCO = 12;               // piatti per chiamata: risposte lunghe, blocchi corti
const PAUSA_MS = usaClaude ? 300 : 1500;

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Piatto {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
}

function estraiJson(raw: string): any[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const p = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(p) ? p : null;
  } catch { return null; }
}

function costruisciPrompt(piatti: Piatto[], lang: string): string {
  const payload = piatti.map((p, i) => ({
    i, name: p.name, description: p.description || '', category: p.category || '',
  }));
  return `You write content for a restaurant menu assistant, in ${LANG_NAMES[lang] || lang}.\n` +
    `Reply with ONLY a JSON array. No markdown, no code fences, no commentary.\n` +
    `Each element exactly: {"i": <same index>, "racconto": "...", "abbinamento": "..."}\n` +
    `\n` +
    `"racconto": the dish described warmly for a guest reading it at the table.\n` +
    `  2 or 3 short sentences. Flavour, texture, how it is made, why it is worth ordering.\n` +
    `"abbinamento": what to drink with it. One or two sentences, a wine style or a\n` +
    `  non-alcoholic option, and why it works.\n` +
    `\n` +
    `Rules, all mandatory:\n` +
    `- Write in ${LANG_NAMES[lang] || lang}. Nothing else.\n` +
    `- NEVER invent ingredients that are not in the name or description. If you do not\n` +
    `  know what is inside, describe the style of the dish, not its contents.\n` +
    `- NEVER mention allergens, gluten, lactose, "suitable for", or any dietary safety\n` +
    `  claim. Not even to say something is free of them. That is handled elsewhere.\n` +
    `- Name a wine STYLE or grape, never a specific producer or a bottle the restaurant\n` +
    `  may not have.\n` +
    `- No prices. No emoji. No bold, no markdown.\n` +
    `- Exactly ${payload.length} elements.\n\n` +
    `Input:\n${JSON.stringify(payload)}`;
}

// Rete di sicurezza: se il modello nomina comunque un allergene, la riga si
// scarta invece di finire nel database. Meglio un piatto senza racconto che un
// racconto che parla di glutine.
const VIETATE = /\b(allerg|glutin|gluten|lattos|lactos|celiac|coeliac|intoller|intoler|senza glutine|gluten[- ]free|dairy[- ]free)/i;

async function chiediClaude(piatti: Piatto[], lang: string): Promise<any[] | null> {
  const chiave = process.env.ANTHROPIC_API_KEY;
  if (!chiave) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chiave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELLO_CLAUDE,
        max_tokens: 4096,
        messages: [{ role: 'user', content: costruisciPrompt(piatti, lang) }],
      }),
    });
    if (!res.ok) {
      // Il corpo della risposta dice ESATTAMENTE cosa non va (modello
      // sbagliato, parametro fuori intervallo, chiave scaduta). Stamparlo:
      // sei righe con scritto solo "400" non servono a nessuno.
      const dettaglio = await res.text().catch(() => '');
      console.log(`   ! Claude ${res.status}: ${dettaglio.slice(0, 300)}`);
      return null;
    }
    const dati: any = await res.json();
    return estraiJson(dati?.content?.[0]?.text ?? '');
  } catch (err) {
    console.log(`   ! Claude non raggiungibile: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function chiediCatena(piatti: Piatto[], lang: string): Promise<any[] | null> {
  for (const fornitore of catenaFornitori()) {
    const cliente = clientePer(fornitore);
    // Niente nomi di modello scritti fissi: vengono ritirati e lo script
    // smetterebbe di funzionare senza che nessuno abbia toccato niente.
    // E' la stessa ragione per cui esiste services/groq-model.ts.
    const modelli = fornitore.modelli.length > 0
      ? fornitore.modelli
      : await modelliDisponibili(cliente, fornitore.chiave);
    if (modelli.length === 0) {
      console.log(`   ! ${fornitore.nome}: nessun modello disponibile con questa chiave`);
      continue;
    }
    for (const model of modelli) {
      try {
        const res = await cliente.chat.completions.create({
          model, temperature: 0.4, max_tokens: 4096,
          messages: [{ role: 'user', content: costruisciPrompt(piatti, lang) }],
        });
        const arr = estraiJson(res.choices[0]?.message?.content ?? '');
        if (arr) return arr;
      } catch (err: any) {
        const m = String(err?.message ?? err);
        console.log(`   ! ${fornitore.nome}/${model}: ${m.slice(0, 90)}`);
      }
    }
  }
  return null;
}

async function main() {
  const esiste = await db.query(`SELECT to_regclass('public.dish_answers') IS NOT NULL AS c`);
  if (!esiste.rows[0]?.c) {
    console.error('La tabella dish_answers non esiste. Applica le migrazioni:  .\\aggiorna-database.ps1');
    process.exit(1);
  }

  const ristoranti = await db.query<{ id: string; slug: string; name: string; languages: string[] }>(
    soloSlug
      ? `SELECT id, slug, name, languages FROM restaurants WHERE slug = $1`
      : `SELECT id, slug, name, languages FROM restaurants ORDER BY created_at`,
    soloSlug ? [soloSlug] : [],
  );
  if (ristoranti.rows.length === 0) {
    console.log('Nessun ristorante trovato.');
    await db.end();
    return;
  }

  let scritte = 0, saltate = 0, scartate = 0, senzaDescrizioneTotale = 0;

  for (const r of ristoranti.rows) {
    const lingue = soloLingue.length > 0
      ? soloLingue
      : (Array.isArray(r.languages) && r.languages.length > 0 ? r.languages : ['en']);

    // SOLO i piatti che hanno una descrizione.
    //
    // Senza descrizione il modello ha solo il nome, e da un nome non si
    // ricava cosa c'e' dentro: "Arnabeet" (cavolfiore, in arabo) e' diventato
    // "melanzane grigliate" alla prima prova. Su un menu libanese, dove i nomi
    // sono traslitterazioni, e' successo quasi ovunque.
    //
    // Un piatto senza racconto non e' un problema: la chat mostra comunque
    // nome, prezzo e allergeni. Un racconto che sbaglia l'ingrediente
    // principale e' un problema del ristoratore, stampato e ripetuto per mesi.
    const tutti = await db.query<Piatto>(
      `SELECT id, name, description, category, price FROM dishes
        WHERE restaurant_id = $1 AND available = true ORDER BY category, sort_order`,
      [r.id],
    );
    const piatti = { rows: tutti.rows.filter(p => (p.description || '').trim() !== '') };
    const senzaDescrizione = tutti.rows.length - piatti.rows.length;
    if (piatti.rows.length === 0) {
      console.log(`\n${r.name}  - saltato: nessuno dei ${tutti.rows.length} piatti ha una descrizione`);
      senzaDescrizioneTotale += senzaDescrizione;
      continue;
    }

    console.log(`\n${r.name}  (${piatti.rows.length} piatti con descrizione, ${lingue.length} lingue)`);
    if (senzaDescrizione > 0) {
      console.log(`  ${senzaDescrizione} piatti saltati: senza descrizione nel menu`);
      senzaDescrizioneTotale += senzaDescrizione;
    }

    for (const lang of lingue) {
      // Chi ha gia' entrambe le risposte in questa lingua si salta.
      const gia = await db.query<{ dish_id: string }>(
        `SELECT dish_id FROM dish_answers
          WHERE lang = $1 AND dish_id = ANY($2::uuid[])
          GROUP BY dish_id HAVING COUNT(DISTINCT kind) >= 2`,
        [lang, piatti.rows.map(p => p.id)],
      );
      const fatti = new Set(gia.rows.map(x => x.dish_id));
      const daFare = rifai ? piatti.rows : piatti.rows.filter(p => !fatti.has(p.id));
      saltate += piatti.rows.length - daFare.length;
      if (daFare.length === 0) { console.log(`  [${lang}] gia' fatto`); continue; }

      console.log(`  [${lang}] ${daFare.length} piatti`);
      if (prova) continue;

      for (let i = 0; i < daFare.length; i += BLOCCO) {
        const blocco = daFare.slice(i, i + BLOCCO);
        const arr = usaClaude ? await chiediClaude(blocco, lang) : await chiediCatena(blocco, lang);
        if (!arr) { console.log(`   ! blocco non riuscito, vado avanti`); continue; }

        for (const el of arr) {
          const k = Number(el?.i);
          if (!Number.isInteger(k) || k < 0 || k >= blocco.length) continue;
          for (const kind of ['racconto', 'abbinamento'] as const) {
            const testo = typeof el[kind] === 'string' ? el[kind].trim() : '';
            if (!testo) continue;
            if (VIETATE.test(testo)) { scartate++; continue; }
            await db.query(
              `INSERT INTO dish_answers (dish_id, lang, kind, text, source)
               VALUES ($1, $2, $3, $4, 'auto')
               ON CONFLICT (dish_id, lang, kind) DO UPDATE
                 SET text = EXCLUDED.text, updated_at = NOW()
               WHERE dish_answers.source IS DISTINCT FROM 'manual'`,
              [blocco[k].id, lang, kind, testo],
            );
            scritte++;
          }
        }
        console.log(`   ${Math.min(i + BLOCCO, daFare.length)}/${daFare.length}`);
        await sleep(PAUSA_MS);
      }
    }
  }

  console.log(`\nScritte ${scritte} risposte, saltati ${saltate} piatti gia' fatti.`);
  if (scartate > 0) {
    console.log(`Scartate ${scartate} risposte che nominavano allergeni (non devono finire qui).`);
  }
  if (senzaDescrizioneTotale > 0) {
    console.log(`\n${senzaDescrizioneTotale} piatti saltati perche' nel menu non hanno una descrizione.`);
    console.log('Dal nome soltanto il modello si inventerebbe gli ingredienti.');
    console.log('Per sbloccarli basta scrivere una riga di descrizione nel pannello Menu.');
  }
  await db.end();
}

main().catch(async err => {
  console.error('Errore:', err instanceof Error ? err.message : err);
  await db.end().catch(() => {});
  process.exit(1);
});
