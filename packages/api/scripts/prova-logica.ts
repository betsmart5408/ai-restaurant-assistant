/**
 * Banco di prova OFFLINE dell'assistente: esercita tutta la logica che
 * risponde SENZA il modello (risposte dirette, consigli pronti, memoria)
 * come farebbe un cliente al tavolo, in tutte le lingue.
 *
 *   npx tsx packages/api/scripts/prova-logica.ts
 *
 * Non tocca il database ne' i fornitori IA: non costa niente e si puo'
 * lanciare a ogni modifica. Esce con codice 1 se trova errori.
 */
import { db } from '../src/db/client';
import {
  rispostaDiretta, normalizza, svuotaCacheTraduzioni,
  abbinamentoValido, viniInCarta, categoriaVini, suggerimentiPredefiniti, sembraVegetariano,
  nominaAllergene, nonGiudicabilePer, piattiSenzaAllergeni, parolaAllergene,
  type PiattoBase,
} from '../src/services/risposte-dirette';
import { riconosciConsiglio, chiaveMemoria, firmaMenu } from '../src/services/consigli-pronti';
import { pulisciSuggerimenti } from '../src/services/ai-chat';
import { costruisciMenuPerPrompt } from '../src/services/menu-contesto';

// ── Finto database: nessuna traduzione, nessuna risposta scritta prima ──────
(db as unknown as { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }).query =
  async () => ({ rows: [] });

const MENU: PiattoBase[] = [
  { id: 'd1', name: 'Bruschetta al pomodoro', description: 'Pane, pomodoro, basilico', price: 6.5, category: 'Antipasti', allergens: ['glutine'] },
  { id: 'd2', name: 'Tagliere di salumi', description: 'Selezione di salumi locali', price: 14, category: 'Antipasti', allergens: [] },
  { id: 'd3', name: 'Carbonara', description: 'Guanciale, uovo, pecorino', price: 13, category: 'Primi', allergens: ['glutine', 'uova', 'latte'] },
  { id: 'd4', name: 'Tagliatelle al ragù', description: 'Ragù di manzo', price: 14, category: 'Primi', allergens: ['glutine', 'uova'] },
  { id: 'd5', name: 'Risotto ai funghi', description: 'Funghi porcini', price: 15, category: 'Primi', allergens: ['latte'] },
  { id: 'd6', name: 'Polpo alla griglia', description: 'Polpo, patate', price: 19, category: 'Secondi', allergens: ['molluschi'] },
  { id: 'd7', name: 'Tagliata di manzo', description: 'Controfiletto, rucola', price: 22, category: 'Secondi', allergens: [] },
  { id: 'd8', name: 'Tiramisù', description: 'Mascarpone, caffè', price: 6, category: 'Dolci', allergens: ['uova', 'latte', 'glutine'] },
  { id: 'd9', name: 'Insalata di stagione', description: 'Verdure fresche', price: 8, category: 'Contorni', allergens: [] },
  { id: 'd10', name: 'Sauvignon IGT Veneto', description: 'Bianco secco', price: 18, category: 'Vini bianchi', allergens: ['solfiti'] },
  { id: 'd11', name: 'Chianti Classico DOCG', description: 'Rosso strutturato', price: 24, category: 'Vini rossi', allergens: ['solfiti'] },
  { id: 'd12', name: 'Acqua naturale', description: '', price: 2, category: 'Bevande', allergens: [] },
];
const NOMI = MENU.map(d => normalizza(d.name));

let errori = 0, passati = 0;
function ok(cond: boolean, titolo: string, dettaglio = '') {
  if (cond) { passati++; return; }
  errori++;
  console.log(`  X ${titolo}${dettaglio ? `\n      ${dettaglio}` : ''}`);
}
function sezione(nome: string) { console.log(`\n-- ${nome} ${'-'.repeat(Math.max(0, 60 - nome.length))}`); }

async function chiedi(messaggio: string, language: string, extra: Record<string, unknown> = {}) {
  svuotaCacheTraduzioni();
  return rispostaDiretta({
    restaurantId: 'r1', dishes: MENU, language, currency: 'EUR', messaggio,
    ...extra,
  } as Parameters<typeof rispostaDiretta>[0]);
}

