import Groq from 'groq-sdk';
import { db } from '../db/client';

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
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  groupSize?: number;
  savedPreferences?: string;
  existingOrders?: string;
  returningCustomer?: boolean;
  previousDishes?: string[];
}

// ── Meteo Málaga (open-meteo, gratuito, nessuna API key) ──────────────────────
async function fetchWeather(): Promise<{ desc: string; mood: string } | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=36.72&longitude=-4.42&current=temperature_2m,weather_code',
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

function getTimeContext(): { period: string; it: string; en: string; de: string; es: string } {
  const h = new Date().getHours();
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
): string {
  const time = getTimeContext();
  const menuJson = JSON.stringify(dishes.map(d => ({
    name: d.name, price: d.price, category: d.category,
  })));

  const promos: string[] = [];
  expiring.forEach(e => promos.push(`URGENTE - promuovi (ingrediente "${e.ingredient_name}" in scadenza): ${e.dishes_using.join(', ')}`));
  highStock.forEach(h => promos.push(`STOCK ALTO - suggerisci come "specialità del giorno": ${h.dishes_using.join(', ')}`));
  if (topMargin.length > 0) promos.push(`MARGINE ALTO - preferisci: ${topMargin.map(d => `${d.name}`).join(', ')}`);

  const promoSection = promos.length > 0
    ? `\nPROMOZIONI ATTIVE:\n${promos.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '';

  const popularSection = popular.length > 0
    ? `\nBESTSELLER (più ordinati dai clienti): ${popular.map(p => p.dish_name).join(', ')}\n→ Menzionali come "il preferito dei nostri clienti" o "uno dei più amati".` : '';

  const weatherSection = weather ? `\nMETEO MÁLAGA ORA: ${weather.desc}.${
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

  return `Sei Marco, il sommelier e chef virtuale di ${restaurantName} — ristorante italiano con anima mediterranea nel cuore di Málaga.
Personalità: calorosa, appassionata, professionale. Ami il cibo, conosci ogni piatto e vino a memoria. Vuoi che ogni ospite viva un'esperienza indimenticabile.
Rispondi SEMPRE in ${langName[language] ?? language}. Tavolo ${tableNumber}. Ora: ${time[language as keyof typeof time] ?? time.it}.
Tono: amichevole e coinvolgente, mai robotico. Max 4 righe salvo richiesta dettagli.
${weatherSection}${groupSection}${preferencesSection}${existingOrdersSection}${returningSection}

MENU DISPONIBILE:
${menuJson}
${promoSection}${popularSection}

ALLERGIE (priorità assoluta):
- Nel messaggio di benvenuto chiedi SEMPRE se ci sono allergie o intolleranze.
- Se dichiarano un'allergia: filtra i suggerimenti, evidenzia i piatti sicuri, avverti se un piatto contiene l'allergene.

ORDINE IN LINGUAGGIO NATURALE:
- Se il cliente dice "voglio una carbonara e due birre" → estrai i piatti dal menu, verifica che esistano, chiedi conferma riepilogando prezzi e totale.
- Se un piatto non esiste nel menu, dillo e suggerisci l'alternativa più simile disponibile.

PIATTI E BEVANDE:
- Piatto → ingredienti, sapori, tecnica + suggerisci ordine o abbinamento vino/cocktail.
- Bevanda → profilo aromatico, come si serve, abbinamenti cibo.
- Max 1 upselling per messaggio, mai aggressivo. Non riproporre ciò che è già stato ordinato/rifiutato.
- ${time.period === 'lunch' ? 'Pranzo → menu rapido (primo + acqua).' : 'Cena → esperienza completa (antipasto + vino + dessert).'}

MENU DEGUSTAZIONE:
- Se chiedono un menu degustazione, consiglio dello chef, o menzionano budget/gruppo:
  → Componi percorso: antipasto + primo + secondo + dessert + vino abbinato.
  → Totale stimato per persona. Chiedi conferma prima di procedere.

ORDINE:
- Chiedi sempre conferma con riepilogo (nomi, quantità, totale) prima di finalizzare.
- Dopo conferma esplicita del cliente, aggiungi su riga separata:
  ORDER_JSON:{"items":[{"dish_name":"...","qty":1,"unit_price":0.0}]}
- Non inventare piatti o prezzi non presenti nel menu.

${getSuggestionsInstruction(language)}`;
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function processChat(ctx: ChatContext, userMessage: string, groqApiKey?: string) {
  const { restaurantId, restaurantName, tableNumber, language, conversationHistory, groupSize, savedPreferences, existingOrders, returningCustomer, previousDishes } = ctx;
  const groq = getGroqClient(groqApiKey);

  const [{ dishes, expiring, highStock, topMargin, popular }, weather] = await Promise.all([
    loadRestaurantContext(restaurantId),
    fetchWeather(),
  ]);

  const systemPrompt = buildSystemPrompt(
    restaurantName, dishes, expiring, highStock, topMargin, popular,
    language, tableNumber, weather, groupSize, savedPreferences, existingOrders,
    returningCustomer, previousDishes,
  );

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversationHistory.slice(-6),
    { role: 'user', content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    max_tokens: 600,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  });

  const assistantMessage = response.choices[0]?.message?.content ?? '';

  const orderMatch = assistantMessage.match(/ORDER_JSON:(\{[\s\S]+?\})\s*$/m);
  const orderData = orderMatch ? JSON.parse(orderMatch[1]) : null;

  const suggestionsMatch = assistantMessage.match(/SUGGESTIONS_JSON:\s*(\[[\s\S]+?\])\s*$/m);
  let suggestions: string[] = [];
  if (suggestionsMatch) {
    try { suggestions = JSON.parse(suggestionsMatch[1]); } catch { suggestions = []; }
  }

  const visibleMessage = assistantMessage
    .replace(/ORDER_JSON:\s*\{[\s\S]+?\}\s*$/m, '')
    .replace(/SUGGESTIONS_JSON:\s*\[[\s\S]+?\]\s*$/m, '')
    .trim();

  return { message: visibleMessage, orderData, suggestions };
}
