/**
 * Generatore di domande a scala: simula i CLIENTI, non il modello.
 *
 *   npm run genera-domande --workspace=packages/api
 *   npm run genera-domande --workspace=packages/api -- --ristoranti 40 --mostra 5
 *
 * Costruisce decine di migliaia di domande combinando i nomi veri dei piatti
 * dei menu veri, le 13 lingue, le forme colloquiali e gli errori di battitura
 * che i clienti fanno davvero ("sono ciliaco", niente accenti, tutto
 * maiuscolo), e le fa passare dalla stessa logica che gira in produzione.
 *
 * NON chiama nessun modello: non serve. Per verificare l'assistente conta
 * sapere CHI risponderebbe e SE la risposta rispetta le regole, e tutte e due
 * si misurano offline. La parte cara - la risposta del modello - e' proprio
 * quella che non serve per questo controllo.
 *
 * Non conta solo la copertura: controlla delle REGOLE che non devono mai
 * essere violate, e quando ne trova una rotta stampa la domanda esatta che
 * l'ha rotta. E' cosi' che si trovano i bug a mano non si trovano piu'.
 */
import 'dotenv/config';
import { db } from '../src/db/client';
import {
  rispostaDiretta, fuoriTema, normalizza, type PiattoBase,
} from '../src/services/risposte-dirette';
import { riconosciConsiglio } from '../src/services/consigli-pronti';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const QUANTI_RISTORANTI = Number(arg('ristoranti')) || 25;
const QUANTI_PIATTI = Number(arg('piatti')) || 12;
const MOSTRA = Number(arg('mostra')) || 3;

const LINGUE = ['it', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'zh', 'ja', 'ar', 'ko', 'id', 'hi'];

/** Cosa ci aspettiamo da ogni famiglia di domande. */
type Attesa = 'piatto' | 'allergeni' | 'ordine' | 'saluto' | 'fuoritema' | 'mai-allergeni' | 'consiglio';

// Frasi come le scrive un cliente. {p} = nome di un piatto del menu vero.
const FRASI: Record<Attesa, Record<string, string[]>> = {
  piatto: { '*': ['{p}'] },
  allergeni: {
    it: ['sono allergico al glutine', 'ho un allergia alle noci', 'sono celiaco', 'avete piatti senza lattosio', 'allergeni di {p}', '{p} ha glutine?'],
    en: ['i am allergic to gluten', 'i have a nut allergy', 'any dish without eggs?', 'allergens in {p}', 'is {p} gluten free?'],
    de: ['ich habe eine glutenallergie', 'haben sie gerichte ohne laktose?', 'allergene in {p}'],
    es: ['soy alergico al gluten', 'tengo alergia al marisco', 'hay platos sin lactosa?', 'alergenos de {p}'],
    fr: ['je suis allergique au gluten', 'avez-vous des plats sans lactose ?', 'allergenes de {p}'],
    pt: ['tenho alergia ao gluten', 'ha pratos sem lactose?'],
    ru: ['у меня аллергия на глютен', 'есть блюда без лактозы?'],
    zh: ['我对麸质过敏', '有无乳糖的菜吗？'],
    ja: ['グルテンアレルギーがあります', '乳糖なしの料理はありますか'],
    ar: ['لدي حساسية من الغلوتين', 'هل يوجد طبق بدون لاكتوز؟'],
    ko: ['글루텐 알레르기가 있어요', '유당 없는 요리 있어요?'],
    id: ['saya alergi gluten', 'ada hidangan tanpa laktosa?'],
    hi: ['मुझे ग्लूटेन से एलर्जी है', 'क्या लैक्टोज़ के बिना व्यंजन हैं?'],
  },
  // Parole di cibo SENZA allergia: non devono mai finire nel ramo allergeni
  'mai-allergeni': {
    it: ['avete del pesce?', 'che pesce avete oggi?', 'vorrei qualcosa con le uova', 'avete piatti con il latte?', 'mi piace il pesce'],
    en: ['do you have fish?', 'what fish do you serve?', 'any dish with eggs?', 'do you have milk for the coffee?'],
    de: ['haben sie fisch?', 'gibt es etwas mit eiern?'],
    es: ['teneis pescado?', 'hay algo con huevo?'],
    fr: ['avez-vous du poisson ?', 'y a-t-il quelque chose aux oeufs ?'],
    pt: ['tem peixe?'], ru: ['у вас есть рыба?'], zh: ['有鱼吗？'], ja: ['魚料理はありますか'],
    ar: ['هل يوجد سمك؟'], ko: ['생선 요리 있어요?'], id: ['ada ikan?'], hi: ['क्या मछली है?'],
  },
  ordine: {
    it: ['voglio ordinare', 'vorrei ordinare', 'lo prendo'], en: ['i want to order', 'can i order'],
    de: ['ich mochte bestellen'], es: ['quiero pedir'], fr: ['je voudrais commander'], pt: ['quero pedir'],
    ru: ['я хочу заказать'], zh: ['我要点菜'], ja: ['注文したい'], ar: ['أريد أن أطلب'],
    ko: ['주문할게요'], id: ['saya mau pesan'], hi: ['ऑर्डर करना है'],
  },
  saluto: {
    it: ['grazie', 'grazie!'], en: ['thank you', 'thanks'], de: ['danke'], es: ['gracias'],
    fr: ['merci'], pt: ['obrigado'], ru: ['спасибо'], zh: ['谢谢'], ja: ['ありがとう'],
    ar: ['شكرا'], ko: ['감사합니다'], id: ['terima kasih'], hi: ['धन्यवाद'],
  },
  fuoritema: {
    it: ['scrivimi una poesia sui gatti', 'raccontami una barzelletta', 'sei un robot?', 'chi ha vinto la partita di calcio?'],
    en: ['write me a poem about cats', 'tell me a joke', 'are you a robot?', 'who won the football match?'],
    de: ['erzahl mir einen witz'], es: ['escribeme un poema'], fr: ['raconte moi une blague'],
    pt: ['conta me uma piada'], ru: ['расскажи анекдот'], zh: ['写首诗给我'], ja: ['ジョークを言って'],
    ar: ['احك لي نكتة'], ko: ['농담 해주세요'], id: ['ceritakan lelucon'], hi: ['एक चुटकुला सुनाओ'],
  },
  consiglio: {
    it: ['cosa mi consigli?', 'sono vegetariano', 'menu degustazione per 2', 'menu bambini'],
    en: ['what do you recommend?', 'i am vegetarian'], de: ['was empfehlen sie?'], es: ['que me recomiendas?'],
    fr: ['que me conseillez-vous ?'], pt: ['o que me recomenda?'],
    ru: ['я вегетарианец'], zh: ['我是素食者'], ja: ['ベジタリアンです'], ar: ['أنا نباتي'],
    ko: ['채식주의자예요'], id: ['saya vegetarian'], hi: ['मैं शाकाहारी हूं'],
  },
};

