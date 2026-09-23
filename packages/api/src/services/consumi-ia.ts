/**
 * Consumi dell'IA: quanto spendiamo e fin dove si puo' spendere.
 *
 * - registraConsumo: dopo ogni risposta del modello salva chiamate, token e
 *   costo nella tabella consumi_ia (per giorno, ristorante, fornitore, modello).
 * - superatoLimite: prima di chiamare il modello controlla quante domande ha
 *   gia' fatto oggi quel ristorante. Oltre il limite si risponde solo con le
 *   risposte pronte (prezzi, allergeni, descrizioni, vini).
 *
 * PREZZI: si leggono dal .env come dollari per milione di token,
 *   <FORNITORE>_PRICE_IN e <FORNITORE>_PRICE_OUT   (es. GROQ_PRICE_IN=0.59)
 * Senza prezzo un fornitore vale 0: e' il caso dei piani gratuiti.
 * La chiave personale del ristoratore vale sempre 0 (la paga lui).
 *
 * Regola come per i contatori: misurare non deve mai rallentare ne' far
 * fallire una risposta al cliente.
 */
import { db } from '../db/client';

// ── I due tetti ─────────────────────────────────────────────────────────────
//
// 1. PER CLIENTE (LIMITE_IA_CLIENTE): cinque domande al modello dentro una
//    conversazione. E' il tetto vero, quello che si sente. E' per cliente e
//    non per ristorante perche' altrimenti il sesto cliente della giornata
//    trova l'assistente spento per colpa dei cinque di prima: non e' giusto
//    e non e' spiegabile a un ristoratore.
//
// 2. PER RISTORANTE E GIORNO (LIMITE_IA_GIORNO): non e' un tetto, e' un
//    paracadute. I limiti dei piani gratuiti di Groq e Mistral valgono per
//    ORGANIZZAZIONE, non per ristorante: senza questo, un solo locale con
//    duecento clienti curiosi brucia la quota di tutti gli altri 518 e la
//    piattaforma resta senza assistente. Va tenuto alto abbastanza da non
//    dare fastidio a un locale normale.
//
// Quello che risponde il DATABASE - piatti, prezzi, allergeni, ordini,
// saluti, fuori tema, consigli gia' in cache - non conta in nessuno dei due:
// non costa niente e non si raziona.
function daEnv(nome: string, predefinito: number): number {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v >= 0 ? v : predefinito;
}
const LIMITE_CLIENTE = daEnv('LIMITE_IA_CLIENTE', 5);
const LIMITE_CLIENTI = daEnv('LIMITE_IA_GIORNO', 200);
const LIMITE_DEMO = daEnv('LIMITE_IA_DEMO_GIORNO', 200);

function prezzo(fornitore: string, verso: 'IN' | 'OUT'): number {
  if (fornitore.includes('chiave del ristorante')) return 0;
  const P = fornitore.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return Number(process.env[`${P}_PRICE_${verso}`]) || 0;
}


export function registraConsumo(
  restaurantId: string,
  fornitore: string,
  modello: string,
  tokenIn: number,
  tokenOut: number,
): void {
  if (!restaurantId) return;
  const costo = (tokenIn * prezzo(fornitore, 'IN') + tokenOut * prezzo(fornitore, 'OUT')) / 1_000_000;
  void db.query(
    `INSERT INTO consumi_ia (giorno, restaurant_id, fornitore, modello, chiamate, token_in, token_out, costo_usd)
     VALUES (CURRENT_DATE, $1, $2, $3, 1, $4, $5, $6)
     ON CONFLICT (giorno, restaurant_id, fornitore, modello) DO UPDATE SET
       chiamate  = consumi_ia.chiamate + 1,
       token_in  = consumi_ia.token_in + EXCLUDED.token_in,
       token_out = consumi_ia.token_out + EXCLUDED.token_out,
       costo_usd = consumi_ia.costo_usd + EXCLUDED.costo_usd`,
    [restaurantId, fornitore, modello, Math.max(0, tokenIn | 0), Math.max(0, tokenOut | 0), costo],
  ).catch(err => console.error('[consumi-ia] non registrato:', err?.message ?? err));
}

/**
 * Questo cliente ha gia' fatto le sue domande al modello?
 *
 * Se la colonna non c'e' ancora (migrazione 027 non applicata) si risponde
 * "no" e si tira dritto: meglio nessun tetto che una chat rotta. Vale la
 * stessa regola di tutto il resto del file.
 */
