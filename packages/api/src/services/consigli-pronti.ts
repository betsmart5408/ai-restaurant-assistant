/**
 * Consigli pronti: le domande "da consiglio" che quasi ogni cliente fa.
 *
 *   "Cosa mi consigli?"  "Menu degustazione per 2"  "Sono vegetariano"  "Per bambini"
 *
 * Non hanno una risposta scritta nel database come prezzo o allergeni, ma sono
 * sempre le stesse per tutti i clienti di un ristorante. Quindi: la prima
 * volta risponde l'IA (senza la conversazione precedente, cosi' la risposta
 * vale per chiunque), la salviamo, e dal secondo cliente in poi e' gratis.
 * Si riscrive da sola quando cambia il menu o dopo un giorno.
 *
 * Stessa regola delle risposte dirette: nel dubbio NON si riconosce niente e
 * decide l'IA. "Siamo in due, uno e' celiaco, cosa ci consigli?" non e' un
 * consiglio generico: contiene un'allergia e va all'IA con tutto il contesto.
 */
import crypto from 'crypto';
import { db } from '../db/client';
import { normalizza, PAROLE_ALLERGENI, PAROLE_ALLERGENI_INTERE, SUGGERIMENTI_TUTTE_LE_LINGUE } from './risposte-dirette';

export type TipoConsiglio = 'consiglio' | 'degustazione2' | 'vegetariano' | 'bambini';

const VALIDITA_MS = 24 * 3600 * 1000;
const MAX_PAROLE = 8;

// Frasi (normalizzate: minuscole, senza accenti) che bastano da sole
const FRASI: Record<TipoConsiglio, string[]> = {
  consiglio: [
    'cosa mi consigli', 'cosa ci consigli', 'cosa consigli', 'cosa mi consiglia', 'consigliami', 'che mi consigli',
    'what do you recommend', 'what would you recommend', 'what do you suggest', 'any recommendations', 'recommend something',
    'que me recomiendas', 'que recomiendas', 'que me recomienda', 'que nos recomiendas',
    'que me conseillez', 'que conseillez', 'que recommandez',
    'was empfehlen sie', 'was empfiehlst du', 'was konnen sie empfehlen',
    'o que me recomenda', 'o que recomenda',
  ],
  degustazione2: [
    'menu degustazione', 'degustazione', 'tasting menu', 'menu degustacion', 'degustacion',
    'menu degustation', 'degustationsmenu', 'menu de degustacao',
  ],
  vegetariano: [
    'vegetariano', 'vegetariana', 'vegetariani', 'vegetariane', 'vegetarian',
    'vegetarien', 'vegetarienne', 'vegetarisch', 'vegetariana',
  ],
  bambini: [
    'per bambini', 'per un bambino', 'per una bambina', 'per i bambini', 'menu bambini',
    'for kids', 'for children', 'kids menu', 'for a child', 'for my kid', 'for the kids',
    'para ninos', 'menu infantil', 'pour enfants', 'menu enfant', 'fur kinder', 'kindermenu',
  ],
};
// Numeri che fanno di "degustazione" una domanda per 2 (o senza numero)
const DUE = new Set(['2', 'due', 'two', 'dos', 'deux', 'zwei', 'dois', 'coppia', 'couple']);
const VEGETARIANO = /vegetari|vegetarisch/;

/**
 * Riconosce una domanda da consiglio generico. null = non e' uno di questi
 * (o c'e' qualcosa di personale dentro): decide l'IA.
 */
export function riconosciConsiglio(messaggio: string, nomiPiatti: string[]): TipoConsiglio | null {
  const msg = normalizza(messaggio);
  if (!msg) return null;
  const parole = msg.split(' ');
  if (parole.length > MAX_PAROLE) return null;

  // Il nome di un piatto dentro ("pizza vegetariana") e' una domanda sul piatto
  if (nomiPiatti.some(n => n && msg.includes(n))) return null;

  // Allergie e intolleranze: sempre all'IA, tranne "vegetariano" che e' una scelta, non un'allergia
  const senzaVeg = parole.filter(p => !VEGETARIANO.test(p)).join(' ');
  const allergia = PAROLE_ALLERGENI.some(p => senzaVeg.includes(p)) ||
    parole.some(p => PAROLE_ALLERGENI_INTERE.includes(p) && !VEGETARIANO.test(p));
  if (allergia || /vegan/.test(msg.replace(/vegetari\w*/g, ''))) return null;

  // I nostri suggerimenti da cliccare, in tutte le lingue
  const sugg = SUGGERIMENTI_TUTTE_LE_LINGUE.get(msg);
  if (sugg === 0) return 'consiglio';
  if (sugg === 2) return 'degustazione2';

  const numeri = parole.filter(p => /^\d+$/.test(p));
  if (FRASI.degustazione2.some(f => msg.includes(f))) {
    // "per 4" cambia tutto: la decide l'IA
    if (numeri.some(n => n !== '2')) return null;
    return 'degustazione2';
  }
  // Un'eta' o un numero di persone rende la domanda personale
  if (numeri.length > 0) return null;
  if (FRASI.bambini.some(f => msg.includes(f))) return 'bambini';
  if (FRASI.vegetariano.some(f => parole.includes(f))) return 'vegetariano';
  if (FRASI.consiglio.some(f => msg.includes(f))) return 'consiglio';
  return null;
}

// ── Memoria delle risposte ──────────────────────────────────────────────────
// Qualsiasi altra domanda che vale uguale per chiunque ("avete il wifi?",
// "la carbonara e' piccante?") si ricorda con la sua risposta, nella stessa
// tabella dei consigli, con chiave "q:<domanda normalizzata>".
export type ChiaveMemoria = `q:${string}`;

