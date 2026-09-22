/**
 * Risposte dirette: quello che sappiamo gia', senza chiamare il modello.
 *
 * Su dieci messaggi di una chat al tavolo, sei sono domande a cui il database
 * risponde meglio di un LLM: il prezzo di un piatto, la sua descrizione, i suoi
 * allergeni, "voglio ordinare", un grazie. Oggi ognuna di quelle costa 3.400
 * token di menu rispediti al modello per riottenere un dato che avevamo gia'.
 *
 * Qui le intercettiamo prima. Il modello resta per quello che sa fare davvero:
 * consigliare, abbinare, comporre un percorso di degustazione.
 *
 * REGOLA UNICA, NON NEGOZIABILE: nel dubbio si restituisce null e si passa
 * all'IA. Un'occasione persa costa una chiamata (cioe' quanto costa oggi);
 * una risposta sbagliata costa un cliente. Non si indovina mai.
 *
 * Sugli allergeni la scorciatoia e' piu' SICURA del modello, non meno: la
 * risposta e' sempre la stessa frase, sempre con il rimando al personale, e
 * nessuna generazione puo' inventarsi un "senza glutine" che non abbiamo mai
 * scritto. Vale la stessa regola del prompt: si riportano SOLO gli allergeni
 * registrati dal ristorante, e si manda a confermare in cucina.
 */
import { db } from '../db/client';

export interface PiattoBase {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  allergens: string[];
}

export interface RispostaDiretta {
  message: string;
  suggestions: string[];
  intento: 'piatto' | 'allergeni' | 'ordine' | 'saluto' | 'abbinamento';
}

// ── Valuta: stessa tabella del menu pubblico (App.tsx), cosi' il prezzo nella
// chat e quello nella scheda del piatto si scrivono identici ────────────────
const SIMBOLI_VALUTA: Record<string, string> = {
  EUR: '€', AUD: 'A$', USD: '$', GBP: '£', CAD: 'C$', NZD: 'NZ$',
  CHF: 'CHF ', JPY: '¥', CNY: '¥', AED: 'AED ', THB: '฿',
};
function simboloValuta(codice?: string | null): string {
  if (!codice) return '€';
  const c = String(codice).toUpperCase();
  return SIMBOLI_VALUTA[c] ?? (c.length <= 2 ? String(codice) : c + ' ');
}

// ── Allergeni tradotti ──────────────────────────────────────────────────────
// Finora li traduceva il modello al volo, dentro la risposta. Qui non c'e' un
// modello, quindi serve la tabella: per fortuna sono un insieme chiuso (i 14
// allergeni obbligatori per legge), quindi si scrivono una volta e bastano.
// Un termine che il ristoratore ha scritto a modo suo e che non riconosciamo
// resta com'e': meglio la parola originale che una parola sbagliata.
const ALLERGENI: Record<string, Record<string, string>> = {
  glutine: { it: 'glutine', en: 'gluten', de: 'Gluten', es: 'gluten', fr: 'gluten', pt: 'glúten', ru: 'глютен', zh: '麸质', ja: 'グルテン', ar: 'الغلوتين', ko: '글루텐', id: 'gluten', hi: 'ग्लूटेन' },
  crostacei: { it: 'crostacei', en: 'crustaceans', de: 'Krebstiere', es: 'crustáceos', fr: 'crustacés', pt: 'crustáceos', ru: 'ракообразные', zh: '甲壳类', ja: '甲殻類', ar: 'القشريات', ko: '갑각류', id: 'krustasea', hi: 'क्रस्टेशियन' },
  uova: { it: 'uova', en: 'eggs', de: 'Eier', es: 'huevos', fr: 'œufs', pt: 'ovos', ru: 'яйца', zh: '鸡蛋', ja: '卵', ar: 'البيض', ko: '계란', id: 'telur', hi: 'अंडा' },
  pesce: { it: 'pesce', en: 'fish', de: 'Fisch', es: 'pescado', fr: 'poisson', pt: 'peixe', ru: 'рыба', zh: '鱼', ja: '魚', ar: 'السمك', ko: '어류', id: 'ikan', hi: 'मछली' },
  arachidi: { it: 'arachidi', en: 'peanuts', de: 'Erdnüsse', es: 'cacahuetes', fr: 'arachides', pt: 'amendoins', ru: 'арахис', zh: '花生', ja: '落花生', ar: 'الفول السوداني', ko: '땅콩', id: 'kacang tanah', hi: 'मूंगफली' },
  soia: { it: 'soia', en: 'soy', de: 'Soja', es: 'soja', fr: 'soja', pt: 'soja', ru: 'соя', zh: '大豆', ja: '大豆', ar: 'الصويا', ko: '대두', id: 'kedelai', hi: 'सोया' },
  latte: { it: 'latte', en: 'milk', de: 'Milch', es: 'leche', fr: 'lait', pt: 'leite', ru: 'молоко', zh: '牛奶', ja: '乳', ar: 'الحليب', ko: '우유', id: 'susu', hi: 'दूध' },
  lattosio: { it: 'lattosio', en: 'lactose', de: 'Laktose', es: 'lactosa', fr: 'lactose', pt: 'lactose', ru: 'лактоза', zh: '乳糖', ja: '乳糖', ar: 'اللاكتوز', ko: '유당', id: 'laktosa', hi: 'लैक्टोज' },
  'frutta a guscio': { it: 'frutta a guscio', en: 'tree nuts', de: 'Schalenfrüchte', es: 'frutos de cáscara', fr: 'fruits à coque', pt: 'frutos de casca rija', ru: 'орехи', zh: '坚果', ja: 'ナッツ類', ar: 'المكسرات', ko: '견과류', id: 'kacang pohon', hi: 'मेवे' },
  sedano: { it: 'sedano', en: 'celery', de: 'Sellerie', es: 'apio', fr: 'céleri', pt: 'aipo', ru: 'сельдерей', zh: '芹菜', ja: 'セロリ', ar: 'الكرفس', ko: '셀러리', id: 'seledri', hi: 'अजमोद' },
  senape: { it: 'senape', en: 'mustard', de: 'Senf', es: 'mostaza', fr: 'moutarde', pt: 'mostarda', ru: 'горчица', zh: '芥末', ja: 'マスタード', ar: 'الخردل', ko: '겨자', id: 'mostar', hi: 'सरसों' },
  sesamo: { it: 'sesamo', en: 'sesame', de: 'Sesam', es: 'sésamo', fr: 'sésame', pt: 'gérgelim', ru: 'кунжут', zh: '芝麻', ja: 'ごま', ar: 'السمسم', ko: '참깨', id: 'wijen', hi: 'तिल' },
  solfiti: { it: 'solfiti', en: 'sulphites', de: 'Sulfite', es: 'sulfitos', fr: 'sulfites', pt: 'sulfitos', ru: 'сульфиты', zh: '亚硫酸盐', ja: '亜硫酸塩', ar: 'الكبريتيت', ko: '아황산염', id: 'sulfit', hi: 'सल्फाइट' },
  lupini: { it: 'lupini', en: 'lupin', de: 'Lupinen', es: 'altramuces', fr: 'lupin', pt: 'tremoço', ru: 'люпин', zh: '羙豆', ja: 'ルピナス豆', ar: 'الترمس', ko: '루피너스', id: 'lupin', hi: 'लुपिन' },
  molluschi: { it: 'molluschi', en: 'molluscs', de: 'Weichtiere', es: 'moluscos', fr: 'mollusques', pt: 'moluscos', ru: 'моллюски', zh: '软体动物', ja: '財類', ar: 'الرخويات', ko: '연체동물', id: 'moluska', hi: 'शेलफिश' },
};