/** Come il cliente sbaglia a scrivere. */
function storpia(s: string): Array<{ testo: string; sintetico: boolean }> {
  const fuori = [
    { testo: s, sintetico: false },
    { testo: s.toUpperCase(), sintetico: false },
    { testo: s.replace(/[?!.]/g, ''), sintetico: false },
  ];
  const senzaAccenti = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (senzaAccenti !== s) fuori.push({ testo: senzaAccenti, sintetico: false });
  // Due lettere scambiate. Questa e' una storpiatura INVENTATA da noi, non
  // una cosa che un cliente scrive davvero: si misura quanto l'assistente
  // regge, ma non si conta come errore. Pretendere che "graize" venga
  // riconosciuto vorrebbe dire mettere una somiglianza approssimata, e
  // quella fa piu' danni di quanti ne ripari.
  if (s.length > 6) {
    const i = Math.floor(s.length / 2);
    fuori.push({ testo: s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2), sintetico: true });
  }
  const visti = new Set<string>();
  return fuori.filter(x => x.testo && !visti.has(x.testo) && visti.add(x.testo));
}
// Errori di battitura veri, visti nei log
const SCRITTE_MALE: Record<string, string> = {
  'sono celiaco': 'sono ciliaco', 'i am allergic to gluten': 'im allergic to gluten',
  'sono allergico al glutine': 'sono alergico al glutine',
};

interface Rottura { regola: string; domanda: string; lingua: string; ricevuto: string }