// Parole che rimandano a qualcosa detto prima: senza la conversazione la
// risposta sarebbe sbagliata, quindi niente memoria.
const RIMANDI = new Set([
  'questo', 'questa', 'questi', 'queste', 'quello', 'quella', 'quelli', 'quelle', 'esso', 'altro', 'altra', 'invece', 'stesso', 'stessa',
  'this', 'that', 'it', 'these', 'those', 'them', 'one', 'another', 'instead', 'same', 'else',
  'este', 'esta', 'esto', 'ese', 'esa', 'eso', 'otro', 'otra',
  'ce', 'cet', 'cette', 'ca', 'cela', 'autre',
  'das', 'dies', 'diese', 'dieser', 'dieses', 'es', 'andere', 'anderes',
  'isto', 'isso', 'outro', 'outra',
]);

// Domande sul locale: valgono uguali per chiunque, qualunque cosa si sia detto prima
const SUL_LOCALE = /\b(wifi|wi fi|password|carta|carte|bancomat|contanti|pagare|pagamento|bagno|bagni|toilet|toilette|orari|orario|aperti|aperto|chiudete|chiuso|prenot|parcheggio|cane|cani|animali|card|cash|pay|payment|restroom|bathroom|open|close|closing|booking|reservation|parking|dog|dogs|pets|tarjeta|efectivo|pagar|bano|abierto|reserva|aparcamiento|perro|carte bancaire|payer|ouvert|reservation|chien|karte|bar|toilette|offnungszeiten|hund)\b/;

/** La chiave con cui ricordare questa domanda, o null se non si puo' riusare. */
export function chiaveMemoria(messaggio: string, nomiPiatti: string[] = []): ChiaveMemoria | null {
  const msg = normalizza(messaggio);
  if (!msg) return null;
  const parole = msg.split(' ');
  // Le lingue senza spazi (cinese, giapponese) si contano a caratteri
  const corta = parole.length === 1 ? msg.length < 4 : parole.length < 3;
  if (corta || parole.length > 12 || msg.length > 90) return null;
  if (parole.some(p => RIMANDI.has(p))) return null;
  if (/\d/.test(msg)) return null;                              // persone, eta', quantita'
  if (PAROLE_ALLERGENI.some(p => msg.includes(p))) return null;  // allergie: sempre l'IA con il contesto
  if (parole.some(p => PAROLE_ALLERGENI_INTERE.includes(p))) return null;
  // Serve un soggetto chiaro: senza un piatto del menu o il locale nella
  // domanda, "che vino ci abbino?" o "e' piccante?" parlano di quello che
  // si e' detto prima, e senza la conversazione la risposta sarebbe sbagliata.
  const suUnPiatto = nomiPiatti.some(n => n && n.length >= 3 && (' ' + msg + ' ').includes(' ' + n + ' '));
  if (!suUnPiatto && !SUL_LOCALE.test(msg)) return null;
  return `q:${msg}`;
}

// Si alza quando cambiano le regole dell'assistente: tutte le risposte
// memorizzate con le regole vecchie smettono di valere, subito.
const VERSIONE_REGOLE = 6;   // 6: niente ingredienti o qualita' inventate   // 4: consigli con richiesta precisa, niente pulsanti inventati

/** Firma del menu: se cambia un piatto o un prezzo, i consigli si riscrivono. */
export function firmaMenu(piatti: Array<{ id: string; name: string; price: number | string }>): string {
  const base = `v${VERSIONE_REGOLE}|` + piatti.map(p => `${p.id}:${p.name}:${p.price}`).sort().join('|');
  return crypto.createHash('md5').update(base).digest('hex');
}

export async function leggiConsiglio(
  restaurantId: string, lang: string, tipo: TipoConsiglio | ChiaveMemoria, firma: string,
): Promise<{ testo: string; suggerimenti: string[] } | null> {
  try {
    const r = await db.query(
      `SELECT testo, suggerimenti, creato_il FROM consigli_pronti
       WHERE restaurant_id = $1 AND lang = $2 AND tipo = $3 AND menu_hash = $4`,
      [restaurantId, lang, tipo, firma],
    );
    const riga = r.rows[0];
    if (!riga || Date.now() - new Date(riga.creato_il).getTime() > VALIDITA_MS) return null;
    void db.query(
      `UPDATE consigli_pronti SET usato = usato + 1 WHERE restaurant_id = $1 AND lang = $2 AND tipo = $3`,
      [restaurantId, lang, tipo],
    ).catch(() => {});
    return { testo: riga.testo, suggerimenti: Array.isArray(riga.suggerimenti) ? riga.suggerimenti : [] };
  } catch {
    return null;   // tabella non ancora creata o database lento: decide l'IA
  }
}

export function salvaConsiglio(
  restaurantId: string, lang: string, tipo: TipoConsiglio | ChiaveMemoria, firma: string, testo: string, suggerimenti: string[],
): void {
  if (!testo.trim()) return;
  void db.query(
    `INSERT INTO consigli_pronti (restaurant_id, lang, tipo, menu_hash, testo, suggerimenti)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (restaurant_id, lang, tipo) DO UPDATE SET
       menu_hash = EXCLUDED.menu_hash, testo = EXCLUDED.testo,
       suggerimenti = EXCLUDED.suggerimenti, creato_il = NOW(), usato = 0`,
    [restaurantId, lang, tipo, firma, testo, JSON.stringify(suggerimenti ?? [])],
  ).catch(err => console.error('[consigli-pronti] non salvato:', err?.message ?? err));
}