// Come il ristoratore puo' averli scritti -> la voce della tabella qui sopra.
const SINONIMI_ALLERGENI: Record<string, string> = {
  gluten: 'glutine', cereali: 'glutine', frumento: 'glutine', wheat: 'glutine',
  eggs: 'uova', egg: 'uova', uovo: 'uova',
  milk: 'latte', latticini: 'latte', dairy: 'latte',
  lactose: 'lattosio',
  fish: 'pesce', peanuts: 'arachidi', peanut: 'arachidi',
  soy: 'soia', soia_lecitina: 'soia', soybeans: 'soia',
  nuts: 'frutta a guscio', 'tree nuts': 'frutta a guscio', noci: 'frutta a guscio',
  mandorle: 'frutta a guscio', nocciole: 'frutta a guscio',
  celery: 'sedano', mustard: 'senape', sesame: 'sesamo',
  sulphites: 'solfiti', sulfites: 'solfiti', solfiti_e6: 'solfiti',
  lupin: 'lupini', molluscs: 'molluschi', shellfish: 'crostacei',
  crustaceans: 'crostacei',
};

function traduciAllergene(termine: string, lang: string): string {
  const pulito = normalizza(termine);
  if (!pulito) return termine;
  const voce = ALLERGENI[pulito] ? pulito : SINONIMI_ALLERGENI[pulito];
  if (!voce || !ALLERGENI[voce]) return termine;   // non lo conosciamo: si lascia com'e'
  return ALLERGENI[voce][lang] ?? ALLERGENI[voce]['en'] ?? termine;
}

function elencoAllergeni(allergens: unknown, lang: string): string[] {
  if (!Array.isArray(allergens)) return [];
  return allergens
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .map(a => traduciAllergene(a, lang));
}

/**
 * Minuscolo, via gli accenti, via la punteggiatura, spazi normalizzati.
 * Serve perche' "Tagliatelle al ragù," e "tagliatelle al ragu" sono lo stesso
 * piatto, e il cliente scrive come gli pare.
 *
 * Esportata perche' la usa anche menu-contesto.ts per pesare i piatti.
 */
