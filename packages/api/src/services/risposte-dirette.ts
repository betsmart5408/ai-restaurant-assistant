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

// ── Gli allergeni come si affacciano nel TESTO del menu ─────────────────────
//
// I menu sono scritti al 96% in inglese, 2% spagnolo, 2% italiano. Ma sono
// menu di cucine giapponesi, thai, indiane, cinesi, libanesi: l'ingrediente
// che tradisce l'allergene e' scritto col suo nome originale dentro una
// frase inglese. "ikan billis" sono acciughe essiccate, "sambal" ha pasta
// di gamberetti, "satay" e' salsa di arachidi, "ghee" e' burro chiarificato.
// Senza queste parole restavano fuori 1.996 piatti, cioe' proprio quelli in
// cui l'allergico non riconosce il pericolo nemmeno leggendo.
//
// Si cercano come pezzo di testo, non come parola intera: i menu scrivono
// "prawns", "prawn", "king prawn" e "gamberetti" e devono combaciare tutti.
// Per questo le voci sono radici corte ma non ambigue.
const INGREDIENTI_ALLERGENE: Record<string, string[]> = {
  glutine: [
    'pane', 'pan tostado', 'pasta', 'pizza', 'spaghetti', 'penne', 'paccheri', 'linguine', 'fettuccine',
    'tagliatell', 'gnocchi', 'lasagn', 'ravioli', 'tortellini', 'rigatoni', 'fusilli', 'orzo', 'farro',
    'farina', 'harina', 'trigo', 'focaccia', 'bruschetta', 'crostini', 'picatostes', 'crouton', 'grissini',
    'bread', 'sourdough', 'baguette', 'ciabatta', 'toast', 'bun', 'wrap', 'pita', 'flour', 'breaded',
    'breadcrumb', 'crumbed', 'batter', 'pastry', 'cake', 'tart', 'biscuit', 'cookie', 'brownie', 'waffle',
    'pancake', 'crepe', 'cannolo', 'cannoli', 'tiramisu', 'savoiardi', 'galleta', 'bizcocho', 'empanad',
    'rebozad', 'empanizad', 'croquet', 'crocche', 'arancin', 'couscous', 'cous cous', 'seitan', 'malt',
    // cucine asiatiche e mediorientali, scritte dentro menu inglesi
    'noodle', 'udon', 'ramen', 'soba', 'gyoza', 'wonton', 'dumpling', 'spring roll', 'tempura', 'panko',
    'katsu', 'bao', 'naan', 'roti', 'paratha', 'chapati', 'samosa', 'pakora', 'filo', 'baklava', 'borek',
    'soy sauce', 'salsa de soja', 'teriyaki', 'hoisin', 'beer', 'birra', 'cerveza', 'barley', 'orzo perlato',
    'kibbeh', 'kibbe', 'bulgur', 'burghul', 'freekeh', 'tabbouleh', 'tabouli', 'fattoush', 'manakish',
    // Nomi che SONO un piatto di pasta anche quando la descrizione non la
    // nomina: la "Carbonara" del menu e' "guanciale, uovo, pecorino", e senza
    // queste voci finiva fra i consigli per un celiaco.
    'carbonara', 'amatriciana', 'cacio e pepe', 'arrabbiata', 'arrabiata', 'puttanesca', 'aglio e olio',
    'alfredo', 'bolognese', 'ragu', 'marinara', 'norma', 'genovese', 'primavera', 'scoglio', 'pescatora',
    'pastasciutta', 'calzone', 'panino', 'sandwich', 'burger', 'piadina', 'schiacciata', 'tigella',
    'panzerotto', 'stromboli', 'focaccina', 'crostata', 'strudel', 'galleta', 'biscotto',
  ],
  latte: [
    'formaggi', 'queso', 'cheese', 'mozzarella', 'parmigian', 'parmesan', 'parmesano', 'ricotta', 'ricota',
    'burrata', 'mascarpone', 'provolone', 'provoletta', 'gorgonzola', 'pecorino', 'fontina', 'stracciatella',
    'feta', 'halloumi', 'brie', 'camembert', 'cheddar', 'panna', 'nata', 'cream', 'crema', 'latte', 'leche',
    'milk', 'butter', 'burro', 'mantequilla', 'yogurt', 'yoghurt', 'gelato', 'ice cream', 'helado',
    'bechamel', 'besciamella', 'alfredo', 'carbonara', 'tzatziki', 'labneh', 'ghee', 'paneer', 'raita',
    'kulfi', 'lassi', 'custard', 'cheesecake', 'milkshake', 'latte macchiato', 'cappuccino',
  ],
  uova: [
    'uovo', 'uova', 'huevo', 'egg', 'mayonnaise', 'mayonesa', 'maionese', 'aioli', 'alioli', 'tortilla',
    'frittata', 'omelette', 'carbonara', 'meringue', 'merengue', 'custard', 'tiramisu', 'zabaione',
    'hollandaise', 'tamago', 'century egg', 'quiche', 'benedict',
  ],
  pesce: [
    'pesce', 'pescado', 'fish', 'tonno', 'atun', 'tuna', 'salmon', 'salmone', 'acciugh', 'anchoa', 'anchov',
    'bacalao', 'baccala', 'merluza', 'branzino', 'orata', 'sardin', 'trucha', 'trota', 'snapper', 'barramundi',
    'cod', 'mackerel', 'sgombro', 'pesce spada', 'swordfish', 'sea bass', 'whitebait', 'bottarga', 'caviar',
    'caviale', 'roe', 'ikura', 'sashimi', 'nigiri',
    // asiatico: quasi tutte le salse di pesce sono invisibili a chi legge
    'ikan billis', 'ikan bilis', 'nam pla', 'fish sauce', 'dashi', 'bonito', 'katsuobushi', 'worcestershire',
  ],
  crostacei: [
    'gamber', 'gambas', 'prawn', 'shrimp', 'langostino', 'scampi', 'lobster', 'langosta', 'astice',
    'crab', 'cangrejo', 'granchio', 'crayfish', 'aragosta', 'marisco', 'krill',
    'sambal', 'belacan', 'terasi', 'shrimp paste', 'tom yum', 'har gow', 'laksa',
  ],
  molluschi: [
    'cozze', 'mejillones', 'mussel', 'vongole', 'almejas', 'clam', 'calamar', 'squid', 'polpo', 'pulpo',
    'octopus', 'seppia', 'sepia', 'cuttlefish', 'capesante', 'scallop', 'vieiras', 'oyster', 'ostra',
    'ostriche', 'abalone', 'snail', 'lumache', 'escargot', 'oyster sauce', 'xo sauce', 'nero di seppia',
  ],
  'frutta a guscio': [
    'noci', 'noce', 'nueces', 'walnut', 'nocciol', 'avellana', 'hazelnut', 'mandorl', 'almendra', 'almond',
    'pistacch', 'pistacho', 'pistachio', 'anacardi', 'cashew', 'pinoli', 'pinones', 'pine nut', 'pecan',
    'macadamia', 'brazil nut', 'praline', 'nutella', 'marzipan', 'marzapane', 'frangipane', 'pesto',
    'baklava', 'halva', 'gianduia',
  ],
  arachidi: [
    'arachidi', 'cacahuete', 'peanut', 'satay', 'sate', 'massaman', 'panang', 'penang', 'gado gado',
    'kung pao', 'groundnut',
  ],
  soia: [
    'soia', 'soja', 'soy', 'tofu', 'edamame', 'miso', 'tempeh', 'teriyaki', 'hoisin', 'ponzu', 'tamari',
    'yakitori', 'natto', 'shoyu', 'bean curd',
  ],
  sesamo: [
    'sesamo', 'sesame', 'tahini', 'tahina', 'hummus', 'houmous', 'gomashio', 'za atar', 'zaatar', 'halva',
    'baba ganoush', 'falafel', 'furikake', 'sesame oil',
  ],
  sedano: ['sedano', 'apio', 'celery', 'celeriac', 'sedano rapa', 'mirepoix', 'soffritto'],
  senape: ['senape', 'mostaza', 'mustard', 'dijon', 'wholegrain mustard', 'honey mustard'],
  solfiti: ['solfiti', 'sulphite', 'sulfite', 'vino', 'wine', 'vinagre', 'vinegar', 'aceto', 'balsamic', 'prosecco', 'sherry', 'marsala'],
  lupini: ['lupin', 'altramuz', 'lupini'],
  lattosio: [
    'formaggi', 'queso', 'cheese', 'mozzarella', 'ricotta', 'burrata', 'mascarpone', 'panna', 'nata',
    'cream', 'crema', 'latte', 'leche', 'milk', 'butter', 'burro', 'yogurt', 'gelato', 'ice cream',
    'helado', 'bechamel', 'besciamella', 'ghee', 'paneer', 'lassi',
  ],
};

