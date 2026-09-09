import Groq from 'groq-sdk';
import { db } from '../db/client';
import { modelliDisponibili } from './groq-model';

function getGroqClient(apiKey?: string) {
  return new Groq({ apiKey: apiKey || process.env.GROQ_API_KEY });
}

interface MenuDish {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  allergens: string[];
}

interface ChatContext {
  restaurantId: string;
  restaurantName: string;
  tableNumber: number;
  language: string;
  aiName?: string;
  city?: string | null;
  country?: string | null;
  cuisineType?: string | null;
  about?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  groupSize?: number;
  savedPreferences?: string;
  existingOrders?: string;
  returningCustomer?: boolean;
  previousDishes?: string[];
}

// ── Cache contesto ristorante (5 min) ─────────────────────────────────────────
const contextCache = new Map<string, { data: Awaited<ReturnType<typeof loadRestaurantContext>>; ts: number }>();
const weatherCache = new Map<string, { data: { desc: string; mood: string } | null; ts: number }>();

// ── Meteo Málaga (open-meteo, gratuito, nessuna API key) ──────────────────────
async function fetchWeather(lat: number, lon: number): Promise<{ desc: string; mood: string } | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`,
      { signal: controller.signal }
    );
    clearTimeout(tid);
    const data = await res.json() as { current: { temperature_2m: number; weather_code: number } };
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    let desc = `${temp}°C`;
    let mood = 'normale';
    if (code === 0) {
      desc = `soleggiato ${temp}°C`;
      mood = temp >= 28 ? 'molto caldo' : temp >= 22 ? 'caldo' : 'fresco';
    } else if (code <= 3) {
      desc = `nuvoloso ${temp}°C`;
    } else if (code >= 51 && code <= 82) {
      desc = `pioggia ${temp}°C`;
      mood = 'piovoso';
    } else {
      desc = `${temp}°C`;
    }
    return { desc, mood };
  } catch {
    return null;
  }
}

// ── Dati ristorante ───────────────────────────────────────────────────────────
async function loadRestaurantContext(restaurantId: string) {
  const dishes = await db.query<MenuDish>(
    `SELECT id, name, description, price, category, allergens
     FROM dishes WHERE restaurant_id = $1 AND available = true
     ORDER BY category, sort_order`,
    [restaurantId]
  );

  const expiring = await db.query(
    `SELECT i.name as ingredient_name,
            array_agg(DISTINCT d.name) as dishes_using
     FROM ingredients i
     JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
     JOIN dishes d ON d.id = ri.dish_id AND d.restaurant_id = $1
     WHERE i.restaurant_id = $1
       AND i.expiry_date IS NOT NULL
       AND i.expiry_date <= NOW() + INTERVAL '2 days'
       AND i.current_qty > 0
     GROUP BY i.name, i.expiry_date`,
    [restaurantId]
  );

  const highStock = await db.query(
    `SELECT i.name as ingredient_name,
            array_agg(DISTINCT d.name) as dishes_using
     FROM ingredients i
     JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
     JOIN dishes d ON d.id = ri.dish_id AND d.restaurant_id = $1
     WHERE i.restaurant_id = $1
       AND i.min_threshold > 0
       AND i.current_qty >= i.min_threshold * 3
     GROUP BY i.name
     LIMIT 3`,
    [restaurantId]
  );

  const topMargin = await db.query(
    `SELECT name, price, cost,
            ROUND((1 - cost/NULLIF(price,0)) * 100, 0) as margin_pct
     FROM dishes
     WHERE restaurant_id = $1 AND available = true AND cost > 0
     ORDER BY margin_pct DESC LIMIT 3`,
    [restaurantId]
  );

  // Piatti più ordinati (bestseller reali)
  let popular: { dish_name: string }[] = [];
  try {
    const pop = await db.query<{ dish_name: string }>(
      `SELECT oi.dish_name, SUM(oi.qty) as total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.restaurant_id = $1
       GROUP BY oi.dish_name
       ORDER BY total DESC LIMIT 5`,
      [restaurantId]
    );
    popular = pop.rows;
  } catch { popular = []; }

  return {
    dishes: dishes.rows,
    expiring: expiring.rows,
    highStock: highStock.rows,
    topMargin: topMargin.rows,
    popular,
  };
}

function getTimeContext(timezone?: string | null): { period: string; it: string; en: string; de: string; es: string } {
  // L'ora va presa nel fuso del ristorante: il server sta a Greenwich e
  // darebbe la buonasera a colazione a chi sta dall'altra parte del mondo.
  let h: number;
  try {
    h = Number(new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric', hour12: false, timeZone: timezone || 'Europe/Rome',
    }).format(new Date()));
  } catch {
    h = new Date().getHours();
  }
  if (h >= 11 && h < 15) return { period: 'lunch', it: 'pranzo', en: 'lunch', de: 'Mittagessen', es: 'almuerzo' };
  if (h >= 18 && h < 23) return { period: 'dinner', it: 'cena', en: 'dinner', de: 'Abendessen', es: 'cena' };
  return { period: 'other', it: 'visita', en: 'visit', de: 'Besuch', es: 'visita' };
}

function getSuggestionsInstruction(language: string): string {
  const examples: Record<string, string> = {
    it: `["Lo voglio ordinare!", "Cosa abbini con questo?", "Menu degustazione per 2"]`,
    en: `["I'd like to order this!", "What pairs well with this?", "Tasting menu for 2"]`,
    de: `["Das möchte ich bestellen!", "Was passt dazu?", "Degustationsmenü für 2"]`,
    es: `["¡Quiero pedirlo!", "¿Qué marida con esto?", "Menú degustación para 2"]`,
  };
  return `SUGGERIMENTI RAPIDI (obbligatorio):
