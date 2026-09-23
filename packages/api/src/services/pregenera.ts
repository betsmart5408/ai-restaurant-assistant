/**
 * Pre-generazione notturna dei consigli.
 *
 * I quattro consigli generici - "cosa mi consigli?", "menu degustazione per
 * 2", "sono vegetariano", "per bambini" - sono uguali per tutti i clienti di
 * un locale e restano in cache 24 ore. Oggi li paga il PRIMO cliente della
 * giornata: e' lui che aspetta tre secondi e consuma una delle sue cinque
 * domande al modello, per una risposta che poi leggeranno gratis tutti gli
 * altri.
 *
 * Questo lavoro li scrive di notte, quando nessuno e' a tavola. Tre effetti:
 * il cliente al tavolo non aspetta piu', non consuma le sue domande per una
 * risposta che avevamo gia', e le chiamate si spalmano in un'ora in cui i
 * 2 al minuto di Groq non danno fastidio a nessuno.
 *
 * SI GENERA SOLO DOVE SERVE. Pre-generare per tutti i 519 ristoranti in
 * tutte le lingue sarebbe 20.760 chiamate a notte, e il piano gratuito ne
 * regge circa 9.700. Ma i ristoranti che hanno avuto un cliente vero negli
 * ultimi 30 giorni sono 25, in 50 combinazioni di lingua: 200 chiamate.
 * Quindi si guarda il traffico vero e si pre-genera per quello. Per tutti
 * gli altri continua a pagare il primo cliente, come adesso.
 */
import { db } from '../db/client';
import { processChat } from './ai-chat';
import { firmaMenu, leggiConsiglio, type TipoConsiglio } from './consigli-pronti';

/** La frase che fa riconoscere ogni tipo di consiglio. La lingua della
 *  risposta la decide il parametro `language`, non queste parole. */
const DOMANDA: Record<TipoConsiglio, string> = {
  consiglio: 'cosa mi consigli',
  degustazione2: 'menu degustazione',
  vegetariano: 'sono vegetariano',
  bambini: 'menu bambini',
};
const TIPI = Object.keys(DOMANDA) as TipoConsiglio[];

export interface OpzioniPregenera {
  /** Quanti giorni indietro guardare per decidere chi ha traffico. */
  giorni?: number;
  /** Un ristorante preciso (slug), invece di seguire il traffico. */
  slug?: string;
  /** Solo queste lingue. Vuoto = quelle che i clienti hanno davvero usato. */
  lingue?: string[];
  /** Tetto di sicurezza alle chiamate al modello. */
  max?: number;
  /** Pausa fra una chiamata e l'altra: i piani gratuiti hanno limiti al minuto. */
  pausaMs?: number;
  /** Riscrive anche quello che e' gia' in cache e valido. */
  forza?: boolean;
  /** Stampa cosa farebbe, senza chiamare nessun modello. */
  prova?: boolean;
}

interface Coppia { restaurant_id: string; name: string; groq_api_key: string | null; lingua: string }

const aspetta = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Chi pre-generare: i ristoranti con clienti veri di recente, lingua per lingua. */
async function coppieDaFare(o: OpzioniPregenera): Promise<Coppia[]> {
  if (o.slug) {
    const r = await db.query<Coppia>(
      `SELECT r.id AS restaurant_id, r.name, r.groq_api_key, unnest(r.languages) AS lingua
       FROM restaurants r WHERE r.slug = $1 AND r.assistente_attivo IS NOT false`, [o.slug]);
    return r.rows;
  }
  const r = await db.query<Coppia>(
    `SELECT DISTINCT r.id AS restaurant_id, r.name, r.groq_api_key, cs.language AS lingua
     FROM chat_sessions cs
     JOIN restaurants r ON r.id = cs.restaurant_id
     WHERE cs.created_at > NOW() - ($1 || ' days')::interval
       AND jsonb_array_length(cs.messages) > 1
       AND r.assistente_attivo IS NOT false
       AND coalesce(cs.language, '') <> ''
     ORDER BY r.name, cs.language`, [String(o.giorni ?? 30)]);
  return r.rows;
}

export async function pregeneraConsigli(o: OpzioniPregenera = {}): Promise<{ scritti: number; saltati: number; falliti: number }> {
  const max = o.max ?? 400;
  // Trenta secondi, non quattro. Groq gratuito da' 8.000 token al minuto e
  // una chiamata ne usa circa 3.700: piu' di due al minuto e arriva il 429.
  // Di notte la fretta non serve — 200 chiamate a 30 secondi sono un'ora e
  // mezza, e alle 4:30 non disturbano nessuno.
  const pausa = o.pausaMs ?? 30_000;
  let coppie = await coppieDaFare(o);
  if (o.lingue?.length) coppie = coppie.filter(c => o.lingue!.includes(c.lingua));

  console.log(`[pregenera] ${coppie.length} coppie ristorante+lingua, fino a ${max} chiamate`);
  let scritti = 0, saltati = 0, falliti = 0;

  for (const c of coppie) {
    const piatti = await db.query<{ id: string; name: string; price: number }>(
      `SELECT id, name, price FROM dishes WHERE restaurant_id = $1 AND available = true`, [c.restaurant_id]);
    if (piatti.rows.length === 0) continue;
    const firma = firmaMenu(piatti.rows);

    for (const tipo of TIPI) {
      if (scritti >= max) {
        console.log(`[pregenera] tetto di ${max} chiamate raggiunto, mi fermo qui`);
        return { scritti, saltati, falliti };
      }
      if (!o.forza && await leggiConsiglio(c.restaurant_id, c.lingua, tipo, firma)) { saltati++; continue; }
      if (o.prova) { console.log(`[prova] ${c.name} [${c.lingua}] ${tipo}`); scritti++; continue; }

      // Si passa dalla stessa strada del cliente: cosi' quello che finisce
      // in cache e' identico a quello che avrebbe visto lui, e se un giorno
      // cambiano le regole del prompt cambia anche questo senza doverlo
      // ricordare. processChat salva da solo in consigli_pronti.
      const scrivi = () => processChat({
        restaurantId: c.restaurant_id,
        restaurantName: c.name,
        tableNumber: 1,
        language: c.lingua,
        conversationHistory: [],
      }, DOMANDA[tipo], c.groq_api_key || undefined);

      try {
        await scrivi();
        scritti++;
        console.log(`[pregenera] ${c.name} [${c.lingua}] ${tipo} ok`);
      } catch (err) {
        // Quasi sempre e' il limite al minuto di un piano gratuito. Si aspetta
        // il doppio e si riprova una volta: di notte il tempo c'e'.
        const limite = /rate limit|429|too many/i.test(String((err as Error)?.message ?? ''));
        if (limite) console.log(`[pregenera] ${c.name} [${c.lingua}] ${tipo}: limite al minuto, aspetto e riprovo`);
        await aspetta(limite ? pausa * 2 : pausa);
        try {
          await scrivi();
          scritti++;
          console.log(`[pregenera] ${c.name} [${c.lingua}] ${tipo} ok (al secondo tentativo)`);
        } catch (err2) {
          falliti++;
          console.warn(`[pregenera] ${c.name} [${c.lingua}] ${tipo} non riuscito:`, (err2 as Error)?.message?.slice(0, 120));
        }
      }
      await aspetta(pausa);
    }
  }
  console.log(`[pregenera] scritti ${scritti}, gia' pronti ${saltati}, falliti ${falliti}`);
  return { scritti, saltati, falliti };
}