// Due cucine intere in cui l'allergene sta nel wok o nel sugo prima che nel
// piatto, e quindi non e' scritto da nessuna parte: gli anacardi nelle gravy
// indiane, il sesamo e le arachidi in quelle del sud-est asiatico. Su questi
// piatti non ci si sbilancia mai.
const CUCINA_ASIATICA = [
  'asian', 'chinese', 'japanese', 'korean', 'thai', 'vietnamese', 'malaysian', 'indonesian',
  'wok', 'stir fry', 'stir-fried', 'noodle', 'dumpling', 'dim sim', 'dim sum', 'bao', 'gyoza',
  'sushi', 'ramen', 'udon', 'pad ', 'tom yum', 'tom kha', 'laksa', 'nasi', 'mee ', 'satay',
  'dipping', 'spring roll', 'fried rice', 'teriyaki', 'katsu', 'tempura', 'pho ', 'som tum',
  'rendang', 'gado', 'curry', 'sambal', 'yum ', 'larb', 'laab',
];
const CUCINA_INDIANA = [
  'curry', 'masala', 'tikka', 'korma', 'makhani', 'bhuna', 'biryani', 'tandoor', 'naan',
  'dal', 'daal', 'chaat', 'samosa', 'pakora', 'saag', 'palak', 'gravy', 'seekh', 'kebab',
  'paratha', 'kulcha', 'raita', 'chutney', 'bombay', 'punjabi', 'madras', 'vindaloo',
];

// Parole che NON nominano l'allergene ma rendono il piatto ingiudicabile dal
// testo: una frittura divide l'olio con le panature, un misto di mare cambia
// ogni giorno, una salsa "della casa" non si sa cosa contenga. Su questi non
// ci si sbilancia: non finiscono fra i consigliati e non vengono nemmeno
// dichiarati a rischio, semplicemente si tacciono.
const RISCHIO_ALLERGENE: Record<string, string[]> = {
  glutine: [
    'fritt', 'frito', 'fritura', 'fried', 'crispy', 'crunchy', 'croccante', 'crocante', 'tempura',
    'batter', 'crumb', 'panko', 'gravy', 'roux', 'salsa de la casa', 'house sauce', 'marinade',
    'marinata', 'thickened', 'stir fry', 'stir-fried', 'dusted',
  ],
  crostacei: [
    'fritt', 'fried', 'fries', 'deep fried', 'frittura', 'seafood', 'frutti di mare', 'mariscos', 'misto di mare', 'paella', 'laksa', 'tom yum',
    'bouillabaisse', 'zuppa di pesce', 'sopa de marisco', 'mixed grill', 'fried rice', 'stir fry',
    'stir-fried', 'nasi goreng', 'pad thai', 'curry',
    'thai', 'asian', 'wok', 'som tum', 'dipping', 'nam jim', 'tom kha', 'mee ', 'satay',
    ...CUCINA_ASIATICA,
  ],
  molluschi: ['fritt', 'fried', 'fries', 'deep fried', 'seafood', 'frutti di mare', 'mariscos', 'paella', 'misto di mare', 'fried rice', 'stir fry'],
  pesce: ['fritt', 'fried', 'fries', 'deep fried', 'caesar', 'worcestershire', 'curry', 'stir fry', 'stir-fried', 'nasi goreng', 'pad thai', 'kimchi',
    'thai', 'asian', 'wok', 'som tum', 'dipping', 'nam jim', 'tom yum', 'tom kha', 'laksa', 'mee ', 'satay',
    ...CUCINA_ASIATICA,
  ],
  // Il ghee e la panna nei curry indiani non li scrive nessuno: sotto
  // latte, su un curry non ci si sbilancia.
  latte: ['fritt', 'fried', 'gratin', 'gratinat', 'creamy', 'cremoso', 'mashed', 'sauteed', 'saltato',
    'curry', 'masala', 'korma', 'tikka', 'makhani', 'bhuna', 'biryani', 'naan', 'kulcha', 'paratha',
    'saag', 'palak', 'gravy', 'tandoor', 'mezze', 'dessert', 'dolce', 'postre'],
  // Il ghee e la panna nei curry indiani non li scrive nessuno: sotto
  // lattosio, su un curry non ci si sbilancia.
  lattosio: ['fritt', 'fried', 'gratin', 'gratinat', 'creamy', 'cremoso', 'mashed', 'sauteed', 'saltato',
    'curry', 'masala', 'korma', 'tikka', 'makhani', 'bhuna', 'biryani', 'naan', 'kulcha', 'paratha',
    'saag', 'palak', 'gravy', 'tandoor', 'mezze', 'dessert', 'dolce', 'postre'],
  uova: ['fritt', 'fried', 'batter', 'pasta fresca', 'fresh pasta', 'house made pasta', 'dressing', 'glazed'],
  soia: ['stir fry', 'stir-fried', 'marinade', 'marinata', 'glaze', 'dressing', 'asian sauce', 'curry',
    'asian', 'chinese', 'japanese', 'korean', 'wok', 'noodle', 'dumpling', 'sushi', 'bao', 'ramen',
    'katsu', 'dipping', 'fried rice',
    ...CUCINA_ASIATICA,
  ],
  sesamo: ['burger', 'bun', 'brioche', 'dressing', 'stir fry', 'stir-fried', 'asian sauce', 'crusted', 'asian', 'chinese',
    'japanese', 'korean', 'wok', 'noodle', 'dumpling', 'gyoza', 'sushi', 'bao', 'tempura', 'katsu',
    'bibimbap', 'banchan', 'falafel', 'mezze', 'dipping',
    ...CUCINA_ASIATICA, ...CUCINA_INDIANA, 'mezze', 'falafel', 'shawarma',
  ],
  // I dolci sono il posto dove la frutta a guscio si nasconde di piu' senza
  // essere scritta: il "Pan di Stelle" e' "crema e cacao" sul menu e nocciole
  // nel barattolo. Sui dolci, a chi e' allergico alla frutta a guscio, non ci
  // si sbilancia.
  'frutta a guscio': ['dessert', 'postre', 'dolce', 'dolci', 'galleta', 'biscuit', 'biscotto', 'cake',
    'torta', 'crema', 'gelato', 'semifreddo', 'granola', 'muesli', 'crusted', 'pesto', 'house dessert',
    ...CUCINA_ASIATICA, ...CUCINA_INDIANA,
  ],
  // In una cucina thai o indonesiana l'arachide e' nel wok prima che nel
  // piatto: Larb e Tom Yum non la scrivono e la incontrano lo stesso.
  arachidi: ['stir fry', 'stir-fried', 'curry', 'dressing', 'asian sauce', 'thai', 'wok', 'pad ',
    'tom yum', 'tom kha', 'larb', 'laab', 'som tum', 'rendang', 'gado', 'nasi', 'mee ', 'laksa',
    'satay', 'dipping', 'spring roll', 'fried rice', 'noodle', 'massaman', 'panang',
    ...CUCINA_ASIATICA, ...CUCINA_INDIANA,
  ],
  sedano: ['brodo', 'broth', 'stock', 'zuppa', 'soup', 'sopa', 'ragu', 'bolognese', 'stew', 'casserole', 'gravy', 'soffritto'],
  senape: ['dressing', 'vinaigrette', 'salsa della casa', 'house sauce', 'glaze', 'marinade', 'pickle'],
  solfiti: ['dried', 'secchi', 'deshidratad', 'pickle', 'sott aceto', 'conserva'],
  lupini: [],
};