Alla fine di OGNI risposta aggiungi su riga separata:
SUGGESTIONS_JSON:["opzione1","opzione2","opzione3"]
Max 3 opzioni brevi (max 5 parole), nella lingua della risposta.
Esempio: ${examples[language] ?? examples['it']}`;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  restaurantName: string,
  dishes: MenuDish[],
  expiring: { ingredient_name: string; dishes_using: string[] }[],
  highStock: { ingredient_name: string; dishes_using: string[] }[],
  topMargin: { name: string; price: number; margin_pct: number }[],
  popular: { dish_name: string }[],
  language: string,
  tableNumber: number,
  weather: { desc: string; mood: string } | null,
  groupSize?: number,
  savedPreferences?: string,
  existingOrders?: string,
  returningCustomer?: boolean,
  previousDishes?: string[],
  aiName: string = 'Marco',
  luogo: { city?: string | null; country?: string | null; cuisineType?: string | null; about?: string | null; timezone?: string | null } = {},
): string {
  const time = getTimeContext(luogo.timezone);
  const menuJson = JSON.stringify(dishes.map(d => ({
    name: d.name, price: d.price, category: d.category,
    ...(Array.isArray(d.allergens) && d.allergens.length > 0 ? { allergeni: d.allergens } : {}),
  })));
  const quantiConAllergeni = dishes.filter(d => Array.isArray(d.allergens) && d.allergens.length > 0).length;

  const promos: string[] = [];
  expiring.forEach(e => promos.push(`URGENTE - promuovi (ingrediente "${e.ingredient_name}" in scadenza): ${e.dishes_using.join(', ')}`));
  highStock.forEach(h => promos.push(`STOCK ALTO - suggerisci come "specialità del giorno": ${h.dishes_using.join(', ')}`));
  if (topMargin.length > 0) promos.push(`MARGINE ALTO - preferisci: ${topMargin.map(d => `${d.name}`).join(', ')}`);

  const promoSection = promos.length > 0
    ? `\nPROMOZIONI ATTIVE:\n${promos.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '';

  const popularSection = popular.length > 0
    ? `\nBESTSELLER (più ordinati dai clienti): ${popular.map(p => p.dish_name).join(', ')}\n→ Menzionali come "il preferito dei nostri clienti" o "uno dei più amati".` : '';

  const weatherSection = weather ? `\nMETEO ORA A ${(luogo.city || 'questa citta\'').toUpperCase()}: ${weather.desc}.${
    weather.mood === 'molto caldo' ? ' Suggerisci piatti freschi, insalate, sorbetti e cocktail dissetanti.' :
    weather.mood === 'piovoso' ? ' Oggi fa voglia di comfort food: pasta calda, zuppe, vini rossi corposi.' : ''
  }` : '';

  const groupSection = groupSize ? `\nGRUPPO: ${groupSize} ${groupSize === 1 ? 'persona' : 'persone'}.${
    groupSize >= 4 ? ' Suggerisci antipasti da condividere, bottiglie di vino invece dei calici, e porzioni abbondanti.' :
    groupSize === 2 ? ' Serata per due: punta su un\'esperienza romantica, vino e dessert.' : ''
  }` : '';

  const preferencesSection = savedPreferences
    ? `\nPREFERENZE CLIENTE (già conosciuto): ${savedPreferences}\n→ Ricordalo e adatta subito i tuoi consigli senza richiedere di nuovo le stesse info.` : '';

  const existingOrdersSection = existingOrders
    ? `\nORDINI GIÀ CONFERMATI AL TAVOLO (da altri clienti): ${existingOrders}\n→ Non riproporre questi piatti. Se il cliente li menziona, digli che sono già stati ordinati da qualcuno al tavolo.` : '';

  const returningSection = returningCustomer
    ? `\nCLIENTE DI RITORNO:${previousDishes && previousDishes.length > 0 ? `\n- Ultima visita ha mostrato interesse per: ${previousDishes.join(', ')}\n- Menzionalo naturalmente: "Come ti è piaciuta la carbonara l'ultima volta?" o simile.\n- Suggerisci qualcosa di diverso rispetto a quello che ha già provato, o un abbinamento nuovo.` : '\n- È già stato qui ma non abbiamo dettagli sui piatti precedenti.\n- Accennalo calorosamente: "Bentornato! Cosa ti va oggi?"'}` : '';

  const langName: Record<string, string> = {
    it: 'italiano', en: 'English', de: 'Deutsch', es: 'español', fr: 'français',
    pt: 'português', ru: 'русский', zh: '中文', ja: '日本語', ar: 'العربية',
  };

  const dove = [luogo.city, luogo.country].filter(Boolean).join(', ');
  const rigaLuogo = dove ? ` a ${dove}` : '';
  const rigaCucina = luogo.cuisineType ? `\nCucina: ${luogo.cuisineType}.` : '';
  const rigaRacconto = luogo.about ? `\nIl locale, raccontato dal titolare: ${luogo.about}` : '';

  return `Sei ${aiName}, il sommelier e chef virtuale di ${restaurantName}${rigaLuogo}.${rigaCucina}${rigaRacconto}
Personalità: calorosa, appassionata, professionale. Ami il cibo, conosci ogni piatto e vino a memoria. Vuoi che ogni ospite viva un'esperienza indimenticabile.
Parla solo di questo ristorante e del suo menu: non inventare la sua storia, la sua citta' o i suoi premi.
Rispondi SEMPRE in ${langName[language] ?? language}. Tavolo ${tableNumber}. Ora: ${time[language as keyof typeof time] ?? time.it}.
Tono: amichevole e coinvolgente, mai robotico. Max 4 righe salvo richiesta dettagli.
${weatherSection}${groupSection}${preferencesSection}${existingOrdersSection}${returningSection}

MENU DISPONIBILE:
${menuJson}
${promoSection}${popularSection}

ALLERGIE — REGOLA DI SICUREZZA, NON NEGOZIABILE:
- Nel messaggio di benvenuto chiedi SEMPRE se ci sono allergie o intolleranze.
- NON dichiarare MAI che un piatto e' sicuro, "senza glutine", "senza lattosio" o privo di un allergene.
  Non lo sai: non sei in cucina, non conosci le ricette esatte ne' le contaminazioni.
- Non dedurre gli ingredienti dal nome o dalla descrizione del piatto. Una descrizione non e' una scheda allergeni.
- Puoi riportare SOLO gli allergeni scritti nel campo "allergeni" del menu qui sopra, dicendo che sono le informazioni registrate dal ristorante.
- Quando qualcuno dichiara un'allergia: ringrazia, di' che avvisi il personale, e indirizzalo SEMPRE al cameriere per la conferma prima di ordinare.
- Frase da usare: "Per la tua sicurezza faccio verificare al personale: gli allergeni li conferma la cucina."
- Questo ristorante NON ha ancora registrato gli allergeni dei piatti: dillo con chiarezza e rimanda al personale, senza fare ipotesi.


FORMATTAZIONE (obbligatoria):
- Scrivi SEMPRE i nomi di piatti e vini in **grassetto** (es: **Caesar Salad**, **Sauvignon IGT**). Mai tra virgolette.
- Questo permette al cliente di cliccare il nome per vedere i dettagli del piatto direttamente nell'app.

PIATTI E BEVANDE:
- Piatto → ingredienti, sapori, tecnica + suggerisci ordine o abbinamento vino/cocktail.
- Bevanda → profilo aromatico, come si serve, abbinamenti cibo.
- Max 1 upselling per messaggio, mai aggressivo. Non riproporre ciò che è già stato ordinato/rifiutato.
- ${time.period === 'lunch' ? 'Pranzo → menu rapido (primo + acqua).' : 'Cena → esperienza completa (antipasto + vino + dessert).'}

MENU DEGUSTAZIONE:
- Se chiedono un menu degustazione, consiglio dello chef, o menzionano budget/gruppo:
  → Componi percorso: antipasto + primo + secondo + dessert + vino abbinato.
  → Totale stimato per persona. Chiedi conferma prima di procedere.

IMPORTANTE - NESSUN ORDINE DIGITALE:
- Non prendere ordini. Il personale del ristorante raccoglierà l'ordine al tavolo.
- Se il cliente dice "voglio ordinare" o "prendo la carbonara": rispondi che può salvare il piatto nell'app per non dimenticarlo, e che il cameriere verrà a prendere l'ordine.
- Il tuo ruolo è consigliare, spiegare i piatti, suggerire abbinamenti. Non confermare ordini.

${getSuggestionsInstruction(language)}`;
}