async function main() {
  sezione('1. Scheda piatto (il cliente tocca il nome in grassetto)');
  for (const lang of ['it', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'zh', 'ja', 'ar', 'ko', 'id', 'hi']) {
    const r = await chiedi('Carbonara', lang);
    ok(!!r && r.intento === 'piatto', `[${lang}] "Carbonara" -> scheda piatto`, `ricevuto: ${r?.intento ?? 'null'}`);
    ok(!!r && r.message.includes('13.00'), `[${lang}] prezzo nella scheda`, r?.message);
    ok(!!r && (r.suggestions?.length ?? 0) > 0, `[${lang}] suggerimenti presenti`);
  }
  const conAccento = await chiedi('tagliatelle al ragu', 'it');
  ok(conAccento?.intento === 'piatto', 'accenti: "ragu" trova "ragù"', conAccento?.message);

  sezione('2. Allergeni (la regola di sicurezza)');
  const casiAllergeni: Array<[string, string]> = [
    ['it', 'La carbonara ha allergeni?'],
    ['en', 'Does the carbonara have allergens?'],
    ['de', 'Hat die Carbonara Allergene?'],
    ['es', 'La carbonara tiene alergenos?'],
    ['fr', 'La carbonara a des allergenes ?'],
    ['pt', 'A carbonara tem alergenios?'],
    ['ru', 'В карбонаре есть аллергены? Carbonara'],
    ['zh', 'Carbonara 有过敏原吗？'],
    ['ja', 'Carbonaraにアレルギー物質は？'],
    ['ko', 'Carbonara 알레르기 있어요?'],
    ['ar', 'Carbonara حساسية'],
    ['id', 'Apakah Carbonara ada alergi?'],
    ['hi', 'Carbonara एलर्जी'],
  ];
  for (const [lang, msg] of casiAllergeni) {
    const r = await chiedi(msg, lang);
    ok(r?.intento === 'allergeni', `[${lang}] "${msg}" -> allergeni`, `ricevuto: ${r?.intento ?? 'null'} | ${r?.message?.slice(0, 70)}`);
    if (r?.intento === 'allergeni') {
      const garanzia = /senza glutine|gluten[- ]?free|sin gluten|glutenfrei/i.test(r.message);
      ok(!garanzia, `[${lang}] nessuna garanzia "senza glutine"`, r.message);
    }
  }
  const alEn = await chiedi('Does the carbonara have allergens?', 'en');
  ok(!!alEn && /gluten/i.test(alEn.message) && /eggs/i.test(alEn.message) && /milk/i.test(alEn.message),
    '[en] allergeni tradotti in inglese', alEn?.message);
  const alDe = await chiedi('Hat die Carbonara Allergene?', 'de');
  ok(!!alDe && /Gluten/.test(alDe.message) && /Eier/.test(alDe.message), '[de] allergeni tradotti in tedesco', alDe?.message);

  const senza = await chiedi('La tagliata ha allergeni?', 'it');
  ok(senza?.intento === 'allergeni' && /non ha ancora registrato/i.test(senza.message),
    'piatto senza allergeni -> frase "non registrati"', senza?.message);

  for (const [lang, msg] of [['it', "Ho un'allergia"], ['en', 'I have an allergy'], ['es', 'Tengo una alergia'], ['ja', 'アレルギーがあります']] as Array<[string, string]>) {
    const r = await chiedi(msg, lang);
    ok(r?.intento === 'allergeni', `[${lang}] "${msg}" -> chiede quale piatto`, `ricevuto: ${r?.intento ?? 'null'}`);
  }

  sezione('3. Trappole note');
  const soyEs = await chiedi('Soy vegetariano', 'es');
  console.log(`      "Soy vegetariano" (es) -> ${soyEs?.intento ?? "null (va all'IA)"}`);
  const veg = riconosciConsiglio('Soy vegetariano', NOMI);
  ok(veg === 'vegetariano', '[es] "Soy vegetariano" -> consiglio vegetariano', `ricevuto: ${veg}`);
  const donut = await chiedi('donut', 'en');
  console.log(`      "donut" (en) -> ${donut?.intento ?? 'null'}`);
  const pasta = await chiedi('la pasta ha glutine?', 'it');
  console.log(`      "la pasta ha glutine?" (it) -> ${pasta?.intento ?? 'null'} | ${pasta?.message?.slice(0, 80) ?? ''}`);

  sezione('4. Voglio ordinare');
  const ordini: Array<[string, string]> = [
    ['it', 'Voglio ordinare'], ['en', 'I want to order'], ['de', 'Ich mochte bestellen'],
    ['es', 'Quiero pedir'], ['fr', 'Je voudrais commander'], ['pt', 'Quero pedir'],
    ['ru', 'Я хочу заказать'], ['zh', '我要点菜'], ['ja', '注文したい'],
    ['ko', '주문할게요'], ['id', 'Saya mau pesan'], ['hi', 'ऑर्डर करना है'], ['ar', 'أريد أن أطلب'],
  ];
  for (const [lang, msg] of ordini) {
    const r = await chiedi(msg, lang);
    ok(r?.intento === 'ordine', `[${lang}] "${msg}" -> ordine`, `ricevuto: ${r?.intento ?? 'null'}`);
  }

  sezione('5. Grazie');
  const grazie: Array<[string, string]> = [
    ['it', 'Grazie!'], ['en', 'Thank you'], ['de', 'Danke'], ['es', 'Gracias'],
    ['fr', 'Merci'], ['pt', 'Obrigado'], ['ru', 'Спасибо'], ['zh', '谢谢'],
    ['ja', 'ありがとう'], ['ko', '감사합니다'], ['id', 'Terima kasih'], ['hi', 'धन्यवाद'], ['ar', 'شكرا'],
  ];
  for (const [lang, msg] of grazie) {
    const r = await chiedi(msg, lang);
    ok(r?.intento === 'saluto', `[${lang}] "${msg}" -> grazie`, `ricevuto: ${r?.intento ?? 'null'}`);
  }
  const grazieMa = await chiedi('Grazie, ma cosa mi consigli?', 'it');
  ok(grazieMa === null, '"Grazie, ma cosa mi consigli?" NON e\' un saluto', `ricevuto: ${grazieMa?.intento}`);

  sezione('6. Consigli pronti (riconoscimento)');
  const consigli: Array<[string, string | null]> = [
    ['Cosa mi consigli?', 'consiglio'],
    ['What do you recommend?', 'consiglio'],
    ['¿Que me recomiendas?', 'consiglio'],
    ['Was empfehlen Sie?', 'consiglio'],
    ['Que me conseillez-vous ?', 'consiglio'],
    ['O que me recomenda?', 'consiglio'],
    ['Menu degustazione per 2', 'degustazione2'],
    ['Tasting menu for 2', 'degustazione2'],
    ['Menu degustacion para 2', 'degustazione2'],
    ['Sono vegetariano', 'vegetariano'],
    ['I am vegetarian', 'vegetariano'],
    ['Ich bin vegetarisch', 'vegetariano'],
    ['Menu per bambini', 'bambini'],
    ['Do you have a kids menu?', 'bambini'],
    ['Siamo in due, uno e celiaco, cosa ci consigli?', null],
    ['Menu degustazione per 4', null],
    ['Sono vegano', null],
    ['Что вы рекомендуете?', null],
    // I nostri pulsanti, invece, si riconoscono in ogni lingua (testo identico)
    ['有什么推荐？', 'consiglio'],
    ['おすすめは？', 'consiglio'],
    ['추천해 주세요', 'consiglio'],
  ];
  for (const [msg, atteso] of consigli) {
    const r = riconosciConsiglio(msg, NOMI);
    ok(r === atteso, `"${msg}" -> ${atteso ?? 'IA'}`, `ricevuto: ${r ?? 'IA'}`);
  }

  sezione('7. Memoria (risposte riusate fra clienti diversi)');
  const memoria: Array<[string, boolean]> = [
    ['Avete il wifi?', true],
    ['Do you have wifi?', true],
    ['Posso pagare con la carta?', true],
    ['La carbonara e piccante?', true],
    ['E questo?', false],
    ['Che vino ci abbino?', false],
    ['Siamo in 4', false],
    ["Ho un'allergia alle noci", false],
  ];
  for (const [msg, atteso] of memoria) {
    const k = chiaveMemoria(msg, NOMI);
    ok(!!k === atteso, `"${msg}" -> ${atteso ? 'ricordabile' : 'NON ricordabile'}`, `chiave: ${k}`);
  }
  for (const msg of ['有 wifi 吗', 'Wi-Fiはありますか', '와이파이 있어요?', 'هل لديكم واي فاي؟', 'Есть ли у вас вайфай?']) {
    const k = chiaveMemoria(msg, NOMI);
    console.log(`      "${msg}" -> ${k ? 'ricordabile' : 'NON ricordabile (ogni cliente ricosta una chiamata)'}`);
  }

  sezione('8. Abbinamento vino');
  const vini = viniInCarta(MENU);
  ok(vini.length === 2, 'due vini riconosciuti in carta', JSON.stringify(vini));
  ok(abbinamentoValido('Ti consiglio il Chianti Classico', vini), 'abbinamento con vino in carta -> valido');
  ok(!abbinamentoValido('Ti consiglio un Greco di Tufo', vini), 'abbinamento con vino NON in carta -> scartato');
  ok(categoriaVini('Vini rossi') && !categoriaVini('Primi'), 'categoria vini riconosciuta');

  sezione('9. Menu nel prompt');
  const m = costruisciMenuPerPrompt(MENU, 'cosa mi consigli');
  ok(!m.parziale && m.inclusi === MENU.length, 'menu piccolo -> intero nel prompt');
  ok(m.testo.includes('Carbonara 13.00 [glutine,uova,latte]'), 'formato compatto con allergeni', m.testo.split('\n')[1]);
  const grande = Array.from({ length: 200 }, (_, i) => ({ ...MENU[i % MENU.length], id: `g${i}`, name: `Piatto ${i}` }));
  const mg = costruisciMenuPerPrompt(grande, 'pasta');
  ok(mg.parziale, 'menu enorme -> selezione attiva');
  ok(mg.testo.includes('Altri piatti del menu'), 'i nomi degli esclusi ci sono comunque');

  sezione('10. Firma menu');
  const f1 = firmaMenu(MENU);
  const f2 = firmaMenu([...MENU].reverse());
  ok(f1 === f2, "firma indipendente dall'ordine");
  const f3 = firmaMenu(MENU.map(d => d.id === 'd3' ? { ...d, price: 14 } : d));
  ok(f1 !== f3, 'prezzo cambiato -> firma diversa');

  sezione('11. Allergia dichiarata: si risponde, non si richiede');
  const dichiarate: Array<[string, string, string]> = [
    ['it', 'Ho un\'allergia al glutine', 'glutine'],
    ['en', 'I have a nut allergy, what can I eat?', 'tree nuts'],
    ['de', 'Ich habe eine Glutenallergie', 'Gluten'],
    ['es', 'Tengo alergia al marisco', 'crust'],
    ['fr', 'Je suis allergique au gluten', 'gluten'],
    ['pt', 'Tenho alergia ao glúten', 'gl'],
    ['ru', 'У меня аллергия на глютен', 'глютен'],
    ['zh', '我对麸质过敏', '麸质'],
    ['ja', 'グルテンアレルギーがあります', 'グルテン'],
    ['ko', '글루텐 알레르기가 있어요', '글루텐'],
    ['ar', 'لدي حساسية من الغلوتين', 'الغلوتين'],
    ['id', 'Saya alergi gluten', 'gluten'],
    ['hi', 'मुझे ग्लूटेन से एलर्जी है', 'ग्लूटेन'],
  ];
  for (const [lang, msg, allergene] of dichiarate) {
    const r = await chiedi(msg, lang);
    ok(r?.intento === 'allergeni', `[${lang}] "${msg}" -> allergeni`, `ricevuto: ${r?.intento ?? 'null'}`);
    ok(!!r && r.message.includes('**'), `[${lang}] elenca dei piatti, non richiede l'allergia`, r?.message?.slice(0, 90));
    ok(!!r && r.message.includes(allergene), `[${lang}] nomina l'allergene nella lingua giusta`, r?.message?.slice(0, 90));
  }
  // I piatti elencati non devono avere quell'allergene registrato
  const senzaGlutine = await chiedi("Ho un'allergia al glutine", 'it');
  for (const d of MENU.filter(x => x.allergens.includes('glutine'))) {
    ok(!senzaGlutine!.message.includes(d.name), `glutine: "${d.name}" NON compare`, senzaGlutine?.message);
  }
  ok(senzaGlutine!.message.includes('Risotto ai funghi'), 'glutine: il risotto compare', senzaGlutine?.message);
  // Nessun allergene registrato (il caso di TUTTI i ristoranti oggi): si
  // legge il testo scritto dal ristoratore, e si consiglia solo il leggibile.
  const MENU_NUDO = MENU.map(d => ({ ...d, allergens: [] }));
  svuotaCacheTraduzioni();
  const nudo = await rispostaDiretta({
    restaurantId: 'r2', dishes: MENU_NUDO,
    language: 'it', currency: 'EUR', messaggio: "Ho un'allergia al glutine",
  });
  ok(!!nudo && /cameriere/i.test(nudo.message), 'rimanda sempre al cameriere', nudo?.message);
  ok(!!nudo && /per sicurezza/i.test(nudo.message), 'lo dice come "per sicurezza"', nudo?.message);
  ok(!!nudo && !/senza glutine|gluten free/i.test(nudo.message), 'non dice MAI "senza glutine"', nudo?.message);

  const sceltaGlutine = piattiSenzaAllergeni(MENU_NUDO, ['glutine']);
  for (const d of MENU.filter(x => x.allergens.includes('glutine'))) {
    ok(!sceltaGlutine.consigliati.some(c => c.name === d.name), `"${d.name}" non finisce fra i consigli`);
  }
  ok(!sceltaGlutine.consigliati.some(c => c.name === 'Acqua naturale'), 'niente bevande fra i consigli');

  sezione('11a. Chi NON parla di allergie prosegue normalmente');
  // "pesce", "uova", "latte", "nut" sono parole di allergeni ma anche di
  // cibo. Senza questo controllo "Avete del pesce?" si sentiva rispondere
  // "questi piatti non nominano pesce": dieci domande normali su ventisei
  // finivano nel ramo allergeni.
  const NORMALI: Array<[string, string]> = [
    ['it', 'Avete del pesce?'], ['it', 'Che pesce avete oggi?'], ['it', 'Mi piace il pesce'],
    ['it', 'Vorrei qualcosa con le uova'], ['it', 'Avete piatti con il latte?'],
    ['it', 'Quanto costa la carbonara?'], ['it', 'Avete il pane?'],
    ['en', 'Do you have fish?'], ['en', 'What fish do you serve?'], ['en', 'I love fish'],
    ['en', 'Any dish with eggs?'], ['en', 'Do you have milk for the coffee?'],
    ['en', 'Do you serve free range eggs?'],
    ['es', 'Teneis pescado?'], ['es', 'Hay algo con huevo?'], ['de', 'Haben Sie Fisch?'],
    ['fr', 'Avez-vous du poisson ?'], ['zh', '有鱼吗？'], ['ko', '생선 요리 있어요?'],
  ];
  for (const [lang, msg] of NORMALI) {
    const r = await chiedi(msg, lang);
    ok(r?.intento !== 'allergeni', `[${lang}] "${msg}" NON e\' una domanda sulle allergie`,
      r?.message?.split('\n')[0]?.slice(0, 80));
  }
  // E invece queste lo sono, e devono continuare a esserlo
  const VERE: Array<[string, string]> = [
    ['it', "Ho un'allergia al pesce"], ['it', 'Avete piatti senza uova?'], ['it', 'Sono intollerante al latte'],
    ['en', 'I have a nut allergy'], ['en', 'Any dish without eggs?'], ['en', 'I am allergic to fish'],
    ['es', 'Tengo alergia al marisco'], ['de', 'Ich habe eine Fischallergie'],
    ['ja', '魚アレルギーがあります'], ['ko', '생선 알레르기가 있어요'],
  ];
  for (const [lang, msg] of VERE) {
    const r = await chiedi(msg, lang);
    ok(r?.intento === 'allergeni', `[${lang}] "${msg}" E' una domanda sulle allergie`, `ricevuto: ${r?.intento ?? 'null'}`);
  }
  // E la memoria segue la stessa regola: "avete del pesce" si puo' ricordare
  ok(chiaveMemoria('la carbonara ha il pesce', NOMI) !== null,
    'domanda normale su un piatto con la parola "pesce" -> ricordabile', String(chiaveMemoria('la carbonara ha il pesce', NOMI)));
  ok(chiaveMemoria('la carbonara e senza uova', NOMI) === null, 'stessa domanda ma con "senza" -> mai ricordata');
  ok(chiaveMemoria('ho un allergia al pesce', NOMI) === null, 'domanda con allergia -> mai ricordata');

  sezione('11z. Il rimando al personale c\'e\' SEMPRE, in ogni lingua');
  // La regola non negoziabile: qualunque risposta che tocchi le allergie deve
  // mandare al cameriere o alla cucina. Qui si controlla ogni ramo in ogni
  // lingua, perche' basta una traduzione dimenticata per perderlo.
  const PERSONALE: Record<string, RegExp> = {
    it: /cameriere|cucina/i, en: /waiter|kitchen|staff/i, de: /Bedienung|Küche|Personal/i,
    es: /camarero|cocina/i, fr: /serveur|cuisine/i, pt: /empregado|cozinha/i,
    ru: /официант|кухн/i, zh: /服务员|厨房/, ja: /スタッフ|厨房/,
    ar: /النادل|المطبخ/, ko: /직원|주방/, id: /pelayan|dapur/i,
    hi: /वेटर|रसोई/,
  };
  const RAMI: Array<[string, string, PiattoBase[]]> = [
    ['consiglia i piatti', 'I am allergic to crustaceans', MENU_NUDO],
    ['avvisa sul piatto', 'is the Bruschetta gluten free?', MENU_NUDO],
    ['allergeni registrati', 'Does the Carbonara have allergens?', MENU],
    ['non registrati', 'Does the Tagliata have allergens?', MENU],
    ['chiede quale piatto', 'I have an allergy', MENU_NUDO],
  ];
  for (const lang of ['it', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'zh', 'ja', 'ar', 'ko', 'id', 'hi']) {
    for (const [ramo, msg, menu] of RAMI) {
      svuotaCacheTraduzioni();
      const r = await rispostaDiretta({ restaurantId: `p-${lang}`, dishes: menu, language: lang, currency: 'EUR', messaggio: msg });
      ok(r?.intento === 'allergeni', `[${lang}] ${ramo}: risponde`, `ricevuto: ${r?.intento ?? 'null'}`);
      if (r) ok(PERSONALE[lang].test(r.message), `[${lang}] ${ramo}: manda al personale`, r.message.replace(/\n/g, ' / ').slice(0, 110));
    }
  }

  sezione('11b. Una carta dei vini non e\' cibo');
  // Categorie vere di China Doll: nessuna contiene la parola "wine"
  const CARTA_VINI = [
    { name: '24 Mezzo Pinot Grigio', description: 'Fresh and citrusy from the Adelaide Hills', category: 'BIG & BOLD WHITES' },
    { name: 'NV AMANOTO Junmai Ginjo', description: 'Delicate sake with floral aromas and a clean finish', category: 'SAKE BY THE GLASS / BOTTLE' },
    { name: "WILLIE SMITH'S Apple Cider", description: 'Organic cider pressed from Tasmanian apples', category: 'CIDER' },
    { name: '25 Supernatural', description: 'Skin contact white with apricot and spice notes', category: 'ORANGE/SKIN CONTACT' },
    { name: 'Vickery Riesling', description: 'Lime and mineral notes from Polish Hill River', category: 'ROSE' },
    { name: 'Insalata di stagione', description: 'Verdure fresche di stagione con olio extravergine', category: 'contorni' },
  ];
  {
    const r = piattiSenzaAllergeni(CARTA_VINI, ['sesamo']);
    ok(r.consigliati.length === 1 && r.consigliati[0].name === 'Insalata di stagione',
      'dalla carta dei vini si salva solo il cibo', JSON.stringify(r.consigliati.map(x => x.name)));
  }

  sezione('11c. La cucina conta piu\' del singolo piatto');
  const MENU_THAI = [
    { name: 'Tom Yum Gai', description: 'Hot and sour soup with chicken, lemongrass and kaffir lime leaves', category: 'soups' },
    { name: 'Som Tum', description: 'Green papaya salad with lime juice, chilli and long beans', category: 'salads' },
    { name: 'Pad See Ew', description: 'Stir-fried noodles with Chinese broccoli and egg', category: 'noodles' },
    { name: 'Nam Tok', description: 'Grilled beef salad with mint, chilli powder and lime dressing', category: 'salads' },
    { name: 'Po Taek', description: 'Clear spicy soup with mixed seafood and Thai herbs', category: 'soups' },
    { name: 'Massaman Curry', description: 'Slow cooked curry with potato and onion', category: 'curries' },
    { name: 'Chicken Wing', description: 'Deep fried chicken wings served with sweet chilli sauce', category: 'entrees' },
    { name: 'Sai Krok Isaan', description: 'Northeastern fermented pork sausage with fresh ginger', category: 'entrees' },
    { name: 'Larb Gai', description: 'Minced chicken salad with toasted rice and mint', category: 'salads' },
    { name: 'Green Curry', description: 'Coconut curry with bamboo shoots and Thai basil', category: 'curries' },
  ];
  for (const a of ['arachidi', 'frutta a guscio', 'sesamo', 'glutine', 'crostacei']) {
    ok(piattiSenzaAllergeni(MENU_THAI, [a]).pervasivo,
      `cucina thai + ${a} -> non propone niente, manda al personale`);
  }
  const MENU_INDIANO = [
    { name: 'Butter Chicken', description: 'Chicken in a rich tomato gravy finished with cream', category: 'mains' },
    { name: 'Chicken Tikka', description: 'Char grilled chicken marinated in yoghurt and spices', category: 'tandoor' },
    { name: 'Lamb Rogan Josh', description: 'Slow cooked lamb curry with Kashmiri chilli', category: 'mains' },
    { name: 'Garlic Naan', description: 'Tandoor baked flatbread brushed with garlic butter', category: 'breads' },
    { name: 'Saag Paneer', description: 'Spinach cooked with Indian cottage cheese', category: 'mains' },
    { name: 'Vegetable Biryani', description: 'Basmati rice layered with seasonal vegetables', category: 'rice' },
    { name: 'Samosa', description: 'Crisp pastry parcels filled with spiced potato and peas', category: 'entrees' },
    { name: 'Dal Tadka', description: 'Yellow lentils tempered with cumin and curry leaves', category: 'mains' },
    { name: 'Aloo Tikki', description: 'Potato patties with chaat masala and tamarind', category: 'entrees' },
    { name: 'Mango Lassi', description: 'Sweet yoghurt drink blended with mango pulp', category: 'drinks' },
  ];
  for (const a of ['frutta a guscio', 'latte', 'sesamo']) {
    ok(piattiSenzaAllergeni(MENU_INDIANO, [a]).pervasivo, `cucina indiana + ${a} -> non propone niente`);
  }
  // Su un menu italiano, invece, le arachidi non sono di casa: li' si propone
  ok(!piattiSenzaAllergeni(MENU_NUDO, ['arachidi']).pervasivo, 'cucina italiana + arachidi -> propone');

  sezione('11d. Quando l\'allergene e\' in mezzo menu non si sceglie');
  {
    const meta = Array.from({ length: 20 }, (_, i) => i < 9
      ? { name: `Pasta ${i}`, description: 'Pasta fresca fatta in casa con pomodoro e basilico', category: 'primi' }
      : { name: `Secondo ${i}`, description: 'Carne alla griglia con contorno di verdure di stagione', category: 'secondi' });
    ok(piattiSenzaAllergeni(meta, ['glutine']).pervasivo, 'glutine in 9 piatti su 20 -> non propone niente');
  }

  sezione('12. Il testo del piatto tradisce l\'allergene');
  const spie: Array<[string, string, string, string]> = [
    ['Caesar Salad', 'Lechuga romana con pollo, bacon, picatostes y parmesano', 'glutine', 'picatostes = pane'],
    ['Pistacchino', 'Paccheri con pesto de pistacho y crema de burrata', 'glutine', 'paccheri = pasta'],
    ['Steak Sandwich', 'Served on sourdough with beetroot and fried onion', 'glutine', 'sourdough'],
    ['Nasi Lemak', 'Coconut rice w/ ikan billis, sambal, achar and cucumber', 'pesce', 'ikan billis = acciughe'],
    ['Nasi Lemak', 'Coconut rice w/ ikan billis, sambal, achar and cucumber', 'crostacei', 'sambal = pasta di gamberetti'],
    ['Chicken Satay', 'Grilled chicken skewers with satay sauce', 'arachidi', 'satay = arachidi'],
    ['Butter Chicken', 'Chicken cooked in ghee with tomato and spices', 'latte', 'ghee = burro'],
    ['Garlic Naan', 'Freshly baked naan with garlic and coriander', 'glutine', 'naan'],
    ['Prawn Tempura', 'Lightly battered prawns with tempura flakes', 'crostacei', 'prawns'],
    ['Hummus Plate', 'Chickpea hummus with tahini and olive oil', 'sesamo', 'tahini'],
    ['Miso Soup', 'Traditional miso broth with tofu and seaweed', 'soia', 'miso e tofu'],
    ['Pad Thai', 'Rice noodles with fish sauce, egg and peanuts', 'pesce', 'fish sauce'],
  ];
  for (const [nome, descr, allergene, perche] of spie) {
    ok(nominaAllergene(`${nome} ${descr}`, allergene), `"${nome}" -> ${allergene} (${perche})`);
  }
  // E al contrario: un piatto che davvero non lo nomina non deve scattare
  ok(!nominaAllergene('Insalata di stagione Verdure fresche di stagione', 'glutine'), 'insalata semplice: nessun falso allarme sul glutine');
  ok(!nominaAllergene('Pollo alla griglia Filete de pollo a la plancha con ensalada', 'crostacei'), 'pollo grigliato: nessun falso allarme sui crostacei');

  // La frase deve citare la parola del menu, non il nome dell'allergene
  ok(parolaAllergene('Caesar Salad Lechuga con pollo, bacon, picatostes y salsa cesar', 'glutine') === 'picatostes',
    'si cita "picatostes", non "glutine"', String(parolaAllergene('Caesar Salad picatostes', 'glutine')));
  ok(parolaAllergene('Murgh Makhani cooked in ghee with tomato', 'latte') === 'ghee', 'si cita "ghee"');
  {
    // "nella descrizione ha scritto carbonara" era il nome del piatto, non un ingrediente
    const r = await rispostaDiretta({ restaurantId: 'rz', dishes: MENU_NUDO, language: 'it', currency: 'EUR',
      messaggio: 'La carbonara e senza glutine?' });
    ok(!!r && !/ha scritto carbonara/i.test(r.message), 'non cita il nome del piatto come ingrediente', r?.message);
    ok(!!r && /cameriere|cucina/i.test(r.message), 'e rimanda comunque al personale', r?.message);
  }
  {
    const conCrostini = [{ id: 'x', name: 'Caesar Salad', description: 'Lattuga romana con pollo, bacon e crostini', price: 14, category: 'antipasti', allergens: [] }];
    const r = await rispostaDiretta({ restaurantId: 'rz2', dishes: conCrostini, language: 'it', currency: 'EUR',
      messaggio: 'Il Caesar Salad e senza glutine?' });
    ok(!!r && /crostini/i.test(r.message), 'ma cita la parola vera della descrizione', r?.message);
  }
  ok(parolaAllergene('Butter Chicken with tomato', 'latte') === 'butter', 'si cita la parola che compare davvero nel menu');

  sezione('13. Piatti su cui non ci si sbilancia');
  // Casi veri trovati provando sul menu di Gusto Alcazabilla
  ok(nonGiudicabilePer('Risotto Profumo di Mare Arroz con tomate cherry, almejas, mejillones, calamar', 'crostacei'),
    "risotto di mare -> non consigliato a chi e' allergico ai crostacei");
  ok(nominaAllergene('Calzone Napoletano Ricota, salami napolitano, salsa de tomate', 'glutine'),
    "il calzone e' pasta di pizza -> glutine");
  ok(nonGiudicabilePer('Pan di Stelle Postre en capas de crema y cacao con galleta', 'frutta a guscio'),
    "un dolce -> non consigliato a chi e' allergico alla frutta a guscio");
  ok(nonGiudicabilePer('Calamari fritti croccanti', 'glutine'), 'fritto -> non giudicabile per il glutine (olio condiviso)');
  ok(nonGiudicabilePer('Paella de marisco mixta', 'crostacei'), 'paella -> non giudicabile per i crostacei');
  ok(nonGiudicabilePer('Minestrone brodo di verdure', 'sedano'), 'brodo -> non giudicabile per il sedano');
  ok(nonGiudicabilePer('Mixed salad with house dressing', 'senape'), 'dressing della casa -> non giudicabile per la senape');
  {
    const soloNome = [{ name: 'Piatto misterioso', description: '', price: 9, category: 'primi' }];
    const r = piattiSenzaAllergeni(soloNome, ['glutine']);
    ok(r.consigliati.length === 0 && r.nonLeggibili === 1, 'piatto senza descrizione -> mai consigliato');
  }
  {
    const fritto = [{ name: 'Calamari fritti', description: 'Calamari fritti croccanti serviti con limone', price: 12, category: 'antipasti' }];
    ok(piattiSenzaAllergeni(fritto, ['glutine']).consigliati.length === 0, 'fritto -> mai consigliato a un celiaco');
  }

  sezione('14. La risposta all\'allergia, in tutte le lingue');
  for (const lang of ['it', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'zh', 'ja', 'ar', 'ko', 'id', 'hi']) {
    svuotaCacheTraduzioni();
    const r = await rispostaDiretta({
      restaurantId: 'r3', dishes: MENU_NUDO, language: lang, currency: 'EUR',
      messaggio: lang === 'it' ? "Sono allergico ai crostacei" : 'I am allergic to crustaceans',
    });
    ok(r?.intento === 'allergeni', `[${lang}] risponde`, `ricevuto: ${r?.intento}`);
    ok(!!r && r.message.trim().length > 40, `[${lang}] risposta non vuota`);
    ok(!!r && !r.message.includes('${'), `[${lang}] nessun segnaposto rotto nel testo`, r?.message);
  }

  sezione('15. Vegetariano: scelta, non allergia');
  const vegetariani: Array<[string, string]> = [
    ['it', 'Sono vegetariano'], ['en', 'I am vegetarian'], ['de', 'Ich bin Vegetarier'],
    ['es', 'Soy vegetariano'], ['fr', 'Je suis végétarien'], ['pt', 'Sou vegetariano'],
    ['ru', 'Я вегетарианец'], ['zh', '我是素食者'], ['ja', 'ベジタリアンです'],
    ['ko', '채식주의자예요'], ['ar', 'أنا نباتي'], ['id', 'Saya vegetarian'],
    ['hi', 'मैं शाकाहारी हूं'],
  ];
  for (const [lang, msg] of vegetariani) {
    ok(riconosciConsiglio(msg, NOMI) === 'vegetariano', `[${lang}] "${msg}" -> consiglio vegetariano`,
      `ricevuto: ${riconosciConsiglio(msg, NOMI) ?? 'IA'}`);
    const r = await chiedi(msg, lang);
    ok(r === null || r.intento !== 'allergeni', `[${lang}] non finisce nel ramo allergeni`, r?.message?.slice(0, 70));
  }
  for (const [lang, msg] of [['it', 'La carbonara e vegetariana?'], ['en', 'Is the carbonara vegetarian?']] as Array<[string, string]>) {
    const r = await chiedi(msg, lang);
    ok(r === null, `[${lang}] "${msg}" -> decide l'IA, niente elenco allergeni`, `ricevuto: ${r?.intento}`);
  }
  ok(riconosciConsiglio('Sono vegano', NOMI) === null, 'vegano -> sempre IA');
  ok(riconosciConsiglio('我是纯素食', NOMI) === null, '[zh] vegano -> sempre IA');

  sezione('16. Piatti che un vegetariano non deve vedere');
  for (const nome of ['Carbonara', 'Tagliatelle al ragù', 'Polpo alla griglia', 'Tagliata di manzo', 'Tagliere di salumi']) {
    const d = MENU.find(x => x.name === nome)!;
    ok(!sembraVegetariano(d), `"${nome}" escluso`, `${d.name} — ${d.description}`);
  }
  for (const nome of ['Bruschetta al pomodoro', 'Risotto ai funghi', 'Insalata di stagione', 'Tiramisù']) {
    const d = MENU.find(x => x.name === nome)!;
    ok(sembraVegetariano(d), `"${nome}" ammesso`);
  }
  ok(!sembraVegetariano({ name: 'Pizza Cotto e Funghi', description: '' }), 'Pizza Cotto e Funghi esclusa (cotto = prosciutto)');
  ok(!sembraVegetariano({ name: 'Caesar Salad', description: 'pollo, acciughe' }), 'Caesar Salad esclusa');
  // Menu veri: nome in italiano, descrizione in spagnolo
  ok(!sembraVegetariano({ name: 'Tagliere Bologna', description: 'Tabla de mortadela de bologna con pistacho, queso ricota, miel y nueces' }),
    'Tagliere Bologna escluso (mortadela, con una L sola)');
  ok(!sembraVegetariano({ name: 'Tagliere Italia', description: 'Tabla de jamon de parma D.O.P y queso mozzarella' }), 'Tagliere Italia escluso');
  ok(!sembraVegetariano({ name: 'Tagliere dello Chef', description: 'Surtido de embutidos y queso italiano' }), 'Tagliere dello Chef escluso (embutidos)');
  ok(!sembraVegetariano({ name: 'Ensalada de atun', description: '' }), 'insalata di tonno esclusa (atun)');
  ok(sembraVegetariano({ name: 'Gnocchi Quattro Formaggi', description: 'Gnocchi con salsa de cuatro quesos: fontina, gorgonzola, parmesano y pecorino' }),
    'Gnocchi Quattro Formaggi ammessi');
  ok(sembraVegetariano({ name: 'Risotto ai porcini', description: 'Funghi porcini freschi' }), 'porcini non e\' maiale');

  sezione('17. Pulizia dei pulsanti');
  ok(JSON.stringify(pulisciSuggerimenti(['Try the **Risotto Profumo di Mare**'], 'en')) === JSON.stringify(['Try the Risotto Profumo di Mare']),
    'via il grassetto dai pulsanti', JSON.stringify(pulisciSuggerimenti(['Try the **Risotto**'], 'en')));
  const scartati: Array<[string, string]> = [
    ['it', 'Qual è la tua allergia?'],
    ['it', 'Cerco un altro ristorante'],
    ['es', '¿Qué deseas comer?'],
    ['ru', 'Есть ли аллергии?'],
    ['ru', 'Более详细描述'],
    ['ja', 'アレルギーはありますか'],
    ['ko', '메뉴를 둘러보시겠어요?'],
    ['hi', 'क्या आप एक पिज़्ज़ा चाहते हैं?'],
    ['ar', 'هل تريد نبيذ؟'],
    // Pulsante nella lingua sbagliata: l'italiano a un cliente hindi
    ['hi', 'Lo voglio ordinare!'],
    ['ru', 'Tasting menu for 2'],
    ['ko', 'Menu degustazione per 2'],
  ];
  for (const [lang, s] of scartati) {
    ok(pulisciSuggerimenti([s], lang).length === 0, `[${lang}] scartato: "${s}"`, JSON.stringify(pulisciSuggerimenti([s], lang)));
  }
  const tenuti: Array<[string, string]> = [
    ['it', 'Cosa abbini con questo?'], ['it', 'Lo voglio ordinare!'],
    ['en', 'What pairs well with this?'], ['es', '¡Quiero pedirlo!'],
    ['ru', 'Что посоветуете?'], ['zh', '有什么推荐？'],
    ['ja', 'おすすめは？'], ['ko', '추천해 주세요'],
  ];
  for (const [lang, s] of tenuti) {
    ok(pulisciSuggerimenti([s], lang).length === 1, `[${lang}] tenuto: "${s}"`);
  }
  // I suggerimenti standard non devono mai essere scartati dal filtro
  for (const lang of ['it', 'en', 'de', 'es', 'fr', 'pt', 'ru', 'zh', 'ja', 'ar', 'ko', 'id', 'hi']) {
    const std = suggerimentiPredefiniti(lang);
    ok(pulisciSuggerimenti(std, lang).length === std.length,
      `[${lang}] i pulsanti standard sopravvivono al filtro`, JSON.stringify(pulisciSuggerimenti(std, lang)));
  }
  ok(pulisciSuggerimenti(['a', 'a', 'b'], 'it').length === 2, 'niente pulsanti doppi');
  ok(pulisciSuggerimenti(null, 'it').length === 0, 'suggerimenti assenti -> elenco vuoto');

  sezione('18. Messaggi limite');
  ok((await chiedi('', 'it')) === null, 'messaggio vuoto -> null');
  ok((await chiedi('   ', 'it')) === null, 'solo spazi -> null');
  ok((await chiedi('?'.repeat(200), 'it')) === null, 'messaggio lunghissimo -> null');
  ok((await chiedi('😀🍕', 'it')) === null, 'solo emoji -> null');
  const sugg = suggerimentiPredefiniti('xx');
  ok(sugg.length === 3, 'lingua sconosciuta -> suggerimenti inglesi', JSON.stringify(sugg));

  console.log(`\n${'='.repeat(64)}\n  ${passati} controlli passati, ${errori} errori\n${'='.repeat(64)}`);
  process.exit(errori > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
