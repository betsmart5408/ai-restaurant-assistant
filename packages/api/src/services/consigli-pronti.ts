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
import {
  normalizza, PAROLE_ALLERGENI, PAROLE_ALLERGENI_INTERE, SUGGERIMENTI_TUTTE_LE_LINGUE,
  PAROLE_VEGETARIANO, PAROLE_VEGANO, SCRITTURA_SENZA_SPAZI, normalizzaElenco, CONTESTO_ALLERGIA,
} from './risposte-dirette';

export type TipoConsiglio = 'consiglio' | 'degustazione2' | 'vegetariano' | 'bambini';

const VALIDITA_MS = 24 * 3600 * 1000;
const MAX_PAROLE = 8;

/** Le frasi si confrontano con il messaggio normalizzato: devono esserlo anche loro. */
function normalizzaFrasi(f: Record<TipoConsiglio, string[]>): Record<TipoConsiglio, string[]> {
  return Object.fromEntries(
    Object.entries(f).map(([k, v]) => [k, normalizzaElenco(v)]),
  ) as Record<TipoConsiglio, string[]>;
}

// Frasi (normalizzate: minuscole, senza accenti) che bastano da sole
const FRASI: Record<TipoConsiglio, string[]> = normalizzaFrasi({
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
  // Le forme latine si cercano come parola intera; quelle senza spazi
  // (cinese, giapponese, coreano) e l'arabo/hindi come pezzo di testo, piu'
  // sotto. Prima c'erano SOLO queste, quindi un cliente russo, cinese, arabo,
  // giapponese o coreano che diceva "sono vegetariano" finiva nel ramo degli
  // allergeni e si sentiva chiedere che allergia avesse.
  vegetariano: [
    'vegetariano', 'vegetariana', 'vegetariani', 'vegetariane', 'vegetarian',
    'vegetarien', 'vegetarienne', 'vegetarisch', 'vegetarier', 'vegetarier',
  ],
  bambini: [
    'per bambini', 'per un bambino', 'per una bambina', 'per i bambini', 'menu bambini',
    'for kids', 'for children', 'kids menu', 'for a child', 'for my kid', 'for the kids',
    'para ninos', 'menu infantil', 'pour enfants', 'menu enfant', 'fur kinder', 'kindermenu',
    'дети', 'для детей', 'детское меню',
    '儿童', '小孩', '子供', 'お子様', '어린이', '아이', 'للأطفال', 'anak', 'बच्चों',
  ],
});
// Numeri che fanno di "degustazione" una domanda per 2 (o senza numero)
const DUE = new Set(['2', 'due', 'two', 'dos', 'deux', 'zwei', 'dois', 'coppia', 'couple']);
// Vegetariano scritto in una lingua che non separa le parole con lo spazio
const VEGETARIANO_NON_LATINO = PAROLE_VEGETARIANO.filter(p => !/^[a-z]+$/.test(p));
/** Il messaggio parla di essere vegetariani (o vegani), in qualunque lingua. */
function parlaDiVegetariano(msg: string, parole: string[]): boolean {
  return parole.some(p => PAROLE_VEGETARIANO.includes(p)) || VEGETARIANO_NON_LATINO.some(p => msg.includes(p));
}
/** Vegano: l'elenco lo deve comporre l'IA, non abbiamo modo di escludere latte e uova. */
function parlaDiVegano(msg: string, parole: string[]): boolean {
  return parole.some(p => PAROLE_VEGANO.includes(p)) || PAROLE_VEGANO.filter(p => !/^[a-z]+$/.test(p)).some(p => msg.includes(p));
}

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

  // Allergie e intolleranze: sempre all'IA, con tutto il contesto.
  const veg = parlaDiVegetariano(msg, parole);
  const allergia = PAROLE_ALLERGENI.some(p => msg.includes(p)) ||
    // "soy vegetariano": in spagnolo "soy" vuol dire "sono", non soia
    parole.some(p => PAROLE_ALLERGENI_INTERE.includes(p) && !(p === 'soy' && veg));
  if (allergia) return null;
  // Vegano: senza il latte e le uova nelle ricette non possiamo scegliere noi
  if (parlaDiVegano(msg, parole)) return null;

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
  if (veg) return 'vegetariano';
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
// Le stesse domande fuori dall'alfabeto latino. Servono a parte perche' \b in
// JavaScript conosce solo le lettere latine: su cirillico, arabo, kana, hangul
// e devanagari non trova mai un confine di parola, quindi la riga qui sopra
// non poteva funzionare e ogni "avete il wifi?" costava una chiamata all'IA.
const SUL_LOCALE_NON_LATINO = normalizzaElenco([
  'вайфай', 'вай фай', 'карт', 'налич', 'оплат', 'туалет', 'часы работы', 'открыт', 'бронир', 'парковк', 'собак',
  'واي فاي', 'بطاقة', 'الدفع', 'حمام', 'حجز', 'موقف', 'كلب',
  '刷卡', '付款', '现金', '洗手间', '卫生间', '营业时间', '预订', '停车', '宠物',
  'ワイファイ', 'カード', '支払', '現金', 'トイレ', '営業時間', '予約', '駐車', 'ペット',
  '와이파이', '카드', '결제', '현금', '화장실', '영업시간', '예약', '주차', '반려동물',
  'वाईफाई', 'कार्ड', 'भुगतान', 'नकद', 'शौचालय', 'बुकिंग', 'पार्किंग',
]);