// ── Bevande ─────────────────────────────────────────────────────────────────
// A chi chiede cosa puo' mangiare non si consiglia l'acqua. Sembra ovvio, ma
// una carta dei vini vera non dice mai "vino": da China Doll le categorie si
// chiamano "BIG & BOLD WHITES", "LIGHT & FRESH REDS", "ROSE", "SPARKLING &
// CHAMPAGNE", "SAKE BY THE GLASS". Nessuna conteneva la parola "wine", e a
// un'allergica al sesamo sono stati consigliati un Riesling e un sidro.
const CATEGORIA_BEVANDA = /vin|wine|wein|bevand|drink|beverage|cocktail|birr|beer|bier|cerveza|spirit|liquor|amaro|bebida|coffee|caffe|\btea\b|juice|soda|water|acqua|agua|mocktail|aperitiv|digestiv|gin|vodka|whisk|rum|bar|whites|reds|sparkling|champagne|prosecco|cider|sidro|sake|by the glass|bottle|cellar|vermouth|spritz|sangria|on tap|shots|smoothie|milkshake|infusion|tisan|chai/i;

// Categorie che sono una bevanda solo quando sono TUTTA la categoria: "ROSE"
// e' il rosato, ma "rose harissa" e' una salsa; "RED" e' il rosso, ma "red
// curry" e' un piatto. Qui si confronta la categoria intera, non un pezzo.
const CATEGORIA_BEVANDA_ESATTA = new Set([
  'red', 'reds', 'white', 'whites', 'rose', 'rosado', 'rosato', 'bubbles', 'bollicine',
  'sake', 'cider', 'beer', 'wine', 'wines', 'drinks', 'cocktails', 'aperitivi', 'digestivi',
  'orange skin contact', 'no alcohol', 'soft', 'softs',
]);

// Un vino si riconosce anche dal nome: l'annata davanti ("24 Mezzo Pinot
// Grigio") o "NV" per i non millesimati.
const NOME_DI_VINO = /^(nv|mv|\d{2}|\d{4})\s/i;

function eUnaBevanda(p: { name: string; category: string }): boolean {
  const cat = (p.category || '').trim();
  if (CATEGORIA_BEVANDA.test(cat)) return true;
  if (CATEGORIA_BEVANDA_ESATTA.has(normalizza(cat))) return true;
  return NOME_DI_VINO.test((p.name || '').trim());
}

/**
 * Quanto quell'allergene e' diffuso in QUESTA cucina.
 *
 * Il conto per piatto non basta: da Masala Theory i latticini compaiono in 26
 * piatti su 60, e il ghee nei curry non lo scrive nessuno. Dire "questi otto
 * non lo nominano" in una cucina cosi' e' fuorviante. Sopra la soglia non si
 * propone niente e si manda al personale, che e' la verita'.
 */
const SOGLIA_PERVASIVO = 0.2;

// ── E quanto quell'allergene e' dentro QUEL MODO DI CUCINARE ────────────────
//
// Contare i piatti non basta. Provando sui menu veri, a chi e' allergico alle
// arachidi venivano proposti "Nam Tok" e "Po Taek" da un thailandese, e a chi
// e' allergico alla frutta a guscio "Butter Chicken" da un indiano: piatti
// che l'allergene non lo scrivono e lo incrociano ogni giorno, perche' il
// wok e la gravy sono gli stessi per tutto il menu.
//
// I nomi dei piatti etnici sono infiniti e non si possono elencare. Si
// riconosce invece la CUCINA, dal menu stesso: se una fetta del menu porta i
// segni di quel modo di cucinare, per gli allergeni che ci vivono dentro non
// si propone niente e si manda al personale. E' la stessa cosa che direbbe
// una persona ragionevole: in un thailandese, quali piatti sono senza
// arachidi lo sa solo la cucina.
const SEGNI_DI_CUCINA: Record<string, string[]> = {
  asiatica: CUCINA_ASIATICA,
  indiana: CUCINA_INDIANA,
  mediorientale: ['hummus', 'houmous', 'falafel', 'shawarma', 'kebab', 'tabbouleh', 'tabouli', 'baba ganoush',
    'mezze', 'halloumi', 'labneh', 'kibbeh', 'fattoush', 'manakish', 'za atar', 'zaatar', 'shish', 'pita',
    'baklava', 'tahini', 'tahina', 'sumac', 'harissa'],
};
const ALLERGENI_NELLA_CUCINA: Record<string, string[]> = {
  // Il glutine c'e' perche' la salsa di soia e' fatta col grano: in un wok
  // ci finisce quasi tutto, e un celiaco non lo legge da nessuna parte.
  asiatica: ['arachidi', 'frutta a guscio', 'sesamo', 'soia', 'pesce', 'crostacei', 'molluschi', 'glutine'],
  indiana: ['frutta a guscio', 'latte', 'lattosio', 'sesamo', 'senape', 'arachidi'],
  // Bulgur, pita e kibbeh: il grano e' dappertutto, il sesamo pure (tahini).
  mediorientale: ['sesamo', 'frutta a guscio', 'latte', 'lattosio', 'glutine'],
};
const SOGLIA_CUCINA = 0.15;

/** La cucina di questo menu, riconosciuta dal menu stesso. */
function cucineDelMenu(piatti: Array<{ name: string; description?: string | null }>): string[] {
  if (piatti.length < 8) return [];
  const testi = piatti.map(p => normalizza(`${p.name} ${p.description || ''}`));
  return Object.entries(SEGNI_DI_CUCINA)
    .filter(([, segni]) => {
      const quanti = testi.filter(t => segni.some(w => t.includes(normalizza(w)))).length;
      return quanti / testi.length > SOGLIA_CUCINA;
    })
    .map(([nome]) => nome);
}

// Pesce, crostacei e molluschi escono dalla stessa cucina e spesso dallo
// stesso piatto. Un "Risotto Profumo di Mare" che nomina vongole e calamari
// non si consiglia a chi e' allergico ai crostacei: formalmente sono
// molluschi, ma il rischio e' lo stesso e il cliente non fa quella distinzione.
const PARENTI_DI_MARE: Record<string, string[]> = {
  crostacei: ['molluschi', 'pesce'],
  molluschi: ['crostacei', 'pesce'],
  pesce: ['crostacei', 'molluschi'],
};