export async function superatoLimiteCliente(sessionId?: string): Promise<boolean> {
  if (!sessionId || LIMITE_CLIENTE <= 0) return LIMITE_CLIENTE === 0;
  try {
    const r = await db.query<{ chiamate_ia: number }>(
      `SELECT chiamate_ia FROM chat_sessions WHERE id = $1`, [sessionId]);
    return (r.rows[0]?.chiamate_ia ?? 0) >= LIMITE_CLIENTE;
  } catch (err) {
    if (!avvisoColonna) {
      avvisoColonna = true;
      console.warn('[consumi-ia] tetto per cliente non attivo (manca la migrazione 027?):', (err as Error)?.message);
    }
    return false;
  }
}
let avvisoColonna = false;

/** Una domanda in piu' segnata a questo cliente. Si lancia e non si aspetta. */
export function segnaChiamataCliente(sessionId?: string): void {
  if (!sessionId) return;
  void db.query(
    `UPDATE chat_sessions SET chiamate_ia = chiamate_ia + 1 WHERE id = $1`, [sessionId],
  ).catch(() => { /* senza la colonna si prosegue: il tetto semplicemente non morde */ });
}

/** true se il ristorante ha gia' fatto oggi tutte le domande all'IA che gli spettano. */
export async function superatoLimite(restaurantId: string): Promise<boolean> {
  try {
    const r = await db.query(
      `SELECT r.is_demo, r.limite_ia_giorno,
              COALESCE((SELECT SUM(chiamate) FROM consumi_ia c
                        WHERE c.restaurant_id = r.id AND c.giorno = CURRENT_DATE), 0)::int AS oggi
       FROM restaurants r WHERE r.id = $1`,
      [restaurantId],
    );
    const riga = r.rows[0];
    if (!riga) return false;
    const limite = riga.limite_ia_giorno ?? (riga.is_demo ? LIMITE_DEMO : LIMITE_CLIENTI);
    return riga.oggi >= limite;
  } catch (err) {
    // Se il conteggio non riesce si risponde lo stesso: meglio una domanda in
    // piu' che un cliente senza risposta.
    console.error('[consumi-ia] controllo limite non riuscito:', err);
    return false;
  }
}

// Detto al cliente quando il limite di oggi e' finito: niente scuse tecniche,
// solo dove trovare la risposta.
const MSG_LIMITE: Record<string, string> = {
  it: 'Per questa domanda chiedi pure al personale, sarà felice di aiutarti. Io posso ancora dirti prezzi, ingredienti, allergeni e abbinamenti dei piatti del menu.',
  en: 'For this question please ask our staff, they will be happy to help. I can still tell you prices, ingredients, allergens and pairings for the dishes on the menu.',
  es: 'Para esta pregunta consulta al personal, estarán encantados de ayudarte. Todavía puedo decirte precios, ingredientes, alérgenos y maridajes de los platos.',
  fr: "Pour cette question, demandez au personnel, il se fera un plaisir de vous aider. Je peux toujours vous donner les prix, ingrédients, allergènes et accords des plats.",
  de: 'Für diese Frage wende dich bitte an das Personal. Ich kann dir weiterhin Preise, Zutaten, Allergene und passende Getränke zu den Gerichten nennen.',
  pt: 'Para esta pergunta fale com o pessoal, terão todo o gosto em ajudar. Ainda posso dizer-lhe preços, ingredientes, alergénios e harmonizações dos pratos.',
  zh: '这个问题请咨询服务员。我仍然可以告诉您菜单上菜品的价格、配料、过敏原和搭配。',
  ja: 'このご質問はスタッフにお尋ねください。メニューの料理の価格、材料、アレルゲン、相性の良い飲み物はお答えできます。',
  ko: '이 질문은 직원에게 문의해 주세요. 메뉴 요리의 가격, 재료, 알레르기 정보, 페어링은 계속 알려드릴 수 있어요.',
  ru: 'С этим вопросом обратитесь к персоналу, вам с радостью помогут. Я по-прежнему могу назвать цены, состав, аллергены и сочетания блюд из меню.',
  ar: 'لهذا السؤال اسأل طاقم المطعم، سيسعدهم مساعدتك. لا أزال أستطيع إخبارك بأسعار أطباق القائمة ومكوّناتها ومحسساتها والمشروبات المناسبة لها.',
  id: 'Untuk pertanyaan ini silakan tanya pelayan kami, mereka dengan senang hati membantu. Saya masih bisa menyebutkan harga, bahan, alergen, dan padanan minuman hidangan di menu.',
  hi: 'इस सवाल के लिए कृपया स्टाफ से पूछें, वे खुशी से मदद करेंगे। मैं अब भी मेन्यू के व्यंजनों के दाम, सामग्री, एलर्जी जानकारी और साथ में क्या पिएं, बता सकता हूं।',
};
export function messaggioLimite(lingua: string): string {
  return MSG_LIMITE[lingua] ?? MSG_LIMITE.en;
}
