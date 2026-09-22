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

/** La voce della tabella a cui corrisponde un termine scritto comunque. */
function chiaveAllergene(termine: string): string | null {
  const pulito = normalizza(termine);
  if (!pulito) return null;
  if (ALLERGENI[pulito]) return pulito;
  return SINONIMI_ALLERGENI[pulito] ?? null;
}

// Come il CLIENTE nomina un allergene, in tutte le lingue. Si costruisce una
// volta sola dalla tabella qui sopra (che le ha gia' tutte) piu' i modi di
// dire che non sono il nome dell'allergene: "celiaco" e' glutine, "marisco"
// e' crostacei, "frutti di mare" e' molluschi.
const MODI_DI_DIRLO: Array<{ voce: string; termine: string }> = (() => {
  const fuori: Record<string, string[]> = {
    glutine: ['celiac', 'celiaco', 'celiaca', 'coeliac', 'coeliaque', 'zoliakie', 'frumento', 'wheat', 'grano', 'trigo', 'ble', 'weizen'],
    lattosio: ['lactose intolerant', 'intollerante al lattosio', 'intolerante a la lactosa'],
    latte: ['latticini', 'dairy', 'formaggi', 'cheese', 'milchprodukte'],
    crostacei: ['marisco', 'mariscos', 'shellfish', 'gamberi', 'gambas', 'prawns', 'shrimp', 'langosta', 'meeresfruchte'],
    molluschi: ['frutti di mare', 'seafood', 'cozze', 'vongole', 'calamari', 'polpo'],
    'frutta a guscio': ['nut', 'nuts', 'noci', 'noce', 'nocciole', 'mandorle', 'almonds', 'hazelnut', 'walnut', 'nueces', 'nusse'],
    arachidi: ['peanut', 'peanuts', 'cacahuete', 'cacahuetes'],
    uova: ['egg', 'eggs', 'huevo', 'huevos', 'oeuf', 'ei', 'eier'],
    pesce: ['fish', 'pescado', 'poisson', 'fisch', 'peixe'],
    soia: ['soy', 'soya', 'soja'],
  };
  const fuori2: Array<{ voce: string; termine: string }> = [];
  for (const [voce, termini] of Object.entries(fuori)) {
    for (const t of termini) fuori2.push({ voce, termine: normalizza(t) });
  }
  for (const [voce, traduzioni] of Object.entries(ALLERGENI)) {
    for (const t of Object.values(traduzioni)) fuori2.push({ voce, termine: normalizza(t) });
  }
  for (const [scritto, voce] of Object.entries(SINONIMI_ALLERGENI)) {
    fuori2.push({ voce, termine: normalizza(scritto) });
  }
  // I termini piu' lunghi per primi: "frutta a guscio" prima di "frutta"
  return fuori2.filter(x => x.termine.length >= 2).sort((a, b) => b.termine.length - a.termine.length);
})();

/**
 * Gli allergeni che il cliente ha NOMINATO nel messaggio, gia' normalizzato.
 * "I have a nut allergy" -> ['frutta a guscio'], "sin gluten" -> ['glutine'].
 * Si chiama solo dentro il ramo degli allergeni, quindi una parola come
 * "latte" non puo' scattare su una frase che di allergie non parla.
 */
export function allergeniCitati(msg: string): string[] {
  const con = ' ' + msg + ' ';
  const trovati: string[] = [];
  for (const { voce, termine } of MODI_DI_DIRLO) {
    if (trovati.includes(voce)) continue;
    // Le parole corte vanno cercate intere: "nut" dentro "donut" non vale.
    const c = termine.length >= 4 || SCRITTURA_SENZA_SPAZI.test(termine)
      ? msg.includes(termine)
      : con.includes(' ' + termine + ' ');
    if (c) trovati.push(voce);
  }
  return trovati;
}

// Carne e pesce come compaiono nei nomi e nelle descrizioni dei menu. Serve
// per non proporre a un vegetariano la "Pizza Cotto e Funghi" (cotto =
// prosciutto): e' successo davvero, e il modello da solo non lo evita.
const CARNE_O_PESCE = [
  'carne', 'manzo', 'vitello', 'maiale', 'suino', 'agnello', 'pollo', 'tacchino', 'anatra', 'coniglio',
  'prosciutto', 'cotto', 'crudo', 'speck', 'salame', 'salumi', 'salsiccia', 'guanciale', 'pancetta',
  'bacon', 'lardo', 'mortadella', 'bresaola', 'nduja', 'ragu', 'bolognese', 'carbonara', 'amatriciana',
  'ossobuco', 'tagliata', 'entrecot', 'filetto', 'controfiletto', 'costata', 'hamburger', 'polpette',
  'pesce', 'tonno', 'salmone', 'acciughe', 'alici', 'baccala', 'branzino', 'orata', 'merluzzo',
  'gamberi', 'gamberetti', 'scampi', 'calamari', 'seppie', 'polpo', 'cozze', 'vongole', 'frutti di mare',
  'marinara',
  'meat', 'beef', 'veal', 'pork', 'lamb', 'chicken', 'turkey', 'duck', 'ham', 'sausage', 'steak',
  'anchovy', 'anchovies', 'tuna', 'salmon', 'prawn', 'prawns', 'shrimp', 'squid', 'octopus', 'clams', 'mussels',
  'seafood', 'fish', 'bottarga',
  // Lo spagnolo pesa: moltissimi menu hanno il nome in italiano e la
  // descrizione in spagnolo, ed e' li' che si nasconde la carne. Il
  // "Tagliere Bologna" era "tabla de mortadela": scritto con una L sola,
  // non lo prendeva nessuna parola italiana, ed e' finito in un elenco
  // vegetariano.
  'carne', 'carnes', 'pollo', 'cerdo', 'jamon', 'ternera', 'cordero', 'atun', 'gambas', 'marisco', 'mariscos',
  'pulpo', 'chorizo', 'mortadela', 'embutido', 'embutidos', 'fiambre', 'fiambres', 'charcuteria', 'charcuterie',
  'affettati', 'salumeria', 'lomo', 'solomillo', 'panceta', 'beicon', 'cecina', 'sobrasada', 'porchetta',
  'coppa', 'capocollo', 'wurstel', 'pastrami', 'pescado', 'salmon', 'bacalao', 'merluza', 'boquerones',
  'anchoa', 'anchoas', 'mejillones', 'almejas', 'langostinos', 'calamares', 'sepia', 'sardinas', 'trucha',
  // Un tagliere e' quasi sempre di salumi: nel dubbio si esclude, come da regola.
  'tagliere', 'tabla', 'taglieri',
  'viande', 'boeuf', 'porc', 'poulet', 'jambon', 'canard', 'poisson', 'thon', 'saumon', 'crevettes',
  'fleisch', 'rind', 'schwein', 'huhn', 'hahnchen', 'schinken', 'wurst', 'lachs', 'thunfisch', 'garnelen',
  'frango', 'carne', 'presunto', 'peixe', 'atum', 'camarao',
];