export function normalizza(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Quanto e' "corta" una domanda. Le lingue senza spazi (cinese, giapponese)
 * vanno contate a caratteri, altrimenti risulterebbero sempre di una parola.
 */
function troppoLunga(msg: string): boolean {
  if (msg.length > 70) return true;
  const parole = msg.trim().split(/\s+/).length;
  return parole > 10;
}

// ── Parole che accendono un intento ─────────────────────────────────────────
// Una lista piatta per tutte le lingue: un cliente coreano non fara' mai
// scattare per sbaglio una parola italiana, quindi non serve tenerle divise.
// Sono gia' normalizzate (minuscole, senza accenti) come l'input.

export const PAROLE_ALLERGENI = [
  // it / es / pt
  'allergen', 'allergi', 'alerg', 'glutine', 'gluten', 'lattosio', 'lactosa', 'lactose',
  'celiac', 'celiaco', 'intolleran', 'intoleran', 'vegano', 'vegetarian', 'vegetarien',
  'arachidi', 'amendoim', 'frutta a guscio', 'frutos secos',
  // en / de / fr
  'allerg', 'coeliac', 'lactose', 'peanut', 'dairy', 'laktose', 'zoliakie',
  'unvertraglich', 'vegetarisch', 'erdnuss', 'coeliaque', 'arachide',
  // ru
  'аллерг', 'глютен',
  'лактоз', 'веган',
  'вегетариан',
  // zh
  '过敏', '麸质', '乳糖', '素食', '花生',
  // ja
  'アレルギ', 'グルテン', '乳糖',
  'ベジタリアン', 'ビーガン',
  // ar
  'حساسية', 'غلوتين',
  'نباتي',
  // ko
  '알레르기', '글루텐', '유당', '채식',
  // id
  'alergi', 'laktosa',
  // hi
  'एलर्जी', 'ग्लूटेन',
  'शाकाहारी',
];

const PAROLE_ORDINE = [
  'voglio ordinare', 'vorrei ordinare', 'posso ordinare', 'lo ordino', 'lo prendo',
  'i want to order', 'i would like to order', 'can i order', 'i ll have', 'ill have',
  'ich mochte bestellen', 'bestellen', 'quiero pedir', 'quiero pedirlo', 'puedo pedir',
  'je voudrais commander', 'commander', 'quero pedir', 'gostaria de pedir',
  'я хочу заказать',
  'заказать',
  '我要点', '点菜', '注文', 'これください',
  'أريد أن أطلب',
  '주문', 'saya mau pesan', 'pesan',
  'ऑर्डर',
];

// "e da bere?" / "che vino ci sta?" — l'abbinamento e' scritto in dish_answers.
const PAROLE_BEVUTA = [
  'vino', 'bere', 'abbinament', 'abbino', 'abbina', 'birra', 'cocktail', 'bevanda', 'calice',
  'wine', 'drink', 'pairing', 'pair with', 'beer', 'sommelier',
  'wein', 'trinken', 'getrank', 'bier', 'passt dazu',
  'maridaje', 'marida', 'cerveza', 'beber', 'copa',
  'accord', 'boire', 'biere', 'verre de',
  'vinho', 'harmoniza', 'cerveja', 'beber',
  'вино', 'напиток', 'пиво',
  '配什么酒', '醍配', '喝什么', '葡萄酒', '啤酒',
  'ワイン', '飲み物', 'ビール', '合うお酒',
  'نبيذ', 'مشروب',
  '와인', '음료', '맥주', '마실',
  'anggur', 'minum', 'minuman',
  'वाइन', 'पेय', 'शराब',
];

const PAROLE_GRAZIE = [
  'grazie', 'thanks', 'thank you', 'danke', 'gracias', 'merci', 'obrigado', 'obrigada',
  'спасибо', '谢谢',
  'ありがとう', 'شكرا', '감사',
  'terima kasih', 'धन्यवाद',
];

/**
 * Parole di allergeni troppo corte per cercarle come pezzo di testo: "nut"
 * dentro "donut" farebbe partire l'intento sbagliato. Queste si cercano come
 * parola intera.
 */
export const PAROLE_ALLERGENI_INTERE = [
  'nut', 'nuts', 'noci', 'noce', 'soia', 'soy', 'uova', 'uovo', 'egg', 'eggs',
  'latte', 'milk', 'pesce', 'fish', 'sesamo', 'sesame', 'sedano', 'celery',
  'senape', 'mustard', 'solfiti', 'sulphites', 'sulfites', 'molluschi', 'crostacei',
];

function contiene(testo: string, parole: string[]): boolean {
  return parole.some(p => testo.includes(p));
}

function contieneParolaIntera(testo: string, parole: string[]): boolean {
  const token = new Set(testo.split(' '));
  return parole.some(p => token.has(p));
}

// ── Testi, una riga per lingua ──────────────────────────────────────────────
// Scritti a mano come il messaggio di benvenuto in routes/chat.ts: sono sempre
// gli stessi e non ha senso spendere una chiamata all'IA per "Prezzo".
interface Testi {
  allergeniDi: (piatto: string, elenco: string) => string;
  allergeniNonRegistrati: (piatto: string) => string;
  allergeniQualePiatto: string;
  ordine: string;
  grazie: string;
  suggerimenti: string[];
}

const T: Record<string, Testi> = {
  it: {
    allergeniDi: (p, e) => `Per **${p}** il ristorante ha registrato: ${e}.\nPer la tua sicurezza faccio verificare al personale: gli allergeni li conferma la cucina.`,
    allergeniNonRegistrati: p => `Per **${p}** il ristorante non ha ancora registrato gli allergeni, quindi non posso dirtelo io.\nChiedi al cameriere prima di ordinare: li conferma la cucina.`,
    allergeniQualePiatto: 'Dimmi quale piatto ti interessa e ti riporto gli allergeni che il ristorante ha registrato.\nIn ogni caso la conferma la da sempre la cucina: avviso io il personale.',
    ordine: 'Puoi salvare il piatto nell’app per non dimenticarlo: il cameriere viene al tavolo a prendere l’ordine.',
    grazie: 'Figurati! Se ti serve altro sono qui.',
    suggerimenti: ['Cosa mi consigli?', 'Che vino ci abbino?', 'Menu degustazione per 2'],
  },
  en: {
    allergeniDi: (p, e) => `For **${p}** the restaurant has registered: ${e}.\nFor your safety I’ll let the staff know: allergens are confirmed by the kitchen.`,
    allergeniNonRegistrati: p => `The restaurant hasn’t registered allergens for **${p}** yet, so I can’t tell you myself.\nPlease ask your waiter before ordering — the kitchen confirms.`,
    allergeniQualePiatto: 'Tell me which dish you mean and I’ll give you the allergens the restaurant has registered.\nEither way the kitchen always confirms — I’ll let the staff know.',
    ordine: 'You can save the dish in the app so you don’t forget it: the waiter will come to your table to take the order.',
    grazie: 'Anytime! I’m here if you need anything else.',
    suggerimenti: ['What do you recommend?', 'What wine pairs with this?', 'Tasting menu for 2'],
  },
  de: {
    allergeniDi: (p, e) => `Für **${p}** hat das Restaurant eingetragen: ${e}.\nZu Ihrer Sicherheit informiere ich das Personal: Allergene bestätigt die Küche.`,
    allergeniNonRegistrati: p => `Für **${p}** sind noch keine Allergene eingetragen, ich kann es Ihnen also nicht sagen.\nFragen Sie bitte vor der Bestellung die Bedienung — die Küche bestätigt.`,
    allergeniQualePiatto: 'Sagen Sie mir, welches Gericht Sie meinen, dann nenne ich die eingetragenen Allergene.\nBestätigt wird es in jedem Fall von der Küche — ich sage dem Personal Bescheid.',
    ordine: 'Sie können das Gericht in der App speichern, damit Sie es nicht vergessen: die Bedienung nimmt die Bestellung am Tisch auf.',
    grazie: 'Sehr gerne! Melden Sie sich, wenn Sie noch etwas brauchen.',
    suggerimenti: ['Was empfehlen Sie?', 'Welcher Wein passt dazu?', 'Degustationsmenü für 2'],
  },
  es: {
    allergeniDi: (p, e) => `Para **${p}** el restaurante ha registrado: ${e}.\nPor tu seguridad aviso al personal: los alérgenos los confirma la cocina.`,
    allergeniNonRegistrati: p => `El restaurante aún no ha registrado los alérgenos de **${p}**, así que no puedo decírtelo yo.\nPregúntale al camarero antes de pedir: lo confirma la cocina.`,
    allergeniQualePiatto: 'Díme qué plato te interesa y te digo los alérgenos que el restaurante ha registrado.\nEn cualquier caso lo confirma siempre la cocina: yo aviso al personal.',
    ordine: 'Puedes guardar el plato en la app para no olvidarlo: el camarero vendrá a la mesa a tomar el pedido.',
    grazie: '¡De nada! Aquí estoy si necesitas algo más.',
    suggerimenti: ['¿Qué me recomiendas?', '¿Qué vino marida?', 'Menú degustación para 2'],
  },
  fr: {
    allergeniDi: (p, e) => `Pour **${p}** le restaurant a enregistré : ${e}.\nPour votre sécurité je préviens le personnel : les allergènes sont confirmés par la cuisine.`,
    allergeniNonRegistrati: p => `Le restaurant n’a pas encore enregistré les allergènes de **${p}**, je ne peux donc pas vous le dire.\nDemandez au serveur avant de commander : la cuisine confirme.`,
    allergeniQualePiatto: 'Dites-moi quel plat vous intéresse et je vous donne les allergènes enregistrés par le restaurant.\nDans tous les cas la cuisine confirme : je préviens le personnel.',
    ordine: 'Vous pouvez enregistrer le plat dans l’application pour ne pas l’oublier : le serveur viendra prendre la commande à table.',
    grazie: 'Avec plaisir ! Je reste à votre disposition.',
    suggerimenti: ['Que me conseillez-vous ?', 'Quel vin avec ça ?', 'Menu dégustation pour 2'],
  },
  pt: {
    allergeniDi: (p, e) => `Para **${p}** o restaurante registou: ${e}.\nPara sua segurança aviso o pessoal: os alergénios são confirmados pela cozinha.`,
    allergeniNonRegistrati: p => `O restaurante ainda não registou os alergénios de **${p}**, por isso não lhe posso dizer.\nPergunte ao empregado antes de pedir: a cozinha confirma.`,
    allergeniQualePiatto: 'Diga-me qual prato lhe interessa e digo-lhe os alergénios registados pelo restaurante.\nDe qualquer forma a cozinha confirma sempre: eu aviso o pessoal.',
    ordine: 'Pode guardar o prato na app para não se esquecer: o empregado vem à mesa tirar o pedido.',
    grazie: 'De nada! Estou aqui se precisar de mais alguma coisa.',
    suggerimenti: ['O que me recomenda?', 'Que vinho combina?', 'Menu de degustação para 2'],
  },
  ru: {
    allergeniDi: (p, e) => `Для **${p}** ресторан указал: ${e}.\nРади вашей безопасности я предупрежу персонал: аллергены подтверждает кухня.`,
    allergeniNonRegistrati: p => `Для **${p}** аллергены ещё не указаны, поэтому я не могу сказать.\nСпросите официанта перед заказом: подтверждает кухня.`,
    allergeniQualePiatto: 'Скажите, какое блюдо вас интересует, и я назову указанные аллергены.\nВ любом случае подтверждает кухня: я предупрежу персонал.',
    ordine: 'Сохраните блюдо в приложении, чтобы не забыть: официант подойдёт к столику и примет заказ.',
    grazie: 'Пожалуйста! Обращайтесь, если что-то нужно.',
    suggerimenti: ['Что посоветуете?', 'Какое вино подойдёт?', 'Дегустация на двоих'],
  },
  zh: {
    allergeniDi: (p, e) => `关于**${p}**，餐厅登记的过敏原：${e}。\n为了您的安全，我会告知工作人员：过敏原由厨房确认。`,
    allergeniNonRegistrati: p => `餐厅尚未登记**${p}**的过敏原，所以我无法告知。\n点菜前请询问服务员，由厨房确认。`,
    allergeniQualePiatto: '请告诉我是哪道菜，我会告知餐厅登记的过敏原。\n无论如何都由厨房最终确认：我会告知工作人员。',
    ordine: '您可以在应用里保存这道菜以免忘记：服务员会到桌前为您点菜。',
    grazie: '不客气！需要其他帮助随时告诉我。',
    suggerimenti: ['有什么推荐？', '配什么酒？', '两人品尝套餐'],
  },
  ja: {
    allergeniDi: (p, e) => `**${p}**について、レストランが登録しているアレルギー物質：${e}。\n安全のためスタッフにお伝えします。最終確認は厨房が行います。`,
    allergeniNonRegistrati: p => `**${p}**のアレルギー情報はまだ登録されていないため、お答えできません。\nご注文前にスタッフにお尋ねください。厨房が確認します。`,
    allergeniQualePiatto: 'どの料理か教えていただければ、登録されているアレルギー物質をお伝えします。\nいずれにしても確認は厨房が行います。',
    ordine: '忘れないようアプリに保存できます。ご注文はスタッフがテーブルで承ります。',
    grazie: 'どういたしまして！他にもあればお声がけください。',
    suggerimenti: ['おすすめは？', '合うワインは？', '2名様のコース'],
  },
  ar: {
    allergeniDi: (p, e) => `لـ **${p}** سجّل المطعم: ${e}.\nمن أجل سلامتك سأُبلغ الطاقم: المطبخ هو من يؤكّد المحسسات.`,
    allergeniNonRegistrati: p => `لم يسجّل المطعم بعد محسسات **${p}**، لذلك لا يمكنني إخبارك.\nاسأل النادل قبل الطلب: المطبخ يؤكّد.`,
    allergeniQualePiatto: 'أخبرني بأي طبق تهتم وسأذكر المحسسات المسجّلة.\nعلى أي حال المطبخ هو من يؤكّد.',
    ordine: 'يمكنك حفظ الطبق في التطبيق حتى لا تنساه: النادل سيأتي إلى الطاولة لأخذ الطلب.',
    grazie: 'عفوًا! أنا هنا إذا احتجت شيئًا آخر.',
    suggerimenti: ['بماذا تنصحني؟', 'ما النبيذ المناسب؟', 'قائمة تذوق لشخصين'],
  },
  ko: {
    allergeniDi: (p, e) => `**${p}**에 대해 식당이 등록한 알레르기 유발 물질: ${e}.\n안전을 위해 직원에게 알려드릴게요. 최종 확인은 주방에서 합니다.`,
    allergeniNonRegistrati: p => `**${p}**의 알레르기 정보가 아직 등록되지 않아 알려드릴 수 없어요.\n주문 전에 직원에게 문의해 주세요. 주방이 확인합니다.`,
    allergeniQualePiatto: '어떤 요리인지 말씀해 주시면 등록된 알레르기 정보를 알려드릴게요.\n어느 경우든 최종 확인은 주방이 합니다.',
    ordine: '잊지 않도록 앱에 저장해 두세요. 주문은 직원이 테이블에서 받습니다.',
    grazie: '천만에요! 필요하신 게 있으면 말씀해 주세요.',
    suggerimenti: ['추천해 주세요', '어울리는 와인은?', '2인 테이스팅 코스'],
  },
  id: {
    allergeniDi: (p, e) => `Untuk **${p}** restoran mencatat: ${e}.\nDemi keamanan Anda saya beri tahu staf: alergen dikonfirmasi oleh dapur.`,
    allergeniNonRegistrati: p => `Restoran belum mencatat alergen untuk **${p}**, jadi saya tidak bisa memberitahukannya.\nTanyakan kepada pelayan sebelum memesan — dapur yang mengonfirmasi.`,
    allergeniQualePiatto: 'Beri tahu saya hidangan mana, nanti saya sebutkan alergen yang dicatat restoran.\nBagaimanapun dapur yang mengonfirmasi: saya akan memberi tahu staf.',
    ordine: 'Anda bisa menyimpan hidangan di aplikasi agar tidak lupa: pelayan akan datang ke meja untuk mencatat pesanan.',
    grazie: 'Sama-sama! Saya di sini kalau ada yang lain.',
    suggerimenti: ['Apa rekomendasinya?', 'Wine apa yang cocok?', 'Menu cicip untuk 2'],
  },
  hi: {
    allergeniDi: (p, e) => `**${p}** के लिए रेस्टोरेंट ने दर्ज किया है: ${e}।\nआपकी सुरक्षा के लिए मैं स्टाफ को बता दूंगा: पुष्टि रसोई करती है।`,
    allergeniNonRegistrati: p => `**${p}** की एलर्जी जानकारी अबतक दर्ज नहीं है, इसलिए मैं नहीं बता सकता।\nऑर्डर से पहले वेटर से पूछें: रसोई पुष्टि करती है।`,
    allergeniQualePiatto: 'बताइए कौन सा व्यंजन चाहिए, मैं दर्ज एलर्जी जानकारी बता दूंगा।\nपुष्टि हमेशा रसोई करती है।',
    ordine: 'आप व्यंजन को ऐप में सहेज सकते हैं: वेटर टेबल पर ऑर्डर लेने आएगा।',
    grazie: 'खुशी हुई! कुछ और चाहिए तो बताइए।',
    suggerimenti: ['आप क्या सुझाएंगे?', 'कौन सी वाइन?', '2 के लिए टेस्टिंग मेन्यू'],
  },
};

// I nostri suggerimenti da cliccare, normalizzati, in tutte le lingue:
// testo -> posizione (0 = "cosa mi consigli", 1 = vino, 2 = degustazione per 2)
export const SUGGERIMENTI_TUTTE_LE_LINGUE = new Map<string, number>(
  Object.values(T).flatMap(t => t.suggerimenti.map((s, i) => [normalizza(s), i] as [string, number])),
);

function testi(lang: string): Testi {
  return T[lang] ?? T['en'];
}

// ── Traduzioni dei piatti, in cache come il contesto ristorante ─────────────
interface PiattoRisolto extends PiattoBase {
  nomeMostrato: string;
  descrizioneMostrata: string;
  /** Il piatto raccontato bene, scritto prima (dish_answers). Vuoto se non generato. */
  racconto: string;
  /** Cosa bere con questo piatto. Vuoto se non generato. */
  abbinamento: string;
  chiavi: string[];   // nome base + nome tradotto, normalizzati
}

const cacheTraduzioni = new Map<string, { data: PiattoRisolto[]; ts: number }>();
const DURATA_CACHE_MS = 5 * 60 * 1000;

async function piattiNellaLingua(
  restaurantId: string, lang: string, dishes: PiattoBase[],
): Promise<PiattoRisolto[]> {
  const chiave = `${restaurantId}:${lang}`;
  const salvato = cacheTraduzioni.get(chiave);
  if (salvato && Date.now() - salvato.ts < DURATA_CACHE_MS) return salvato.data;

  // Una query sola per tutto il menu. Se fallisce si prosegue con la lingua
  // originale: un nome non tradotto e' molto meglio di nessuna risposta.
  let tradotti = new Map<string, { name: string | null; description: string | null }>();
  try {
    const r = await db.query<{ dish_id: string; name: string | null; description: string | null }>(
      `SELECT dish_id, name, description FROM dish_translations
       WHERE lang = $1 AND dish_id = ANY($2::uuid[])`,
      [lang, dishes.map(d => d.id)],
    );
    tradotti = new Map(r.rows.map(x => [x.dish_id, { name: x.name, description: x.description }]));
  } catch { /* si resta alla lingua originale */ }

  // Le risposte scritte prima (racconto, abbinamento). Stessa regola delle
  // traduzioni: se mancano si va avanti lo stesso, con quello che c'e'.
  let scritte = new Map<string, { racconto?: string; abbinamento?: string }>();
  try {
    const r = await db.query<{ dish_id: string; kind: string; text: string }>(
      `SELECT dish_id, kind, text FROM dish_answers
        WHERE lang = $1 AND dish_id = ANY($2::uuid[])`,
      [lang, dishes.map(d => d.id)],
    );
    for (const x of r.rows) {
      const voce = scritte.get(x.dish_id) ?? {};
      if (x.kind === 'racconto' || x.kind === 'abbinamento') voce[x.kind] = x.text;
      scritte.set(x.dish_id, voce);
    }
  } catch { /* tabella non ancora creata: si prosegue senza */ }

  const risolti: PiattoRisolto[] = dishes.map(d => {
    const t = tradotti.get(d.id);
    const s = scritte.get(d.id);
    const nomeMostrato = (t?.name || '').trim() || d.name;
    const chiavi = [normalizza(d.name)];
    const nt = normalizza(nomeMostrato);
    if (nt && nt !== chiavi[0]) chiavi.push(nt);
    return {
      ...d,
      nomeMostrato,
      descrizioneMostrata: (t?.description || '').trim() || d.description || '',
      racconto: (s?.racconto || '').trim(),
      abbinamento: (s?.abbinamento || '').trim(),
      chiavi,
    };
  });

  cacheTraduzioni.set(chiave, { data: risolti, ts: Date.now() });
  return risolti;
}

/** Il messaggio E' il nome di un piatto (il cliente ha toccato il nome in grassetto). */
function piattoEsatto(msg: string, piatti: PiattoRisolto[]): PiattoRisolto | null {
  return piatti.find(p => p.chiavi.includes(msg)) ?? null;
}

/**
 * Un piatto e' NOMINATO dentro la frase. Due tentativi, dal piu' sicuro:
 *
 *  1. il nome completo compare nella frase ("allergeni della carbonara");
 *  2. il cliente lo accorcia, come fanno tutti ("il polpo ha allergeni?"
 *     per "Polpo alla griglia"): si cerca una parola del nome lunga almeno
 *     5 lettere, ma SOLO se punta a un piatto solo. Se "pasta" ne pesca sei,
 *     non si tira a indovinare: decide il modello.
 */
function piattoCitato(msg: string, piatti: PiattoRisolto[]): PiattoRisolto | null {
  let migliore: PiattoRisolto | null = null;
  let lunghezza = 0;
  for (const p of piatti) {
    for (const k of p.chiavi) {
      if (k.length >= 4 && msg.includes(k) && k.length > lunghezza) {
        migliore = p; lunghezza = k.length;
      }
    }
  }
  if (migliore) return migliore;

  const token = new Set(msg.split(' '));
  const candidati = new Map<string, PiattoRisolto>();
  for (const p of piatti) {
    const parole = p.chiavi.flatMap(k => k.split(' ')).filter(w => w.length >= 5);
    if (parole.some(w => token.has(w))) candidati.set(p.id, p);
  }
  return candidati.size === 1 ? [...candidati.values()][0] : null;
}

/**
 * Il piatto nominato nell'ULTIMA risposta dell'assistente, per capire a cosa
 * si riferisce "e da bere che ci sta?". Il prompt impone i nomi dei piatti in
 * **grassetto** (serve al cliente per aprirne la scheda), quindi il riferimento
 * e' gia' li' dentro, marcato: basta leggerlo.
 */
function piattoDalContesto(ultimaRisposta: string, piatti: PiattoRisolto[]): PiattoRisolto | null {
  if (!ultimaRisposta) return null;
  const nomi = [...ultimaRisposta.matchAll(/\*\*(.+?)\*\*/g)].map(m => normalizza(m[1]));
  // Dall'ultimo nominato al primo: e' quello di cui si stava parlando.
  for (const n of nomi.reverse()) {
    const p = piatti.find(x => x.chiavi.includes(n));
    if (p) return p;
  }
  return null;
}

function schedaPiatto(p: PiattoRisolto, valuta: string, lang: string, t: Testi): string {
  const righe = [`**${p.nomeMostrato}** · ${valuta}${Number(p.price).toFixed(2)}`];
  // Il racconto scritto prima batte la descrizione del menu: e' piu' ricco ed
  // e' stato riletto dal ristoratore. Se non c'e' si usa la descrizione.
  if (p.racconto) righe.push(p.racconto);
  else if (p.descrizioneMostrata) righe.push(p.descrizioneMostrata);
  if (p.abbinamento) righe.push(p.abbinamento);
  const elenco = elencoAllergeni(p.allergens, lang);
  if (elenco.length > 0) {
    // Solo la prima riga: nella scheda l'elenco e' un'informazione, non una
    // risposta a una domanda sulle allergie. Il rimando alla cucina arriva
    // per intero quando il cliente chiede davvero degli allergeni.
    righe.push(t.allergeniDi(p.nomeMostrato, elenco.join(', ')).split('\n')[0]);
  }
  return righe.join('\n');
}

/**
 * Prova a rispondere senza il modello. null = non lo so, ci pensi l'IA.
 */
export async function rispostaDiretta(p: {
  restaurantId: string;
  dishes: PiattoBase[];
  language: string;
  currency?: string | null;
  messaggio: string;
  /** L'ultima cosa detta dall'assistente: serve a capire "e da bere?". */
  ultimaRisposta?: string;
  /** Il messaggio viene da un nostro pulsante: non serve indovinare il testo. */
  azione?: { tipo: string; dish_id?: string };
}): Promise<RispostaDiretta | null> {
  // 0. I NOSTRI PULSANTI — il testo lo abbiamo scritto noi, la risposta ce
  //    l'abbiamo gia'. "Chiedi a ..." nella scheda del piatto chiede
  //    ingredienti, sapore e cosa bere: e' esattamente la scheda del piatto.
  //    Se il piatto non ha ne' racconto ne' descrizione la scheda sarebbe
  //    solo nome e prezzo: allora meglio l'IA.
  if (p.azione?.tipo === 'racconta' && p.azione.dish_id) {
    const piatti0 = await piattiNellaLingua(p.restaurantId, p.language, p.dishes);
    const piatto = piatti0.find(d => d.id === p.azione!.dish_id);
    if (piatto && (piatto.racconto || piatto.descrizioneMostrata)) {
      return {
        message: schedaPiatto(piatto, simboloValuta(p.currency), p.language, testi(p.language)),
        suggestions: testi(p.language).suggerimenti,
        intento: 'piatto',
      };
    }
  }
  if (p.azione?.tipo === 'allergie') {
    const t0 = testi(p.language);
    return { message: t0.allergeniQualePiatto, suggestions: t0.suggerimenti, intento: 'allergeni' };
  }

  const grezzo = (p.messaggio || '').trim();
  if (!grezzo || troppoLunga(grezzo)) return null;

  const msg = normalizza(grezzo);
  if (!msg) return null;

  const t = testi(p.language);
  const valuta = simboloValuta(p.currency);
  const piatti = await piattiNellaLingua(p.restaurantId, p.language, p.dishes);

  // 1. IL MESSAGGIO E' ESATTAMENTE UN PIATTO — il cliente ha toccato un nome
  //    in grassetto o l'ha scritto. Va provato PRIMA degli altri intenti:
  //    "Pollo al vino" e' una richiesta di scheda, non una domanda sul vino.
  const esatto = piattoEsatto(msg, piatti);
  if (esatto) {
    return {
      message: schedaPiatto(esatto, valuta, p.language, t),
      suggestions: t.suggerimenti,
      intento: 'piatto',
    };
  }

  // 2. ALLERGENI — prima degli altri: "allergeni della carbonara" non e' una
  //    richiesta della scheda del piatto, e la risposta deve essere la frase
  //    di sicurezza, sempre identica, mai generata.
  if (contiene(msg, PAROLE_ALLERGENI) || contieneParolaIntera(msg, PAROLE_ALLERGENI_INTERE)) {
    const piatto = piattoCitato(msg, piatti);
    if (!piatto) {
      return { message: t.allergeniQualePiatto, suggestions: t.suggerimenti, intento: 'allergeni' };
    }
    const elenco = elencoAllergeni(piatto.allergens, p.language);
    return {
      message: elenco.length > 0
        ? t.allergeniDi(piatto.nomeMostrato, elenco.join(', '))
        : t.allergeniNonRegistrati(piatto.nomeMostrato),
      suggestions: t.suggerimenti,
      intento: 'allergeni',
    };
  }

  // 3. COSA CI BEVO — l'abbinamento e' scritto prima in dish_answers.
  //    Il piatto puo' essere nominato ("che vino con la carbonara?") oppure
  //    sottinteso ("e da bere?"), e allora lo si prende dall'ultima risposta.
  //    Se l'abbinamento non e' ancora stato generato si passa al modello:
  //    meglio una risposta viva che una riga vuota.
  if (contiene(msg, PAROLE_BEVUTA)) {
    const piatto = piattoCitato(msg, piatti) ?? piattoDalContesto(p.ultimaRisposta || '', piatti);
    if (piatto?.abbinamento) {
      return {
        message: `**${piatto.nomeMostrato}** — ${piatto.abbinamento}`,
        suggestions: t.suggerimenti,
        intento: 'abbinamento',
      };
    }
  }

  // 4. VUOLE ORDINARE — il prompt impone gia' una risposta fissa: qui la
  //    diamo senza spendere una chiamata per riscriverla ogni volta.
  if (contiene(msg, PAROLE_ORDINE)) {
    return { message: t.ordine, suggestions: t.suggerimenti, intento: 'ordine' };
  }

  // 4. RINGRAZIAMENTI — solo se il messaggio e' SOLO un grazie: "grazie, ma
  //    cosa mi consigli?" deve andare al modello.
  if (msg.split(' ').length <= 3 && contiene(msg, PAROLE_GRAZIE)) {
    return { message: t.grazie, suggestions: t.suggerimenti, intento: 'saluto' };
  }

  return null;
}

/** Usato dai test e dal riscaldamento cache quando cambia il menu. */
export function svuotaCacheTraduzioni(): void {
  cacheTraduzioni.clear();
}