/** La chiave con cui ricordare questa domanda, o null se non si puo' riusare. */
export function chiaveMemoria(messaggio: string, nomiPiatti: string[] = []): ChiaveMemoria | null {
  const msg = normalizza(messaggio);
  if (!msg) return null;
  const parole = msg.split(' ');
  // Le lingue senza spazi (cinese, giapponese, coreano) si contano a
  // caratteri: a parole risulterebbero sempre troppo corte e non si
  // ricorderebbe mai niente.
  const senzaSpazi = SCRITTURA_SENZA_SPAZI.test(msg);
  const corta = senzaSpazi
    ? msg.replace(/\s/g, '').length < 4
    : (parole.length === 1 ? msg.length < 4 : parole.length < 3);
  if (corta || (!senzaSpazi && parole.length > 12) || msg.length > 90) return null;
  if (parole.some(p => RIMANDI.has(p))) return null;
  if (/\d/.test(msg)) return null;                              // persone, eta', quantita'
  // Allergie: sempre l'IA con il contesto, mai una risposta riusata. Ma
  // "pesce" e "uova" da sole sono cibo, non allergie: senza questo distinguo
  // "Avete del pesce?" non si ricordava mai e costava una chiamata a ogni
  // cliente. Stessa regola del ramo allergeni in risposte-dirette.ts.
  if (PAROLE_ALLERGENI.some(p => msg.includes(p))) return null;
  if (parole.some(p => PAROLE_ALLERGENI_INTERE.includes(p)) && CONTESTO_ALLERGIA.test(msg)) return null;
  // Serve un soggetto chiaro: senza un piatto del menu o il locale nella
  // domanda, "che vino ci abbino?" o "e' piccante?" parlano di quello che
  // si e' detto prima, e senza la conversazione la risposta sarebbe sbagliata.
  const suUnPiatto = nomiPiatti.some(n => n && n.length >= 3 && (' ' + msg + ' ').includes(' ' + n + ' '));
  if (!suUnPiatto && !SUL_LOCALE.test(msg) && !SUL_LOCALE_NON_LATINO.some(w => msg.includes(w))) return null;
  return `q:${msg}`;
}

// Si alza quando cambiano le regole dell'assistente: tutte le risposte
// memorizzate con le regole vecchie smettono di valere, subito.
const VERSIONE_REGOLE = 9;   // 9: allergeni che rispondono, vegetariani filtrati, nomi dal menu   // 6: niente ingredienti o qualita' inventate   // 4: consigli con richiesta precisa, niente pulsanti inventati

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