/**
 * Il piatto NON nomina carne ne' pesce, quindi puo' essere proposto a un
 * vegetariano. Si guarda solo quello che ha scritto il ristorante: la regola
 * e' la stessa degli allergeni, non si deduce niente che non sia scritto.
 * Nel dubbio si esclude: meglio un elenco corto che un prosciutto.
 */
export function sembraVegetariano(p: { name: string; description?: string | null }): boolean {
  // Parola intera, non pezzo di parola: "porcini" contiene "porc" (maiale in
  // francese) e faceva sparire il risotto ai funghi dall'elenco vegetariano.
  const testo = ' ' + normalizza(`${p.name} ${p.description || ''}`) + ' ';
  return !CARNE_O_PESCE.some(w => testo.includes(' ' + w + ' '));
}

/**
 * Minuscolo, via gli accenti, via la punteggiatura, spazi normalizzati.
 * Serve perche' "Tagliatelle al ragù," e "tagliatelle al ragu" sono lo stesso
 * piatto, e il cliente scrive come gli pare.
 *
 * ATTENZIONE, qui si e' gia' sbagliato una volta: la scomposizione (NFD)
 * serve SOLO a staccare gli accenti latini, e va disfatta subito dopo (NFC).
 * Senza il passo di ricomposizione il giapponese perdeva i segni sonori
 * ("グルテン" diventava "ク ルテン"), il coreano si spezzava in jamo e l'arabo
 * perdeva la hamza: nessuna parola chiave di quelle lingue veniva piu'
 * riconosciuta, e con lei spariva la scorciatoia degli allergeni.
 * Per lo stesso motivo fra i caratteri da tenere ci sono anche i segni
 * combinanti (\p{M}): sono le vocali dell'hindi e dell'arabo, non punteggiatura.
 *
 * Esportata perche' la usa anche menu-contesto.ts per pesare i piatti.
 */