async function main() {
  const rist = await db.query<{ id: string; name: string }>(
    `SELECT r.id, r.name FROM restaurants r
     WHERE r.assistente_attivo IS NOT false
       AND (SELECT count(*) FROM dishes d WHERE d.restaurant_id = r.id AND d.available) > 8
     ORDER BY r.id LIMIT $1`, [QUANTI_RISTORANTI]);   // non random: due giri devono confrontarsi

  const conta = new Map<string, number>();
  const rotture: Rottura[] = [];
  let domande = 0, sintetiche = 0, fragili = 0, troppoLunghe = 0;
  const rompe = (regola: string, domanda: string, lingua: string, ricevuto: string) =>
    rotture.push({ regola, domanda, lingua, ricevuto });

  for (const r of rist.rows) {
    const piatti = (await db.query<PiattoBase>(
      `SELECT id, name, coalesce(description,'') AS description, price,
              coalesce(category,'') AS category, allergens
       FROM dishes WHERE restaurant_id = $1 AND available = true`, [r.id])).rows;
    const nomi = piatti.map(d => normalizza(d.name));
    const campione = piatti.slice(0, QUANTI_PIATTI);

    for (const lingua of LINGUE) {
      for (const [attesa, perLingua] of Object.entries(FRASI) as Array<[Attesa, Record<string, string[]>]>) {
        const modelli = perLingua[lingua] ?? perLingua['*'] ?? [];
        for (const modello of modelli) {
          // {p} diventa ogni piatto del campione; senza {p} la frase vale com'e'
          const frasi = modello.includes('{p}')
            ? campione.map(d => modello.replace('{p}', d.name))
            : [modello, ...(SCRITTE_MALE[modello] ? [SCRITTE_MALE[modello]] : [])];

          for (const base of frasi) {
            for (const { testo: domanda, sintetico } of storpia(base)) {
              domande++;
              const consiglio = riconosciConsiglio(domanda, nomi);
              const fuori = fuoriTema(domanda, nomi);
              const r2 = await rispostaDiretta({
                restaurantId: r.id, dishes: piatti, language: lingua,
                currency: 'EUR', messaggio: domanda,
              });
              const chi = consiglio ? 'consiglio' : (r2 ? r2.intento : 'MODELLO');
              conta.set(chi, (conta.get(chi) ?? 0) + 1);
              if (sintetico) sintetiche++;

              // ── Le regole che non si possono rompere ────────────────────
              if (r2) {
                // "non trovo piatti senza glutine" NON e' una promessa: lo e'
                // solo se insieme alla formula ci sono dei piatti elencati.
                // E la scheda di un piatto e' esclusa: li' stiamo riportando
                // parola per parola la descrizione scritta dal ristoratore,
                // se e' lui a dire "gluten free" non lo stiamo dicendo noi.
                // Fuori dai nomi dei piatti: se "lactose free" sta dentro
                // **...** e' il nome che ha scritto il ristoratore, non una
                // promessa nostra ("Oat Milk / Bonsoy Milk (lactose free)").
                const senzaNomi = r2.message.replace(/\*\*[^*]*\*\*/g, ' ');
                if (r2.intento !== 'piatto' && /\*\*/.test(r2.message)
                    && /senza glutine|gluten[- ]?free|sin gluten|glutenfrei|senza lattosio|lactose free/i.test(senzaNomi))
                  rompe('promette "senza X" elencando piatti', domanda, lingua, r2.message.slice(0, 80));
                if (r2.message.includes('${'))
                  rompe('segnaposto rotto nel testo', domanda, lingua, r2.message.slice(0, 80));
                if (r2.intento === 'allergeni' && !/camerier|cucina|waiter|kitchen|staff|personal|bedienung|küche|kuche|camarero|cocina|serveur|cuisine|empregado|cozinha|официант|кухн|服务员|厨房|スタッフ|직원|주방|النادل|المطبخ|pelayan|dapur|वेटर|रसोई/i.test(r2.message))
                  rompe('allergeni senza rimando al personale', domanda, lingua, r2.message.slice(0, 80));
                const s = r2.suggestions ?? [];
                if (s.length === 0 || s.length > 3) rompe('pulsanti fuori numero', domanda, lingua, JSON.stringify(s));
                if (s.some(x => /\*\*/.test(x))) rompe('grassetto grezzo nei pulsanti', domanda, lingua, JSON.stringify(s));
              }
              if (attesa === 'mai-allergeni' && r2?.intento === 'allergeni')
                rompe('domanda normale finita negli allergeni', domanda, lingua, r2.message.slice(0, 70));
              if (sintetico) { if (chi === 'MODELLO') fragili++; continue; }
              if (attesa === 'fuoritema' && !fuori)
                rompe('fuori tema non riconosciuto', domanda, lingua, chi);
              if (attesa !== 'fuoritema' && fuori)
                rompe('domanda buona scambiata per fuori tema', domanda, lingua, chi);
              if (attesa === 'saluto' && chi !== 'saluto' && chi !== 'fuoritema')
                rompe('un grazie non riconosciuto', domanda, lingua, chi);
              if (attesa === 'allergeni' && chi !== 'allergeni') {
                // Oltre i settanta caratteri il database si rifiuta di
                // indovinare e passa al modello: e' una scelta, non un bug.
                // Qui succede quando il nome del piatto e' lunghissimo
                // ("is BUBBLE OF FLAVOUR / PANI PURI (6 Pcs) gluten free?").
                if (domanda.length > 70) troppoLunghe++;
                else rompe('allergia non riconosciuta', domanda, lingua, chi);
              }
            }
          }
        }
      }
    }
    process.stdout.write('.');
  }

  console.log(`\n\n${domande.toLocaleString('it')} domande generate su ${rist.rows.length} menu veri, ${LINGUE.length} lingue\n`);
  const ordinate = [...conta.entries()].sort((a, b) => b[1] - a[1]);
  for (const [chi, n] of ordinate) console.log(`  ${chi.padEnd(14)} ${String(n).padStart(6)}  ${(n / domande * 100).toFixed(1).padStart(5)}%`);
  const alModello = conta.get('MODELLO') ?? 0;
  console.log(`\n  database ${(100 - alModello / domande * 100).toFixed(1)}%   modello ${(alModello / domande * 100).toFixed(1)}%`);

  if (rotture.length === 0) { console.log('\nNessuna regola violata.'); process.exit(0); }
  const perRegola = new Map<string, Rottura[]>();
  for (const x of rotture) perRegola.set(x.regola, [...(perRegola.get(x.regola) ?? []), x]);
  console.log(`\n\n${rotture.length} VIOLAZIONI, in ${perRegola.size} regole diverse:\n`);
  for (const [regola, casi] of [...perRegola.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${casi.length}x  ${regola}`);
    for (const c of casi.slice(0, MOSTRA)) console.log(`        [${c.lingua}] «${c.domanda.slice(0, 60)}» -> ${c.ricevuto}`);
  }
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