/**
 * Alcuni modelli "ragionano ad alta voce" e mettono il ragionamento dentro
 * tag tipo <think>. Quel testo non deve MAI arrivare al cliente: e' lungo,
 * spesso in inglese, e svela le istruzioni interne.
 */
function pulisciRisposta(testo: string): string {
  if (!testo) return '';
  let t = testo;
  // blocchi di ragionamento completi
  t = t.replace(/<(think|thinking|reasoning|analysis|scratchpad)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Blocco aperto e mai chiuso: vuol dire che la risposta si e' interrotta
  // mentre il modello ragionava, quindi una risposta vera non esiste.
  // Meglio restituire vuoto e far provare un altro modello che mostrare
  // il ragionamento al cliente.
  if (/<(think|thinking|reasoning|analysis|scratchpad)[^>]*>/i.test(t)) return '';
  // eventuali tag di chiusura orfani
  t = t.replace(/<\/?(think|thinking|reasoning|analysis|scratchpad)[^>]*>/gi, '');
  return t.trim();
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function processChat(ctx: ChatContext, userMessage: string, groqApiKey?: string) {
  const { restaurantId, restaurantName, tableNumber, language, conversationHistory, groupSize, savedPreferences, existingOrders, returningCustomer, previousDishes } = ctx;
  const aiName = ctx.aiName?.trim() || 'Marco';
  const groq = getGroqClient(groqApiKey);

  // Cache contesto ristorante per 5 minuti
  const now = Date.now();
  let ctxData = contextCache.get(restaurantId);
  if (!ctxData || now - ctxData.ts > 5 * 60 * 1000) {
    const fresh = await loadRestaurantContext(restaurantId);
    ctxData = { data: fresh, ts: now };
    contextCache.set(restaurantId, ctxData);
  }
  const { dishes, expiring, highStock, topMargin, popular } = ctxData.data;

  // Meteo del posto giusto: senza coordinate si salta del tutto,
  // meglio niente meteo che il meteo di un'altra citta'.
  const lat = ctx.latitude, lon = ctx.longitude;
  let weather: { desc: string; mood: string } | null = null;
  if (typeof lat === 'number' && typeof lon === 'number') {
    const chiaveMeteo = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const salvato = weatherCache.get(chiaveMeteo);
    weather = salvato?.data ?? null;
    if (!salvato || now - salvato.ts > 15 * 60 * 1000) {
      fetchWeather(lat, lon)
        .then(w => weatherCache.set(chiaveMeteo, { data: w, ts: Date.now() }))
        .catch(() => {});
    }
  }

  const systemPrompt = buildSystemPrompt(
    restaurantName, dishes, expiring, highStock, topMargin, popular,
    language, tableNumber, weather, groupSize, savedPreferences, existingOrders,
    returningCustomer, previousDishes, aiName,
    { city: ctx.city, country: ctx.country, cuisineType: ctx.cuisineType, about: ctx.about, timezone: ctx.timezone },
  );

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversationHistory.slice(-6),
    { role: 'user', content: userMessage },
  ];

  // Il modello si sceglie al volo: i nomi fissi vengono ritirati e l'assistente
  // smetterebbe di rispondere senza che nessuno abbia toccato il codice.
  const chiave = groqApiKey || process.env.GROQ_API_KEY || '';
  const modelli = await modelliDisponibili(groq, chiave);
  if (modelli.length === 0) {
    throw new Error('Nessun modello disponibile con questa chiave Groq. Controlla la chiave in Impostazioni IA.');
  }

  const nomiLingua: Record<string, string> = {
    it: 'italiano', en: 'inglese', de: 'tedesco', es: 'spagnolo', fr: 'francese',
    pt: 'portoghese', ru: 'russo', zh: 'cinese', ja: 'giapponese', ar: 'arabo',
  };
  const promptFinale = systemPrompt + `

REGOLE FINALI, PIU' IMPORTANTI DI TUTTE:
- Scrivi SOLO il messaggio destinato al cliente. Niente ragionamenti, niente spiegazioni su come hai deciso, niente tag come <think>.
- Scrivi in ${nomiLingua[language] ?? language}, sempre, anche se le istruzioni qui sopra sono in un'altra lingua.
- Il cliente e' seduto al tavolo e legge dal telefono: poche righe, calde e concrete.`;

  let assistantMessage = '';
  let modelloUsato = '';
  let ultimoErrore: unknown = null;
  for (const model of modelli) {
    // primo tentativo chiedendo di nascondere il ragionamento; se il modello
    // non conosce quel parametro, si riprova senza
    for (const nascondiRagionamento of [true, false]) {
      try {
        const parametri: Record<string, unknown> = {
          model,
          max_tokens: 900,
          temperature: 0.7,
          messages: [
            { role: 'system', content: promptFinale },
            ...messages,
          ],
        };
        if (nascondiRagionamento) parametri.reasoning_format = 'hidden';
        const response = await groq.chat.completions.create(parametri as any);
        assistantMessage = pulisciRisposta(response.choices[0]?.message?.content ?? '');
        if (assistantMessage) { modelloUsato = model; break; }
      } catch (err) {
        ultimoErrore = err;
      }
    }
    if (assistantMessage) break;
  }
  if (!assistantMessage) {
    throw new Error(ultimoErrore instanceof Error ? ultimoErrore.message : 'L\'assistente non ha risposto');
  }

  const suggestionsMatch = assistantMessage.match(/SUGGESTIONS_JSON:\s*(\[[\s\S]+?\])\s*$/m);
  let suggestions: string[] = [];
  if (suggestionsMatch) {
    try { suggestions = JSON.parse(suggestionsMatch[1]); } catch { suggestions = []; }
  }

  const visibleMessage = assistantMessage
    .replace(/SUGGESTIONS_JSON:\s*\[[\s\S]+?\]\s*$/m, '')
    .trim();

  return { message: visibleMessage, suggestions };
}