export function normalizza(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // solo gli accenti latini
    .normalize('NFC')                  // kana, hangul, devanagari e arabo tornano interi
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Scritture senza spazi fra le parole: si contano i caratteri, non le parole. */
export const SCRITTURA_SENZA_SPAZI = /[぀-ヿ一-鿿가-힯]/;

/**
 * Quanto e' "corta" una domanda. Le lingue senza spazi (cinese, giapponese)
 * vanno contate a caratteri, altrimenti risulterebbero sempre di una parola.
 */
/** Quanti piatti al massimo in un elenco: il cliente legge dal telefono. */
const MAX_PIATTI_ELENCATI = 10;

function troppoLunga(msg: string): boolean {
  if (msg.length > 70) return true;
  const parole = msg.trim().split(/\s+/).length;
  return parole > 10;
}

// ── Parole che accendono un intento ─────────────────────────────────────────
// Una lista piatta per tutte le lingue: un cliente coreano non fara' mai
// scattare per sbaglio una parola italiana, quindi non serve tenerle divise.
// Sono gia' normalizzate (minuscole, senza accenti) come l'input.

// SOLO allergie e intolleranze vere. "Vegetariano" stava qui dentro e faceva
// danni: chi scriveva "sono vegetariano" o "la carbonara e' vegetariana?" si
// sentiva rispondere "dimmi quale allergia hai", perche' la frase finiva nel
// ramo degli allergeni. Essere vegetariani e' una scelta, non un'allergia:
// sta in PAROLE_VEGETARIANO e la risposta la compone chi di dovere.
export const PAROLE_ALLERGENI = normalizzaElenco([
  // it / es / pt
  'allergen', 'allergi', 'alerg', 'glutine', 'gluten', 'lattosio', 'lactosa', 'lactose',
  'celiac', 'celiaco', 'intolleran', 'intoleran',
  'arachidi', 'amendoim', 'frutta a guscio', 'frutos secos',
  // en / de / fr
  'allerg', 'coeliac', 'lactose', 'peanut', 'dairy', 'laktose', 'zoliakie',
  'unvertraglich', 'erdnuss', 'coeliaque', 'arachide',
  // ru
  'аллерг', 'глютен',
  'лактоз',
  // zh
  '过敏', '麸质', '乳糖', '花生',
  // ja
  'アレルギ', 'グルテン', '乳糖',
  // ar
  'حساسية', 'غلوتين',
  // ko
  '알레르기', '글루텐', '유당',
  // id
  'alergi', 'laktosa',
  // hi
  'एलर्जी', 'ग्लूटेन',
]);

/**
 * Vegetariano e vegano in tutte le lingue. Serve in due posti opposti:
 * qui, per NON trattare la frase come un'allergia; in consigli-pronti.ts,
 * per riconoscere la domanda e dare l'elenco dei piatti senza carne.
 * Prima esistevano solo le forme latine, quindi un cliente russo, cinese,
 * arabo, giapponese o coreano non veniva riconosciuto in nessuno dei due.
 */
export const PAROLE_VEGETARIANO = normalizzaElenco([
  'vegetarian', 'vegetariano', 'vegetariana', 'vegetariani', 'vegetariane',
  'vegetarien', 'vegetarienne', 'vegetarisch', 'vegetarier', 'vegetarier',
  'vegano', 'vegana', 'vegan', 'vegana', 'vegetariska',
  'вегетариан', 'веган',
  '素食', '蔬食', '纯素',
  'ベジタリアン', 'ビーガン', '菜食',
  'نباتي', 'نباتية',
  '채식', '비건',
  'शाकाहारी', 'वीगन',
]);

/** Vegano (non solo vegetariano): l'elenco dei piatti lo deve comporre l'IA. */
export const PAROLE_VEGANO = normalizzaElenco(['vegan', 'vegano', 'vegana', 'веган', '纯素', 'ビーガン', '비건', 'वीगन']);

const PAROLE_ORDINE = normalizzaElenco([
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
]);

// "e da bere?" / "che vino ci sta?" — l'abbinamento e' scritto in dish_answers.
const PAROLE_BEVUTA = normalizzaElenco([
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
]);

const PAROLE_GRAZIE = normalizzaElenco([
  'grazie', 'thanks', 'thank you', 'danke', 'gracias', 'merci', 'obrigado', 'obrigada',
  'спасибо', '谢谢',
  'ありがとう', 'شكرا', '감사',
  'terima kasih', 'धन्यवाद',
]);

/**
 * Parole di allergeni troppo corte per cercarle come pezzo di testo: "nut"
 * dentro "donut" farebbe partire l'intento sbagliato. Queste si cercano come
 * parola intera.
 */
export const PAROLE_ALLERGENI_INTERE = normalizzaElenco([
  'nut', 'nuts', 'noci', 'noce', 'soia', 'soy', 'uova', 'uovo', 'egg', 'eggs',
  'latte', 'milk', 'pesce', 'fish', 'sesamo', 'sesame', 'sedano', 'celery',
  'senape', 'mustard', 'solfiti', 'sulphites', 'sulfites', 'molluschi', 'crostacei',
]);

/**
 * Le liste qui sopra si confrontano con testo gia' passato da normalizza(),
 * quindi devono passarci anche loro: altrimenti basta una lettera con un
 * segno (il russo "вайфай" diventa "ваифаи") perche' la parola chiave non
 * combaci piu' con niente e la scorciatoia sparisca in silenzio.
 * Esportata perche' la stessa regola vale per gli elenchi di consigli-pronti.
 */
export function normalizzaElenco(parole: string[]): string[] {
  return [...new Set(parole.map(p => normalizza(p)).filter(Boolean))];
}

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
  /** "Senza glutine avete qualcosa?" — i piatti che non hanno QUELL'allergene registrato. */
  senzaAllergene: (allergeni: string, piatti: string, altri: number) => string;
  /** Nessun piatto ha allergeni registrati: non possiamo dire niente. */
  allergeniNonSappiamo: string;
  abbinamentoDi: (piatto: string, testo: string) => string;
  ordine: string;
  grazie: string;
  suggerimenti: string[];
}