/**
 * La parola con cui il menu nomina quell'allergene, o null.
 * Si restituisce la PAROLA e non solo un si'/no perche' la risposta la cita:
 * dire "il ristorante ha scritto picatostes" e' un'informazione verificabile,
 * dire "ha scritto glutine" sarebbe falso, quella parola non c'e' scritta.
 */
export function parolaAllergene(testoPiatto: string, allergene: string): string | null {
  const t = normalizza(testoPiatto);
  return (INGREDIENTI_ALLERGENE[allergene] ?? []).find(w => t.includes(normalizza(w))) ?? null;
}

/** Il testo del piatto nomina quell'allergene. */
export function nominaAllergene(testoPiatto: string, allergene: string): boolean {
  return parolaAllergene(testoPiatto, allergene) !== null;
}

/** Il testo non lo nomina, ma nemmeno permette di escluderlo (fritture, misti, salse della casa). */
export function nonGiudicabilePer(testoPiatto: string, allergene: string): boolean {
  const t = ' ' + normalizza(testoPiatto) + ' ';
  // Le parole corte come parola intera: "dal" (lenticchie) dentro "dalla"
  // farebbe scartare mezzo menu italiano.
  const dentro = (w: string) => {
    const n = normalizza(w);
    return n.length <= 4 ? t.includes(' ' + n + ' ') : t.includes(n);
  };
  if ((RISCHIO_ALLERGENE[allergene] ?? []).some(dentro)) return true;
  // Un piatto di mare non si consiglia a nessun allergico al mare.
  return (PARENTI_DI_MARE[allergene] ?? []).some(p => nominaAllergene(testoPiatto, p));
}

/**
 * I piatti da proporre a chi ha detto di essere allergico a qualcosa.
 *
 * Tre filtri, tutti nella stessa direzione: si consiglia SOLO cio' che il
 * menu permette davvero di leggere.
 *  1. niente bevande;
 *  2. niente piatti senza descrizione: del solo nome non sappiamo nulla,
 *     e un consiglio basato sul nulla non vale niente;
 *  3. fuori chi nomina l'allergene e fuori chi non e' giudicabile.
 *
 * Resta un consiglio, non una garanzia: la frase che lo accompagna lo dice,
 * e manda comunque al cameriere.
 */