const T: Record<string, Testi> = {
  it: {
    allergeniDi: (p, e) => `Per **${p}** il ristorante ha registrato: ${e}.\nPrima di ordinare dillo al cameriere: la conferma la dà sempre la cucina.`,
    allergeniNonRegistrati: p => `Per **${p}** il ristorante non ha ancora registrato gli allergeni, quindi non posso dirtelo io.\nChiedi al cameriere prima di ordinare: li conferma la cucina.`,
    allergeniQualePiatto: 'Dimmi quale allergia o intolleranza hai e quale piatto ti interessa: ti riporto gli allergeni che il ristorante ha registrato.\nPrima di ordinare dillo anche al cameriere: la conferma la dà sempre la cucina.',
    senzaAllergene: (a, p, altri) => `Fra i piatti di cui il ristorante ha registrato gli allergeni, questi non hanno ${a} in elenco:\n${p}\n${altri > 0 ? `Per altri ${altri} piatti gli allergeni non sono ancora registrati, quindi non li posso controllare.\n` : ''}Non è una garanzia: dillo al cameriere prima di ordinare, la conferma la dà sempre la cucina.`,
    allergeniNonSappiamo: 'Questo ristorante non ha ancora registrato gli allergeni dei piatti, quindi non posso dirti quali evitare.\nDillo al cameriere prima di ordinare: la conferma la dà sempre la cucina.',
    abbinamentoDi: (p, t) => `🍷 Con **${p}** ti consiglio: ${t}`,
    ordine: 'Puoi salvare il piatto nell’app per non dimenticarlo: il cameriere viene al tavolo a prendere l’ordine.',
    grazie: 'Figurati! Se ti serve altro sono qui.',
    suggerimenti: ['Cosa mi consigli?', 'Che vino ci abbino?', 'Menu degustazione per 2'],
  },
  en: {
    allergeniDi: (p, e) => `For **${p}** the restaurant has registered: ${e}.\nPlease tell your waiter before ordering: the kitchen always confirms.`,
    allergeniNonRegistrati: p => `The restaurant hasn’t registered allergens for **${p}** yet, so I can’t tell you myself.\nPlease ask your waiter before ordering — the kitchen confirms.`,
    allergeniQualePiatto: 'Tell me your allergy or intolerance and which dish you’re interested in: I’ll give you the allergens the restaurant has registered.\nPlease also tell your waiter before ordering: the kitchen always confirms.',
    senzaAllergene: (a, p, altri) => `Among the dishes the restaurant has registered allergens for, these do not list ${a}:\n${p}\n${altri > 0 ? `Allergens are not registered yet for ${altri} other dishes, so I can’t check those.\n` : ''}This is not a guarantee: tell your waiter before ordering, the kitchen always confirms.`,
    allergeniNonSappiamo: 'This restaurant hasn’t registered allergens for its dishes yet, so I can’t tell you which ones to avoid.\nTell your waiter before ordering: the kitchen always confirms.',
    abbinamentoDi: (p, t) => `🍷 With **${p}** I’d suggest: ${t}`,
    ordine: 'You can save the dish in the app so you don’t forget it: the waiter will come to your table to take the order.',
    grazie: 'Anytime! I’m here if you need anything else.',
    suggerimenti: ['What do you recommend?', 'What wine pairs with this?', 'Tasting menu for 2'],
  },
  de: {
    allergeniDi: (p, e) => `Für **${p}** hat das Restaurant eingetragen: ${e}.\nBitte sagen Sie es vor der Bestellung der Bedienung: die Küche bestätigt es immer.`,
    allergeniNonRegistrati: p => `Für **${p}** sind noch keine Allergene eingetragen, ich kann es Ihnen also nicht sagen.\nFragen Sie bitte vor der Bestellung die Bedienung — die Küche bestätigt.`,
    allergeniQualePiatto: 'Nennen Sie mir Ihre Allergie oder Unverträglichkeit und das Gericht, das Sie interessiert: ich nenne Ihnen die eingetragenen Allergene.\nBitte sagen Sie es vor der Bestellung auch der Bedienung: die Küche bestätigt es immer.',
    senzaAllergene: (a, p, altri) => `Unter den Gerichten, für die das Restaurant Allergene eingetragen hat, führen diese kein ${a} auf:\n${p}\n${altri > 0 ? `Für ${altri} weitere Gerichte sind noch keine Allergene eingetragen, die kann ich nicht prüfen.\n` : ''}Das ist keine Garantie: sagen Sie es vor der Bestellung der Bedienung, die Küche bestätigt es immer.`,
    allergeniNonSappiamo: 'Dieses Restaurant hat noch keine Allergene zu den Gerichten eingetragen, deshalb kann ich Ihnen nicht sagen, welche Sie meiden sollten.\nSagen Sie es vor der Bestellung der Bedienung: die Küche bestätigt es immer.',
    abbinamentoDi: (p, t) => `🍷 Zu **${p}** empfehle ich: ${t}`,
    ordine: 'Sie können das Gericht in der App speichern, damit Sie es nicht vergessen: die Bedienung nimmt die Bestellung am Tisch auf.',
    grazie: 'Sehr gerne! Melden Sie sich, wenn Sie noch etwas brauchen.',
    suggerimenti: ['Was empfehlen Sie?', 'Welcher Wein passt dazu?', 'Degustationsmenü für 2'],
  },
  es: {
    allergeniDi: (p, e) => `Para **${p}** el restaurante ha registrado: ${e}.\nAntes de pedir díselo al camarero: la cocina siempre lo confirma.`,
    allergeniNonRegistrati: p => `El restaurante aún no ha registrado los alérgenos de **${p}**, así que no puedo decírtelo yo.\nPregúntale al camarero antes de pedir: lo confirma la cocina.`,
    allergeniQualePiatto: 'Dime qué alergia o intolerancia tienes y qué plato te interesa: te digo los alérgenos que el restaurante ha registrado.\nAntes de pedir díselo también al camarero: la cocina siempre lo confirma.',
    senzaAllergene: (a, p, altri) => `Entre los platos cuyos alérgenos ha registrado el restaurante, estos no incluyen ${a}:\n${p}\n${altri > 0 ? `Para otros ${altri} platos los alérgenos aún no están registrados, así que no los puedo comprobar.\n` : ''}No es una garantía: díselo al camarero antes de pedir, la cocina siempre lo confirma.`,
    allergeniNonSappiamo: 'Este restaurante todavía no ha registrado los alérgenos de sus platos, así que no puedo decirte cuáles evitar.\nDíselo al camarero antes de pedir: la cocina siempre lo confirma.',
    abbinamentoDi: (p, t) => `🍷 Con **${p}** te recomiendo: ${t}`,
    ordine: 'Puedes guardar el plato en la app para no olvidarlo: el camarero vendrá a la mesa a tomar el pedido.',
    grazie: '¡De nada! Aquí estoy si necesitas algo más.',
    suggerimenti: ['¿Qué me recomiendas?', '¿Qué vino marida?', 'Menú degustación para 2'],
  },
  fr: {
    allergeniDi: (p, e) => `Pour **${p}** le restaurant a enregistré : ${e}.\nAvant de commander, dites-le au serveur : la cuisine confirme toujours.`,
    allergeniNonRegistrati: p => `Le restaurant n’a pas encore enregistré les allergènes de **${p}**, je ne peux donc pas vous le dire.\nDemandez au serveur avant de commander : la cuisine confirme.`,
    allergeniQualePiatto: 'Dites-moi votre allergie ou intolérance et le plat qui vous intéresse : je vous donne les allergènes enregistrés par le restaurant.\nAvant de commander, dites-le aussi au serveur : la cuisine confirme toujours.',
    senzaAllergene: (a, p, altri) => `Parmi les plats dont le restaurant a enregistré les allergènes, ceux-ci ne mentionnent pas ${a} :\n${p}\n${altri > 0 ? `Pour ${altri} autres plats les allergènes ne sont pas encore enregistrés, je ne peux pas les vérifier.\n` : ''}Ce n’est pas une garantie : dites-le au serveur avant de commander, la cuisine confirme toujours.`,
    allergeniNonSappiamo: 'Ce restaurant n’a pas encore enregistré les allergènes de ses plats, je ne peux donc pas vous dire lesquels éviter.\nDites-le au serveur avant de commander : la cuisine confirme toujours.',
    abbinamentoDi: (p, t) => `🍷 Avec **${p}** je vous conseille : ${t}`,
    ordine: 'Vous pouvez enregistrer le plat dans l’application pour ne pas l’oublier : le serveur viendra prendre la commande à table.',
    grazie: 'Avec plaisir ! Je reste à votre disposition.',
    suggerimenti: ['Que me conseillez-vous ?', 'Quel vin avec ça ?', 'Menu dégustation pour 2'],
  },
  pt: {
    allergeniDi: (p, e) => `Para **${p}** o restaurante registou: ${e}.\nAntes de pedir diga ao empregado: a cozinha confirma sempre.`,
    allergeniNonRegistrati: p => `O restaurante ainda não registou os alergénios de **${p}**, por isso não lhe posso dizer.\nPergunte ao empregado antes de pedir: a cozinha confirma.`,
    allergeniQualePiatto: 'Diga-me a sua alergia ou intolerância e o prato que lhe interessa: digo-lhe os alergénios registados pelo restaurante.\nAntes de pedir diga também ao empregado: a cozinha confirma sempre.',
    senzaAllergene: (a, p, altri) => `Entre os pratos cujos alergénios o restaurante registou, estes não incluem ${a}:\n${p}\n${altri > 0 ? `Para outros ${altri} pratos os alergénios ainda não estão registados, por isso não os posso verificar.\n` : ''}Não é uma garantia: diga ao empregado antes de pedir, a cozinha confirma sempre.`,
    allergeniNonSappiamo: 'Este restaurante ainda não registou os alergénios dos pratos, por isso não lhe posso dizer quais evitar.\nDiga ao empregado antes de pedir: a cozinha confirma sempre.',
    abbinamentoDi: (p, t) => `🍷 Com **${p}** recomendo: ${t}`,
    ordine: 'Pode guardar o prato na app para não se esquecer: o empregado vem à mesa tirar o pedido.',
    grazie: 'De nada! Estou aqui se precisar de mais alguma coisa.',
    suggerimenti: ['O que me recomenda?', 'Que vinho combina?', 'Menu de degustação para 2'],
  },
  ru: {
    allergeniDi: (p, e) => `Для **${p}** ресторан указал: ${e}.\nПеред заказом скажите об этом официанту: окончательно подтверждает кухня.`,
    allergeniNonRegistrati: p => `Для **${p}** аллергены ещё не указаны, поэтому я не могу сказать.\nСпросите официанта перед заказом: подтверждает кухня.`,
    allergeniQualePiatto: 'Скажите, какая у вас аллергия или непереносимость и какое блюдо вас интересует: я назову аллергены, указанные рестораном.\nПеред заказом скажите об этом и официанту: окончательно подтверждает кухня.',
    senzaAllergene: (a, p, altri) => `Среди блюд, для которых ресторан указал аллергены, эти не содержат в списке ${a}:\n${p}\n${altri > 0 ? `Ещё для ${altri} блюд аллергены пока не указаны, поэтому проверить их я не могу.\n` : ''}Это не гарантия: скажите официанту перед заказом, окончательно подтверждает кухня.`,
    allergeniNonSappiamo: 'Этот ресторан ещё не указал аллергены блюд, поэтому я не могу сказать, чего избегать.\nСкажите официанту перед заказом: окончательно подтверждает кухня.',
    abbinamentoDi: (p, t) => `🍷 К блюду **${p}** советую: ${t}`,
    ordine: 'Сохраните блюдо в приложении, чтобы не забыть: официант подойдёт к столику и примет заказ.',
    grazie: 'Пожалуйста! Обращайтесь, если что-то нужно.',
    suggerimenti: ['Что посоветуете?', 'Какое вино подойдёт?', 'Дегустация на двоих'],
  },
  zh: {
    allergeniDi: (p, e) => `关于**${p}**，餐厅登记的过敏原：${e}。\n点菜前请告知服务员，最终由厨房确认。`,
    allergeniNonRegistrati: p => `餐厅尚未登记**${p}**的过敏原，所以我无法告知。\n点菜前请询问服务员，由厨房确认。`,
    allergeniQualePiatto: '请告诉我您的过敏或不耐受情况，以及您想了解的菜品，我会告知餐厅登记的过敏原。\n点菜前也请告知服务员，最终由厨房确认。',
    senzaAllergene: (a, p, altri) => `在餐厅已登记过敏原的菜品中，以下菜品的登记信息里没有${a}：\n${p}\n${altri > 0 ? `另有 ${altri} 道菜尚未登记过敏原，我无法为您核对。\n` : ''}这并非保证：点菜前请告知服务员，最终由厨房确认。`,
    allergeniNonSappiamo: '本餐厅尚未登记菜品的过敏原，因此我无法告诉您应避开哪些。\n点菜前请告知服务员：最终由厨房确认。',
    abbinamentoDi: (p, t) => `🍷 搭配**${p}**，推荐：${t}`,
    ordine: '您可以在应用里保存这道菜以免忘记：服务员会到桌前为您点菜。',
    grazie: '不客气！需要其他帮助随时告诉我。',
    suggerimenti: ['有什么推荐？', '配什么酒？', '两人品尝套餐'],
  },
  ja: {
    allergeniDi: (p, e) => `**${p}**について、レストランが登録しているアレルギー物質：${e}。\nご注文前にスタッフにお伝えください。最終確認は厨房が行います。`,
    allergeniNonRegistrati: p => `**${p}**のアレルギー情報はまだ登録されていないため、お答えできません。\nご注文前にスタッフにお尋ねください。厨房が確認します。`,
    allergeniQualePiatto: 'アレルギーや苦手な食材と、気になる料理を教えてください。登録されているアレルギー物質をお伝えします。\nご注文前にスタッフにもお伝えください。最終確認は厨房が行います。',
    senzaAllergene: (a, p, altri) => `レストランがアレルギー物質を登録している料理のうち、${a}が登録されていないものはこちらです：\n${p}\n${altri > 0 ? `ほかに${altri}品はアレルギー情報が未登録のため、確認できません。\n` : ''}保証ではありません。ご注文前にスタッフにお伝えください。最終確認は厨房が行います。`,
    allergeniNonSappiamo: 'このレストランはまだ料理のアレルギー物質を登録していないため、避けるべきものをお伝えできません。\nご注文前にスタッフにお伝えください。最終確認は厨房が行います。',
    abbinamentoDi: (p, t) => `🍷 **${p}**には、こちらがおすすめです：${t}`,
    ordine: '忘れないようアプリに保存できます。ご注文はスタッフがテーブルで承ります。',
    grazie: 'どういたしまして！他にもあればお声がけください。',
    suggerimenti: ['おすすめは？', '合うワインは？', '2名様のコース'],
  },
  ar: {
    allergeniDi: (p, e) => `لـ **${p}** سجّل المطعم: ${e}.\nقبل الطلب أخبر النادل: المطبخ هو من يؤكّد دائماً.`,
    allergeniNonRegistrati: p => `لم يسجّل المطعم بعد محسسات **${p}**، لذلك لا يمكنني إخبارك.\nاسأل النادل قبل الطلب: المطبخ يؤكّد.`,
    allergeniQualePiatto: 'أخبرني بحساسيتك أو عدم تحمّلك وبالطبق الذي يهمّك، وسأذكر لك المحسسات التي سجّلها المطعم.\nقبل الطلب أخبر النادل أيضاً: المطبخ هو من يؤكّد دائماً.',
    senzaAllergene: (a, p, altri) => `من بين الأطباق التي سجّل المطعم محسساتها، هذه لا تتضمّن ${a}:\n${p}\n${altri > 0 ? `وهناك ${altri} أطباق أخرى لم تُسجَّل محسساتها بعد، فلا يمكنني التحقّق منها.\n` : ''}هذا ليس ضماناً: أخبر النادل قبل الطلب، فالمطبخ هو من يؤكّد دائماً.`,
    allergeniNonSappiamo: 'لم يسجّل هذا المطعم بعد محسسات أطباقه، لذلك لا يمكنني إخبارك بما يجب تجنّبه.\nأخبر النادل قبل الطلب: المطبخ هو من يؤكّد دائماً.',
    abbinamentoDi: (p, t) => `🍷 مع **${p}** أنصحك: ${t}`,
    ordine: 'يمكنك حفظ الطبق في التطبيق حتى لا تنساه: النادل سيأتي إلى الطاولة لأخذ الطلب.',
    grazie: 'عفوًا! أنا هنا إذا احتجت شيئًا آخر.',
    suggerimenti: ['بماذا تنصحني؟', 'ما النبيذ المناسب؟', 'قائمة تذوق لشخصين'],
  },
  ko: {
    allergeniDi: (p, e) => `**${p}**에 대해 식당이 등록한 알레르기 유발 물질: ${e}.\n주문 전에 직원에게 꼭 말씀해 주세요. 최종 확인은 주방에서 합니다.`,
    allergeniNonRegistrati: p => `**${p}**의 알레르기 정보가 아직 등록되지 않아 알려드릴 수 없어요.\n주문 전에 직원에게 문의해 주세요. 주방이 확인합니다.`,
    allergeniQualePiatto: '알레르기나 못 드시는 음식, 그리고 궁금한 요리를 알려 주세요. 식당이 등록한 알레르기 정보를 알려드릴게요.\n주문 전에 직원에게도 꼭 말씀해 주세요. 최종 확인은 주방에서 합니다.',
    senzaAllergene: (a, p, altri) => `식당이 알레르기 정보를 등록한 요리 중에서 ${a}이(가) 등록되지 않은 것은 다음과 같아요:\n${p}\n${altri > 0 ? `다른 ${altri}개 요리는 알레르기 정보가 아직 등록되지 않아 확인해 드릴 수 없어요.\n` : ''}보장은 아니에요. 주문 전에 직원에게 꼭 말씀해 주세요. 최종 확인은 주방에서 합니다.`,
    allergeniNonSappiamo: '이 식당은 아직 요리의 알레르기 정보를 등록하지 않아서 무엇을 피해야 하는지 알려드릴 수 없어요.\n주문 전에 직원에게 말씀해 주세요. 최종 확인은 주방에서 합니다.',
    abbinamentoDi: (p, t) => `🍷 **${p}**에는 이것을 추천해요: ${t}`,
    ordine: '잊지 않도록 앱에 저장해 두세요. 주문은 직원이 테이블에서 받습니다.',
    grazie: '천만에요! 필요하신 게 있으면 말씀해 주세요.',
    suggerimenti: ['추천해 주세요', '어울리는 와인은?', '2인 테이스팅 코스'],
  },
  id: {
    allergeniDi: (p, e) => `Untuk **${p}** restoran mencatat: ${e}.\nSebelum memesan, beri tahu pelayan: dapur selalu mengonfirmasi.`,
    allergeniNonRegistrati: p => `Restoran belum mencatat alergen untuk **${p}**, jadi saya tidak bisa memberitahukannya.\nTanyakan kepada pelayan sebelum memesan — dapur yang mengonfirmasi.`,
    allergeniQualePiatto: 'Beri tahu saya alergi atau intoleransi Anda dan hidangan yang Anda minati: saya sebutkan alergen yang dicatat restoran.\nSebelum memesan, beri tahu juga pelayan: dapur selalu mengonfirmasi.',
    senzaAllergene: (a, p, altri) => `Di antara hidangan yang alergennya sudah dicatat restoran, berikut yang tidak mencantumkan ${a}:\n${p}\n${altri > 0 ? `Untuk ${altri} hidangan lain alergennya belum dicatat, jadi tidak bisa saya periksa.\n` : ''}Ini bukan jaminan: beri tahu pelayan sebelum memesan, dapur selalu mengonfirmasi.`,
    allergeniNonSappiamo: 'Restoran ini belum mencatat alergen hidangannya, jadi saya tidak bisa memberi tahu mana yang harus dihindari.\nBeri tahu pelayan sebelum memesan: dapur selalu mengonfirmasi.',
    abbinamentoDi: (p, t) => `🍷 Dengan **${p}** saya sarankan: ${t}`,
    ordine: 'Anda bisa menyimpan hidangan di aplikasi agar tidak lupa: pelayan akan datang ke meja untuk mencatat pesanan.',
    grazie: 'Sama-sama! Saya di sini kalau ada yang lain.',
    suggerimenti: ['Apa rekomendasinya?', 'Wine apa yang cocok?', 'Menu cicip untuk 2'],
  },
  hi: {
    allergeniDi: (p, e) => `**${p}** के लिए रेस्टोरेंट ने दर्ज किया है: ${e}।\nऑर्डर करने से पहले वेटर को ज़रूर बताएं: पुष्टि हमेशा रसोई करती है।`,
    allergeniNonRegistrati: p => `**${p}** की एलर्जी जानकारी अबतक दर्ज नहीं है, इसलिए मैं नहीं बता सकता।\nऑर्डर से पहले वेटर से पूछें: रसोई पुष्टि करती है।`,
    allergeniQualePiatto: 'अपनी एलर्जी या असहनशीलता और जिस व्यंजन में रुचि है, बताइए: मैं रेस्टोरेंट द्वारा दर्ज एलर्जी जानकारी बता दूंगा।\nऑर्डर करने से पहले वेटर को भी ज़रूर बताएं: पुष्टि हमेशा रसोई करती है।',
    senzaAllergene: (a, p, altri) => `जिन व्यंजनों की एलर्जी जानकारी रेस्टोरेंट ने दर्ज की है, उनमें से इनमें ${a} दर्ज नहीं है:\n${p}\n${altri > 0 ? `अन्य ${altri} व्यंजनों की एलर्जी जानकारी अभी दर्ज नहीं है, इसलिए उन्हें मैं जांच नहीं सकता।\n` : ''}यह गारंटी नहीं है: ऑर्डर से पहले वेटर को बताएं, पुष्टि हमेशा रसोई करती है।`,
    allergeniNonSappiamo: 'इस रेस्टोरेंट ने अभी तक व्यंजनों की एलर्जी जानकारी दर्ज नहीं की है, इसलिए मैं नहीं बता सकता कि किनसे बचें।\nऑर्डर से पहले वेटर को बताएं: पुष्टि हमेशा रसोई करती है।',
    abbinamentoDi: (p, t) => `🍷 **${p}** के साथ मेरा सुझाव: ${t}`,
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

/** I suggerimenti standard di una lingua (inglese se la lingua manca). */
export function suggerimentiPredefiniti(lang: string): string[] {
  return [...testi(lang).suggerimenti];
}

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

// Parole troppo comuni per riconoscere un vino da sole
const PAROLE_VINO_GENERICHE = new Set([
  'vino', 'vini', 'wine', 'rosso', 'rossa', 'bianco', 'bianca', 'rosato', 'rose', 'tinto', 'blanco', 'rouge', 'blanc',
  'doc', 'docg', 'igt', 'igp', 'dop', 'aoc', 'classico', 'superiore', 'riserva', 'reserva', 'della', 'delle', 'dei', 'del',
  'veneto', 'trentino', 'toscana', 'sicilia', 'puglia', 'langhe', 'blush', 'brut', 'extra', 'dry', 'sweet', 'house', 'casa',
]);

/** La categoria e' di vini (i vini hanno per abbinamento un cibo, non un vino). */
export function categoriaVini(categoria: string): boolean {
  return /vin|wine|wein/i.test(categoria || '');
}

/** I vini in carta, ognuno ridotto alle parole che lo distinguono. */
export function viniInCarta(piatti: Array<{ name: string; category: string }>): string[][] {
  return piatti
    .filter(p => categoriaVini(p.category))
    .map(p => normalizza(p.name).split(' ').filter(w => w.length >= 4 && !PAROLE_VINO_GENERICHE.has(w)))
    .filter(parole => parole.length > 0);
}

/**
 * Un abbinamento scritto prima si usa solo se nomina un vino che il ristorante
 * ha davvero. Senza carta dei vini va bene uno stile ("un bianco fresco").
 * Con la carta, "come un Greco di Tufo" quando il Greco non c'e' e' un errore
 * che il cameriere deve smentire al tavolo: meglio lasciar rispondere l'IA,
 * che ha la carta davanti.
 */
export function abbinamentoValido(testo: string, vini: string[][]): boolean {
  if (!testo) return false;
  if (vini.length === 0) return true;
  const t = ' ' + normalizza(testo) + ' ';
  return vini.some(parole => parole.some(w => t.includes(' ' + w + ' ')));
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
  // Si guardano solo i piatti da mangiare (i vini citati non contano). Se la
  // risposta ne nomina piu' d'uno non si indovina: "che vino ci abbino?"
  // dopo un consiglio con risotto E tagliatella lo decide l'IA, che legge
  // la conversazione. Prima si prendeva l'ultimo e spesso era quello sbagliato.
  const citati = new Set<PiattoRisolto>();
  for (const n of nomi) {
    const p = piatti.find(x => x.chiavi.includes(n));
    if (p && !categoriaVini(p.category) && !/bevand|drink|beverage|cocktail|birr|beer|soft/i.test(p.category || '')) citati.add(p);
  }
  return citati.size === 1 ? [...citati][0] : null;
}

function schedaPiatto(p: PiattoRisolto, valuta: string, lang: string, t: Testi, vini: string[][] = []): string {
  const righe = [`**${p.nomeMostrato}** · ${valuta}${Number(p.price).toFixed(2)}`];
  // Il racconto scritto prima batte la descrizione del menu: e' piu' ricco ed
  // e' stato riletto dal ristoratore. Se non c'e' si usa la descrizione.
  if (p.racconto) righe.push(p.racconto);
  else if (p.descrizioneMostrata) righe.push(p.descrizioneMostrata);
  // Per un vino l'abbinamento e' un cibo: il controllo sulla carta non vale
  if (p.abbinamento && (categoriaVini(p.category) || abbinamentoValido(p.abbinamento, vini))) {
    righe.push((categoriaVini(p.category) ? '🍽️ ' : '🍷 ') + p.abbinamento);
  }
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
        message: schedaPiatto(piatto, simboloValuta(p.currency), p.language, testi(p.language), viniInCarta(p.dishes)),
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
      message: schedaPiatto(esatto, valuta, p.language, t, viniInCarta(p.dishes)),
      suggestions: t.suggerimenti,
      intento: 'piatto',
    };
  }

  // 2. ALLERGENI — prima degli altri: "allergeni della carbonara" non e' una
  //    richiesta della scheda del piatto, e la risposta deve essere la frase
  //    di sicurezza, sempre identica, mai generata.
  // "soy" e' la soia in inglese ma "sono" in spagnolo ("soy vegetariano")
  const allergeniInteri = p.language === 'es' ? PAROLE_ALLERGENI_INTERE.filter(w => w !== 'soy') : PAROLE_ALLERGENI_INTERE;
  // Vegetariano e vegano NON sono allergie: se il cliente parla solo di
  // quello, qui non si risponde ("la carbonara e' vegetariana?" riceveva
  // l'elenco degli allergeni, che del guanciale non dice niente).
  const parlaDiVegetariano = contiene(msg, PAROLE_VEGETARIANO);
  const parlaDiAllergie = contiene(msg, PAROLE_ALLERGENI) || contieneParolaIntera(msg, allergeniInteri);
  if (parlaDiAllergie && !parlaDiVegetariano) {
    const piatto = piattoCitato(msg, piatti);
    if (piatto) {
      const elenco = elencoAllergeni(piatto.allergens, p.language);
      return {
        message: elenco.length > 0
          ? t.allergeniDi(piatto.nomeMostrato, elenco.join(', '))
          : t.allergeniNonRegistrati(piatto.nomeMostrato),
        suggestions: t.suggerimenti,
        intento: 'allergeni',
      };
    }

    // Nessun piatto nominato, ma il cliente ha detto DI COSA e' allergico
    // ("ho un'allergia alle noci", "avete piatti senza glutine?"): la
    // risposta ce l'abbiamo, ed e' il motivo per cui il ristoratore ha
    // compilato gli allergeni. Prima si rispondeva "dimmi quale allergia
    // hai" a chi l'aveva appena detta.
    const citati = allergeniCitati(msg);
    if (citati.length > 0 && citati.length <= 3) {
      // Solo i piatti per cui il ristorante ha scritto QUALCOSA: un elenco
      // vuoto puo' voler dire "nessun allergene" o "non compilato", e su
      // questo non si tira a indovinare.
      const conDati = piatti.filter(d => Array.isArray(d.allergens) && d.allergens.filter(Boolean).length > 0);
      if (conDati.length === 0) {
        return { message: t.allergeniNonSappiamo, suggestions: t.suggerimenti, intento: 'allergeni' };
      }
      const liberi = conDati.filter(d =>
        !d.allergens.some(a => { const k = chiaveAllergene(a); return k !== null && citati.includes(k); }));
      if (liberi.length > 0) {
        const nomi = liberi.slice(0, MAX_PIATTI_ELENCATI).map(d => `• **${d.nomeMostrato}**`).join('\n');
        const comeSiChiamano = citati.map(c => traduciAllergene(c, p.language)).join(', ');
        return {
          message: t.senzaAllergene(comeSiChiamano, nomi, piatti.length - conDati.length),
          suggestions: t.suggerimenti,
          intento: 'allergeni',
        };
      }
    }
    return { message: t.allergeniQualePiatto, suggestions: t.suggerimenti, intento: 'allergeni' };
  }

  // 3. COSA CI BEVO — l'abbinamento e' scritto prima in dish_answers.
  //    Il piatto puo' essere nominato ("che vino con la carbonara?") oppure
  //    sottinteso ("e da bere?"), e allora lo si prende dall'ultima risposta.
  //    Se l'abbinamento non e' ancora stato generato si passa al modello:
  //    meglio una risposta viva che una riga vuota.
  if (contiene(msg, PAROLE_BEVUTA)) {
    const piatto = piattoCitato(msg, piatti) ?? piattoDalContesto(p.ultimaRisposta || '', piatti);
    if (piatto && abbinamentoValido(piatto.abbinamento, viniInCarta(p.dishes))) {
      return {
        message: t.abbinamentoDi(piatto.nomeMostrato, piatto.abbinamento),
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