export function piattiSenzaAllergeni<T extends { name: string; description?: string | null; category: string }>(
  piatti: T[], allergeni: string[], quanti = 8,
): { consigliati: T[]; scartati: number; nonLeggibili: number; pervasivo: boolean } {
  const cibo = piatti.filter(p => !eUnaBevanda(p));

  // Prima ancora: che cucina e' questa? Se l'allergene e' di casa in quel modo
  // di cucinare, non si propone niente, qualunque cosa dicano i singoli piatti.
  const cucine = cucineDelMenu(cibo);
  if (cucine.some(c => allergeni.some(a => (ALLERGENI_NELLA_CUCINA[c] ?? []).includes(a)))) {
    return { consigliati: [], scartati: 0, nonLeggibili: 0, pervasivo: true };
  }

  // Poi: quanto e' diffuso l'allergene in questa cucina. Se lo
  // nomina piu' di un piatto su cinque, vuol dire che in quella cucina lo si
  // usa tutti i giorni, e i piatti che non lo nominano lo incrociano lo
  // stesso. Li' non si propone niente.
  const leggibili = cibo.filter(p => (p.description || '').trim().length >= 15);
  const quantiLoNominano = leggibili.filter(p =>
    allergeni.some(a => nominaAllergene(`${p.name} ${p.description || ''}`, a))).length;
  const pervasivo = leggibili.length >= 10 && quantiLoNominano / leggibili.length > SOGLIA_PERVASIVO;
  if (pervasivo) return { consigliati: [], scartati: quantiLoNominano, nonLeggibili: 0, pervasivo: true };

  let scartati = 0, nonLeggibili = 0;
  const buoni: T[] = [];
  for (const p of cibo) {
    const descrizione = (p.description || '').trim();
    if (descrizione.length < 15) { nonLeggibili++; continue; }
    const testo = `${p.name} ${descrizione}`;
    if (allergeni.some(a => nominaAllergene(testo, a))) { scartati++; continue; }
    if (allergeni.some(a => nonGiudicabilePer(testo, a))) { nonLeggibili++; continue; }
    buoni.push(p);
  }
  // Uno per categoria prima di ripetere: l'elenco deve somigliare a un pasto,
  // non a sei pizze di fila.
  const perCategoria = new Map<string, T[]>();
  for (const p of buoni) {
    const c = (p.category || '').trim() || 'menu';
    if (!perCategoria.has(c)) perCategoria.set(c, []);
    perCategoria.get(c)!.push(p);
  }
  const consigliati: T[] = [];
  let giro = 0;
  while (consigliati.length < quanti) {
    let aggiunto = false;
    for (const elenco of perCategoria.values()) {
      if (giro < elenco.length && consigliati.length < quanti) { consigliati.push(elenco[giro]); aggiunto = true; }
    }
    if (!aggiunto) break;
    giro++;
  }
  return { consigliati, scartati, nonLeggibili, pervasivo: false };
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

/**
 * Proporre piatti leggendo il TESTO del menu quando gli allergeni non sono
 * registrati. Acceso, ma solo dopo che la prova su dieci menu veri di cucine
 * diverse ha smesso di produrre consigli sbagliati. Cosa era uscito:
 *
 *  1. le carte dei vini non venivano riconosciute come bevande (a China Doll
 *     le categorie si chiamano "BIG & BOLD WHITES" e "SAKE BY THE GLASS"): a
 *     un'allergica al sesamo sono stati consigliati un Riesling e un sidro;
 *  2. mancava la misura di quanto l'allergene fosse diffuso in QUEL menu (da
 *     Masala Theory i latticini sono in 26 piatti su 60);
 *  3. e soprattutto mancava la cucina: i nomi dei piatti etnici sono infiniti
 *     e non si possono elencare, ma il wok e la gravy sono gli stessi per
 *     tutto il menu. In un thailandese quali piatti non hanno arachidi lo sa
 *     solo la cucina, e adesso e' quello che l'assistente risponde.
 *
 * Chi la tocca la riprovi su piu' menu di cucine diverse: questa funzione era
 * stata scritta su un menu solo, ed e' bastato quello per non vedere niente.
 * Lo script della prova vive in prova-logica.ts (sezioni 11-14).
 */
const CONSIGLIA_DA_TESTO = true;

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
/**
 * Il messaggio parla DAVVERO di un'allergia.
 *
 * Serve perche' "pesce", "uova", "latte", "nut" sono parole di allergeni ma
 * anche di cibo: "Avete del pesce?" e "Do you have milk for the coffee?" si
 * sentivano rispondere "questi piatti non nominano pesce". Dieci domande
 * normali su ventisei finivano li'. Da sole quelle parole non bastano piu':
 * ci vuole un segno di allergia, intolleranza o "senza".
 */
export const CONTESTO_ALLERGIA = /allerg|intolleran|intoleran|celiac|coeliac|zoliakie|unvertraglich|senza|\bsin\b|\bsans\b|\bohne\b|\bsem\b|without|\bfree\b(?! range)|tanpa|без|不含|过敏|アレルギ|알레르기|بدون|حساسية|बिना|एलर्जी|non posso mangiare|no puedo comer|cannot eat|can t eat|evitare|avoid/;

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
  /** "Sono allergico ai crostacei": i piatti che dal menu non li nominano. */
  consiglioSenza: (allergeni: string, piatti: string, nonLeggibili: number) => string;
  /** Nessun piatto consigliabile con sicurezza. */
  nessunoSenza: (allergeni: string) => string;
  /** Il testo del piatto nomina proprio l'allergene del cliente: si avvisa. */
  piattoNomina: (piatto: string, allergene: string) => string;
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
    consiglioSenza: (a, p, altri) => `Sul menu questi piatti non nominano ${a} fra gli ingredienti scritti:\n${p}\n${altri > 0 ? `Su altri ${altri} piatti il menu non dice abbastanza per poterlo dire.\n` : ''}Non \u00e8 una garanzia: il menu non \u00e8 una ricetta e in cucina si usano gli stessi fornelli.\nDillo al cameriere prima di ordinare: la conferma la d\u00e0 sempre la cucina.`,
    nessunoSenza: a => `Sul menu non trovo piatti da consigliarti con sicurezza senza ${a}.\nChiedi al cameriere prima di ordinare: la cucina sa cosa pu\u00f2 prepararti.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Attenzione: nella descrizione di **${pi}** il ristorante ha scritto ${a}.\nGli allergeni non sono registrati, quindi prima di ordinare fatti confermare dalla cucina.`,
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
    consiglioSenza: (a, p, altri) => `On the menu these dishes do not mention ${a} among the ingredients written:\n${p}\n${altri > 0 ? `For ${altri} other dishes the menu doesn\u2019t say enough for me to tell.\n` : ''}This is not a guarantee: a menu is not a recipe, and the kitchen shares pans and fryers.\nTell your waiter before ordering: the kitchen always confirms.`,
    nessunoSenza: a => `On the menu I can\u2019t find dishes I\u2019d confidently suggest without ${a}.\nPlease ask your waiter before ordering: the kitchen knows what they can prepare for you.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Careful: in the description of **${pi}** the restaurant wrote ${a}.\nAllergens are not registered here, so have the kitchen confirm before you order.`,
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
    consiglioSenza: (a, p, altri) => `Auf der Karte nennen diese Gerichte ${a} nicht unter den angegebenen Zutaten:\n${p}\n${altri > 0 ? `Bei ${altri} weiteren Gerichten sagt die Karte zu wenig, um es beurteilen zu k\u00f6nnen.\n` : ''}Das ist keine Garantie: eine Speisekarte ist kein Rezept, und in der K\u00fcche werden dieselben Pfannen benutzt.\nSagen Sie es vor der Bestellung der Bedienung: die K\u00fcche best\u00e4tigt es immer.`,
    nessunoSenza: a => `Auf der Karte finde ich keine Gerichte, die ich Ihnen ohne ${a} sicher empfehlen k\u00f6nnte.\nFragen Sie bitte vor der Bestellung die Bedienung: die K\u00fcche wei\u00df, was sie f\u00fcr Sie zubereiten kann.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Achtung: in der Beschreibung von **${pi}** hat das Restaurant ${a} genannt.\nAllergene sind nicht eingetragen, lassen Sie es sich vor der Bestellung von der K\u00fcche best\u00e4tigen.`,
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
    consiglioSenza: (a, p, altri) => `En la carta estos platos no mencionan ${a} entre los ingredientes escritos:\n${p}\n${altri > 0 ? `De otros ${altri} platos la carta no dice lo suficiente para poder decirlo.\n` : ''}No es una garant\u00eda: la carta no es una receta y en la cocina se comparten sartenes y freidoras.\nD\u00edselo al camarero antes de pedir: la cocina siempre lo confirma.`,
    nessunoSenza: a => `En la carta no encuentro platos que pueda recomendarte con seguridad sin ${a}.\nPreg\u00fantale al camarero antes de pedir: la cocina sabe qu\u00e9 puede prepararte.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Atenci\u00f3n: en la descripci\u00f3n de **${pi}** el restaurante ha escrito ${a}.\nLos al\u00e9rgenos no est\u00e1n registrados, as\u00ed que pide confirmaci\u00f3n a la cocina antes de pedir.`,
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
    consiglioSenza: (a, p, altri) => `Sur la carte, ces plats ne mentionnent pas ${a} parmi les ingr\u00e9dients \u00e9crits :\n${p}\n${altri > 0 ? `Pour ${altri} autres plats, la carte n\u2019en dit pas assez pour que je puisse le dire.\n` : ''}Ce n\u2019est pas une garantie : une carte n\u2019est pas une recette, et la cuisine partage po\u00eales et friteuses.\nDites-le au serveur avant de commander : la cuisine confirme toujours.`,
    nessunoSenza: a => `Sur la carte, je ne trouve pas de plats \u00e0 vous conseiller avec certitude sans ${a}.\nDemandez au serveur avant de commander : la cuisine sait ce qu\u2019elle peut vous pr\u00e9parer.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Attention : dans la description de **${pi}**, le restaurant a \u00e9crit ${a}.\nLes allerg\u00e8nes ne sont pas enregistr\u00e9s, faites confirmer par la cuisine avant de commander.`,
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
    consiglioSenza: (a, p, altri) => `Na ementa estes pratos n\u00e3o mencionam ${a} entre os ingredientes escritos:\n${p}\n${altri > 0 ? `De outros ${altri} pratos a ementa n\u00e3o diz o suficiente para eu poder dizer.\n` : ''}N\u00e3o \u00e9 uma garantia: a ementa n\u00e3o \u00e9 uma receita e na cozinha partilham-se as mesmas frigideiras.\nDiga ao empregado antes de pedir: a cozinha confirma sempre.`,
    nessunoSenza: a => `Na ementa n\u00e3o encontro pratos que lhe possa recomendar com seguran\u00e7a sem ${a}.\nPergunte ao empregado antes de pedir: a cozinha sabe o que lhe pode preparar.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Aten\u00e7\u00e3o: na descri\u00e7\u00e3o de **${pi}** o restaurante escreveu ${a}.\nOs alerg\u00e9nios n\u00e3o est\u00e3o registados, pe\u00e7a confirma\u00e7\u00e3o \u00e0 cozinha antes de pedir.`,
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
    consiglioSenza: (a, p, altri) => `\u0412 \u043c\u0435\u043d\u044e \u044d\u0442\u0438 \u0431\u043b\u044e\u0434\u0430 \u043d\u0435 \u0443\u043f\u043e\u043c\u0438\u043d\u0430\u044e\u0442 ${a} \u0441\u0440\u0435\u0434\u0438 \u0443\u043a\u0430\u0437\u0430\u043d\u043d\u044b\u0445 \u0438\u043d\u0433\u0440\u0435\u0434\u0438\u0435\u043d\u0442\u043e\u0432:\n${p}\n${altri > 0 ? `\u041f\u0440\u043e \u0435\u0449\u0451 ${altri} \u0431\u043b\u044e\u0434 \u043c\u0435\u043d\u044e \u0433\u043e\u0432\u043e\u0440\u0438\u0442 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043c\u0430\u043b\u043e, \u0447\u0442\u043e\u0431\u044b \u0441\u0443\u0434\u0438\u0442\u044c.\n` : ''}\u042d\u0442\u043e \u043d\u0435 \u0433\u0430\u0440\u0430\u043d\u0442\u0438\u044f: \u043c\u0435\u043d\u044e \u2014 \u043d\u0435 \u0440\u0435\u0446\u0435\u043f\u0442, \u0430 \u043d\u0430 \u043a\u0443\u0445\u043d\u0435 \u043e\u0434\u043d\u0438 \u0438 \u0442\u0435 \u0436\u0435 \u0441\u043a\u043e\u0432\u043e\u0440\u043e\u0434\u044b.\n\u0421\u043a\u0430\u0436\u0438\u0442\u0435 \u043e\u0444\u0438\u0446\u0438\u0430\u043d\u0442\u0443 \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u043a\u0430\u0437\u043e\u043c: \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0442 \u043a\u0443\u0445\u043d\u044f.`,
    nessunoSenza: a => `\u0412 \u043c\u0435\u043d\u044e \u043d\u0435\u0442 \u0431\u043b\u044e\u0434, \u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u044f \u043c\u043e\u0433 \u0431\u044b \u0443\u0432\u0435\u0440\u0435\u043d\u043d\u043e \u043f\u043e\u0441\u043e\u0432\u0435\u0442\u043e\u0432\u0430\u0442\u044c \u0431\u0435\u0437 ${a}.\n\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u0435 \u043e\u0444\u0438\u0446\u0438\u0430\u043d\u0442\u0430 \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u043a\u0430\u0437\u043e\u043c: \u043a\u0443\u0445\u043d\u044f \u0437\u043d\u0430\u0435\u0442, \u0447\u0442\u043e \u043c\u043e\u0436\u0435\u0442 \u043f\u0440\u0438\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F \u0412\u043d\u0438\u043c\u0430\u043d\u0438\u0435: \u0432 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0438 **${pi}** \u0440\u0435\u0441\u0442\u043e\u0440\u0430\u043d \u0443\u043a\u0430\u0437\u0430\u043b ${a}.\n\u0410\u043b\u043b\u0435\u0440\u0433\u0435\u043d\u044b \u0437\u0434\u0435\u0441\u044c \u043d\u0435 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u044b, \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u043a\u0430\u0437\u043e\u043c \u0443\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u043d\u0430 \u043a\u0443\u0445\u043d\u0435.`,
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
    consiglioSenza: (a, p, altri) => `\u83dc\u5355\u4e0a\u4ee5\u4e0b\u83dc\u54c1\u7684\u914d\u6599\u4e2d\u6ca1\u6709\u5199\u5230${a}\uff1a\n${p}\n${altri > 0 ? `\u53e6\u6709 ${altri} \u9053\u83dc\u7684\u63cf\u8ff0\u4e0d\u591f\u8be6\u7ec6\uff0c\u6211\u65e0\u6cd5\u5224\u65ad\u3002\n` : ''}\u8fd9\u5e76\u975e\u4fdd\u8bc1\uff1a\u83dc\u5355\u4e0d\u662f\u914d\u65b9\uff0c\u53a8\u623f\u4e5f\u5171\u7528\u9505\u5177\u3002\n\u70b9\u83dc\u524d\u8bf7\u544a\u77e5\u670d\u52a1\u5458\uff0c\u6700\u7ec8\u7531\u53a8\u623f\u786e\u8ba4\u3002`,
    nessunoSenza: a => `\u83dc\u5355\u4e0a\u6ca1\u6709\u6211\u80fd\u653e\u5fc3\u63a8\u8350\u7684\u4e0d\u542b${a}\u7684\u83dc\u54c1\u3002\n\u70b9\u83dc\u524d\u8bf7\u8be2\u95ee\u670d\u52a1\u5458\uff0c\u53a8\u623f\u77e5\u9053\u80fd\u4e3a\u60a8\u505a\u4ec0\u4e48\u3002`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F \u8bf7\u6ce8\u610f\uff1a**${pi}** \u7684\u63cf\u8ff0\u4e2d\u5199\u6709${a}\u3002\n\u672c\u5e97\u672a\u767b\u8bb0\u8fc7\u654f\u539f\uff0c\u70b9\u83dc\u524d\u8bf7\u8ba9\u53a8\u623f\u786e\u8ba4\u3002`,
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
    consiglioSenza: (a, p, altri) => `\u30e1\u30cb\u30e5\u30fc\u306b\u66f8\u304b\u308c\u305f\u6750\u6599\u306b${a}\u304c\u306a\u3044\u6599\u7406\u306f\u3053\u3061\u3089\u3067\u3059\uff1a\n${p}\n${altri > 0 ? `\u307b\u304b\u306e${altri}\u54c1\u306f\u8aac\u660e\u304c\u77ed\u304f\u3001\u5224\u65ad\u3067\u304d\u307e\u305b\u3093\u3002\n` : ''}\u4fdd\u8a3c\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u30e1\u30cb\u30e5\u30fc\u306f\u30ec\u30b7\u30d4\u3067\u306f\u306a\u304f\u3001\u53a8\u623f\u3067\u306f\u540c\u3058\u934b\u3092\u4f7f\u3044\u307e\u3059\u3002\n\u3054\u6ce8\u6587\u524d\u306b\u30b9\u30bf\u30c3\u30d5\u306b\u304a\u4f1d\u3048\u304f\u3060\u3055\u3044\u3002\u6700\u7d42\u78ba\u8a8d\u306f\u53a8\u623f\u304c\u884c\u3044\u307e\u3059\u3002`,
    nessunoSenza: a => `${a}\u3092\u9664\u3044\u305f\u6599\u7406\u3092\u3001\u30e1\u30cb\u30e5\u30fc\u304b\u3089\u78ba\u4fe1\u3092\u3082\u3063\u3066\u304a\u3059\u3059\u3081\u3059\u308b\u3053\u3068\u304c\u3067\u304d\u307e\u305b\u3093\u3002\n\u3054\u6ce8\u6587\u524d\u306b\u30b9\u30bf\u30c3\u30d5\u306b\u304a\u5c0b\u306d\u304f\u3060\u3055\u3044\u3002\u53a8\u623f\u304c\u5bfe\u5fdc\u3092\u628a\u63e1\u3057\u3066\u3044\u307e\u3059\u3002`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F \u3054\u6ce8\u610f\u304f\u3060\u3055\u3044\uff1a**${pi}** \u306e\u8aac\u660e\u306b${a}\u3068\u66f8\u304b\u308c\u3066\u3044\u307e\u3059\u3002\n\u30a2\u30ec\u30eb\u30ae\u30fc\u60c5\u5831\u306f\u672a\u767b\u9332\u306a\u306e\u3067\u3001\u3054\u6ce8\u6587\u524d\u306b\u53a8\u623f\u306b\u3054\u78ba\u8a8d\u304f\u3060\u3055\u3044\u3002`,
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
    consiglioSenza: (a, p, altri) => `\u0641\u064a \u0627\u0644\u0642\u0627\u0626\u0645\u0629\u060c \u0647\u0630\u0647 \u0627\u0644\u0623\u0637\u0628\u0627\u0642 \u0644\u0627 \u062a\u0630\u0643\u0631 ${a} \u0636\u0645\u0646 \u0627\u0644\u0645\u0643\u0648\u0651\u0646\u0627\u062a \u0627\u0644\u0645\u0643\u062a\u0648\u0628\u0629:\n${p}\n${altri > 0 ? `\u0648\u0647\u0646\u0627\u0643 ${altri} \u0623\u0637\u0628\u0627\u0642 \u0623\u062e\u0631\u0649 \u0644\u0627 \u062a\u0643\u0641\u064a \u0623\u0648\u0635\u0627\u0641\u0647\u0627 \u0644\u0644\u062d\u0643\u0645 \u0639\u0644\u064a\u0647\u0627.\n` : ''}\u0647\u0630\u0627 \u0644\u064a\u0633 \u0636\u0645\u0627\u0646\u064b\u0627: \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0644\u064a\u0633\u062a \u0648\u0635\u0641\u0629\u060c \u0648\u0627\u0644\u0645\u0637\u0628\u062e \u064a\u0633\u062a\u062e\u062f\u0645 \u0646\u0641\u0633 \u0627\u0644\u0623\u0648\u0627\u0646\u064a.\n\u0623\u062e\u0628\u0631 \u0627\u0644\u0646\u0627\u062f\u0644 \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628: \u0627\u0644\u0645\u0637\u0628\u062e \u0647\u0648 \u0645\u0646 \u064a\u0624\u0643\u0651\u062f \u062f\u0627\u0626\u0645\u064b\u0627.`,
    nessunoSenza: a => `\u0644\u0627 \u0623\u062c\u062f \u0641\u064a \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0623\u0637\u0628\u0627\u0642\u064b\u0627 \u0623\u0646\u0635\u062d \u0628\u0647\u0627 \u0628\u062b\u0642\u0629 \u062e\u0627\u0644\u064a\u0629 \u0645\u0646 ${a}.\n\u0627\u0633\u0623\u0644 \u0627\u0644\u0646\u0627\u062f\u0644 \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628: \u0627\u0644\u0645\u0637\u0628\u062e \u064a\u0639\u0631\u0641 \u0645\u0627 \u064a\u0645\u0643\u0646 \u062a\u062d\u0636\u064a\u0631\u0647 \u0644\u0643.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F \u0627\u0646\u062a\u0628\u0647: \u0641\u064a \u0648\u0635\u0641 **${pi}** \u0643\u062a\u0628 \u0627\u0644\u0645\u0637\u0639\u0645 ${a}.\n\u0627\u0644\u0645\u062d\u0633\u0633\u0627\u062a \u063a\u064a\u0631 \u0645\u0633\u062c\u0651\u0644\u0629 \u0647\u0646\u0627\u060c \u0641\u0627\u0637\u0644\u0628 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0645\u0637\u0628\u062e \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628.`,
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
    consiglioSenza: (a, p, altri) => `\uba54\ub274\uc5d0 \uc801\ud78c \uc7ac\ub8cc\uc5d0 ${a}\uc774(\uac00) \uc5c6\ub294 \uc694\ub9ac\uc608\uc694:\n${p}\n${altri > 0 ? `\ub2e4\ub978 ${altri}\uac1c \uc694\ub9ac\ub294 \uc124\uba85\uc774 \ubd80\uc871\ud574 \ud310\ub2e8\ud560 \uc218 \uc5c6\uc5b4\uc694.\n` : ''}\ubcf4\uc7a5\uc740 \uc544\ub2c8\uc5d0\uc694. \uba54\ub274\ub294 \ub808\uc2dc\ud53c\uac00 \uc544\ub2c8\uace0 \uc8fc\ubc29\uc740 \uac19\uc740 \ud32c\uc744 \uc501\ub2c8\ub2e4.\n\uc8fc\ubb38 \uc804\uc5d0 \uc9c1\uc6d0\uc5d0\uac8c \uaf2d \ub9d0\uc500\ud574 \uc8fc\uc138\uc694. \ucd5c\uc885 \ud655\uc778\uc740 \uc8fc\ubc29\uc5d0\uc11c \ud569\ub2c8\ub2e4.`,
    nessunoSenza: a => `${a} \uc5c6\uc774 \uc790\uc2e0 \uc788\uac8c \ucd94\ucc9c\ub4dc\ub9b4 \uc218 \uc788\ub294 \uc694\ub9ac\ub97c \uba54\ub274\uc5d0\uc11c \ucc3e\uc9c0 \ubabb\ud588\uc5b4\uc694.\n\uc8fc\ubb38 \uc804\uc5d0 \uc9c1\uc6d0\uc5d0\uac8c \ubb38\uc758\ud574 \uc8fc\uc138\uc694. \uc8fc\ubc29\uc774 \uac00\ub2a5\ud55c \uac83\uc744 \uc54c\uace0 \uc788\uc5b4\uc694.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F \uc8fc\uc758\ud558\uc138\uc694: **${pi}** \uc124\uba85\uc5d0 ${a}\uc774(\uac00) \uc801\ud600 \uc788\uc5b4\uc694.\n\uc54c\ub808\ub974\uae30 \uc815\ubcf4\uac00 \ub4f1\ub85d\ub418\uc5b4 \uc788\uc9c0 \uc54a\uc73c\ub2c8 \uc8fc\ubb38 \uc804\uc5d0 \uc8fc\ubc29\uc5d0 \ud655\uc778\ud574 \uc8fc\uc138\uc694.`,
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
    consiglioSenza: (a, p, altri) => `Di menu, hidangan berikut tidak menyebut ${a} di antara bahan yang tertulis:\n${p}\n${altri > 0 ? `Untuk ${altri} hidangan lain menu tidak cukup jelas untuk saya nilai.\n` : ''}Ini bukan jaminan: menu bukan resep, dan dapur memakai wajan yang sama.\nBeri tahu pelayan sebelum memesan: dapur selalu mengonfirmasi.`,
    nessunoSenza: a => `Di menu saya tidak menemukan hidangan yang bisa saya sarankan dengan yakin tanpa ${a}.\nTanyakan kepada pelayan sebelum memesan: dapur tahu apa yang bisa disiapkan untuk Anda.`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F Perhatian: dalam deskripsi **${pi}** restoran menulis ${a}.\nAlergen belum dicatat di sini, jadi mintalah konfirmasi dapur sebelum memesan.`,
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
    consiglioSenza: (a, p, altri) => `\u092e\u0947\u0928\u094d\u092f\u0942 \u092e\u0947\u0902 \u0932\u093f\u0916\u0940 \u0938\u093e\u092e\u0917\u094d\u0930\u0940 \u092e\u0947\u0902 \u0907\u0928 \u0935\u094d\u092f\u0902\u091c\u0928\u094b\u0902 \u092e\u0947\u0902 ${a} \u0928\u0939\u0940\u0902 \u0939\u0948:\n${p}\n${altri > 0 ? `\u0905\u0928\u094d\u092f ${altri} \u0935\u094d\u092f\u0902\u091c\u0928\u094b\u0902 \u0915\u093e \u0935\u093f\u0935\u0930\u0923 \u092a\u0930\u094d\u092f\u093e\u092a\u094d\u0924 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964\n` : ''}\u092f\u0939 \u0917\u093e\u0930\u0902\u091f\u0940 \u0928\u0939\u0940\u0902 \u0939\u0948: \u092e\u0947\u0928\u094d\u092f\u0942 \u0930\u0947\u0938\u093f\u092a\u0940 \u0928\u0939\u0940\u0902 \u0939\u0948, \u0914\u0930 \u0930\u0938\u094b\u0908 \u092e\u0947\u0902 \u090f\u0915 \u0939\u0940 \u092c\u0930\u094d\u0924\u0928 \u0907\u0938\u094d\u0924\u0947\u092e\u093e\u0932 \u0939\u094b\u0924\u0947 \u0939\u0948\u0902\u0964\n\u0911\u0930\u094d\u0921\u0930 \u0938\u0947 \u092a\u0939\u0932\u0947 \u0935\u0947\u091f\u0930 \u0915\u094b \u091c\u093c\u0930\u0942\u0930 \u092c\u0924\u093e\u090f\u0902: \u092a\u0941\u0937\u094d\u091f\u093f \u0939\u092e\u0947\u0936\u093e \u0930\u0938\u094b\u0908 \u0915\u0930\u0924\u0940 \u0939\u0948\u0964`,
    nessunoSenza: a => `${a} \u0915\u0947 \u092c\u093f\u0928\u093e \u092e\u0948\u0902 \u092e\u0947\u0928\u094d\u092f\u0942 \u0938\u0947 \u092d\u0930\u094b\u0938\u0947 \u0915\u0947 \u0938\u093e\u0925 \u0915\u094b\u0908 \u0935\u094d\u092f\u0902\u091c\u0928 \u0928\u0939\u0940\u0902 \u0938\u0941\u091d\u093e \u0938\u0915\u0924\u093e\u0964\n\u0911\u0930\u094d\u0921\u0930 \u0938\u0947 \u092a\u0939\u0932\u0947 \u0935\u0947\u091f\u0930 \u0938\u0947 \u092a\u0942\u091b\u0947\u0902: \u0930\u0938\u094b\u0908 \u091c\u093e\u0928\u0924\u0940 \u0939\u0948 \u0915\u093f \u0935\u0939 \u0915\u094d\u092f\u093e \u092c\u0928\u093e \u0938\u0915\u0924\u0940 \u0939\u0948\u0964`,
    piattoNomina: (pi, a) => `\u26a0\uFE0F \u0927\u094d\u092f\u093e\u0928 \u0926\u0947\u0902: **${pi}** \u0915\u0947 \u0935\u093f\u0935\u0930\u0923 \u092e\u0947\u0902 \u0930\u0947\u0938\u094d\u091f\u094b\u0930\u0947\u0902\u091f \u0928\u0947 ${a} \u0932\u093f\u0916\u093e \u0939\u0948\u0964\n\u090f\u0932\u0930\u094d\u091c\u0940 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0926\u0930\u094d\u091c \u0928\u0939\u0940\u0902 \u0939\u0948, \u0907\u0938\u0932\u093f\u090f \u0911\u0930\u094d\u0921\u0930 \u0938\u0947 \u092a\u0939\u0932\u0947 \u0930\u0938\u094b\u0908 \u0938\u0947 \u092a\u0941\u0937\u094d\u091f\u093f \u0915\u0930\u093e\u090f\u0902\u0964`,
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
  // "glutine", "lattosio", "allergia" bastano da sole: non sono parole che si
  // usano per ordinare. "pesce", "uova", "latte" no: quelle vogliono anche un
  // segno di allergia, altrimenti "Avete del pesce?" finiva qui dentro.
  const parlaDiAllergie = contiene(msg, PAROLE_ALLERGENI)
    || (contieneParolaIntera(msg, allergeniInteri) && CONTESTO_ALLERGIA.test(msg));
  if (parlaDiAllergie && !parlaDiVegetariano) {
    const piatto = piattoCitato(msg, piatti);
    if (piatto) {
      const elenco = elencoAllergeni(piatto.allergens, p.language);
      if (elenco.length > 0) {
        return { message: t.allergeniDi(piatto.nomeMostrato, elenco.join(', ')), suggestions: t.suggerimenti, intento: 'allergeni' };
      }
      // Allergeni non registrati, ma il cliente ha detto di cosa e' allergico
      // e il ristoratore quell'ingrediente l'ha scritto nella descrizione:
      // tacere qui sarebbe la cosa peggiore. Il "Caesar Salad" di un menu
      // spagnolo dice "picatostes", cioe' pane, e chi e' celiaco non lo sa.
      // Al contrario, se il testo NON lo nomina non si dice che e' sicuro:
      // non lo sappiamo, e si rimanda come sempre alla cucina.
      // Si cita la PAROLA scritta dal ristoratore ("picatostes"), non il nome
      // dell'allergene: "ha scritto glutine" sarebbe falso, quella parola nel
      // menu non c'e'. Il cliente deve poter rileggere e verificare da solo.
      const testoPiatto = `${piatto.name} ${piatto.descrizioneMostrata || piatto.description || ''}`;
      const parole = allergeniCitati(msg)
        .map(a => parolaAllergene(testoPiatto, a))
        .filter((w): w is string => w !== null);
      if (parole.length > 0) {
        return {
          message: t.piattoNomina(piatto.nomeMostrato, [...new Set(parole)].join(', ')),
          suggestions: t.suggerimenti,
          intento: 'allergeni',
        };
      }
      return { message: t.allergeniNonRegistrati(piatto.nomeMostrato), suggestions: t.suggerimenti, intento: 'allergeni' };
    }

    // Nessun piatto nominato, ma il cliente ha detto DI COSA e' allergico
    // ("ho un'allergia alle noci", "avete piatti senza glutine?"): la
    // risposta ce l'abbiamo, ed e' il motivo per cui il ristoratore ha
    // compilato gli allergeni. Prima si rispondeva "dimmi quale allergia
    // hai" a chi l'aveva appena detta.
    const citati = allergeniCitati(msg);
    if (citati.length > 0 && citati.length <= 3) {
      const comeSiChiamano = citati.map(c => traduciAllergene(c, p.language)).join(', ');

      // 2a. Il ristorante ha registrato gli allergeni: e' il dato migliore
      //     che esista, vince su qualunque cosa possiamo dedurre dal testo.
      const conDati = piatti.filter(d => Array.isArray(d.allergens) && d.allergens.filter(Boolean).length > 0);
      if (conDati.length > 0) {
        const liberi = conDati.filter(d =>
          !d.allergens.some(a => { const k = chiaveAllergene(a); return k !== null && citati.includes(k); }));
        if (liberi.length > 0) {
          const nomi = liberi.slice(0, MAX_PIATTI_ELENCATI).map(d => `• **${d.nomeMostrato}**`).join('\n');
          return {
            message: t.senzaAllergene(comeSiChiamano, nomi, piatti.length - conDati.length),
            suggestions: t.suggerimenti,
            intento: 'allergeni',
          };
        }
      }

      // 2b. Nessun allergene registrato (il caso di TUTTI i ristoranti, oggi):
      //     si legge quello che il ristoratore ha scritto nel nome e nella
      //     descrizione. Si consiglia solo cio' che il menu permette davvero
      //     di leggere, e la frase dice chiaro che non e' una garanzia e che
      //     la conferma la da' la cucina.
      const scelta = CONSIGLIA_DA_TESTO
        ? piattiSenzaAllergeni(piatti, citati)
        : { consigliati: [] as typeof piatti, scartati: 0, nonLeggibili: 0 };
      if (scelta.consigliati.length > 0) {
        const nomi = scelta.consigliati.map(d => `• **${d.nomeMostrato}**`).join('\n');
        return {
          message: t.consiglioSenza(comeSiChiamano, nomi, scelta.nonLeggibili),
          suggestions: t.suggerimenti,
          intento: 'allergeni',
        };
      }
      // Senza un elenco da proporre si dice la verita': non lo sappiamo.
      return {
        message: CONSIGLIA_DA_TESTO ? t.nessunoSenza(comeSiChiamano) : t.allergeniNonSappiamo,
        suggestions: t.suggerimenti,
        intento: 'allergeni',
      };
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
