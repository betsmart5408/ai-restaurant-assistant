import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/client';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
}

async function loadRestaurantContext(restaurantId: string) {
  const dishes = await db.query<MenuDish>(
    `SELECT id, name, description, price, category, allergens
     FROM dishes WHERE restaurant_id = $1 AND available = true
     ORDER BY category, sort_order`,
    [restaurantId]
  );

  // Ingredienti in scadenza nelle prossime 48h
  const expiring = await db.query(
    `SELECT i.name as ingredient_name, i.expiry_date,
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

  // Ingredienti con stock alto (più del doppio della soglia) — da promuovere
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

  // Top piatti per margine (da promuovere preferenzialmente)
  const topMargin = await db.query(
    `SELECT name, price, cost,
            ROUND((1 - cost/NULLIF(price,0)) * 100, 0) as margin_pct
     FROM dishes
     WHERE restaurant_id = $1 AND available = true AND cost > 0
     ORDER BY margin_pct DESC LIMIT 3`,
    [restaurantId]
  );

  // Piatti già ordinati in questa sessione (evita di riproporli)
  return {
    dishes: dishes.rows,
    expiring: expiring.rows,
    highStock: highStock.rows,
    topMargin: topMargin.rows,
  };
}

function getTimeContext(): { period: string; it: string; en: string; de: string; es: string } {
  const h = new Date().getHours();
  if (h >= 11 && h < 15) return { period: 'lunch', it: 'pranzo', en: 'lunch', de: 'Mittagessen', es: 'almuerzo' };
  if (h >= 18 && h < 23) return { period: 'dinner', it: 'cena', en: 'dinner', de: 'Abendessen', es: 'cena' };
  return { period: 'other', it: 'visita', en: 'visit', de: 'Besuch', es: 'visita' };
}

function buildSystemPrompt(
  restaurantName: string,
  dishes: MenuDish[],
  expiring: { ingredient_name: string; dishes_using: string[] }[],
  highStock: { ingredient_name: string; dishes_using: string[] }[],
  topMargin: { name: string; price: number; margin_pct: number }[],
  language: string,
  tableNumber: number
): string {
  const time = getTimeContext();
  const menuJson = JSON.stringify(dishes.map(d => ({
    id: d.id, name: d.name, price: d.price, category: d.category,
    description: d.description, allergens: d.allergens
  })));

  // Costruisce lista promozioni prioritarie dinamiche
  const promos: string[] = [];

  if (expiring.length > 0) {
    expiring.forEach(e => {
      promos.push(`PRIORITÀ ALTA - Promuovi questi piatti (ingrediente "${e.ingredient_name}" in scadenza): ${e.dishes_using.join(', ')}`);
    });
  }

  if (highStock.length > 0) {
    highStock.forEach(h => {
      promos.push(`STOCK ABBONDANTE - Suggerisci come "specialità del giorno": ${h.dishes_using.join(', ')}`);
    });
  }

  if (topMargin.length > 0) {
    promos.push(`MARGINE MIGLIORE - Preferisci suggerire: ${topMargin.map(d => `${d.name} (margine ${d.margin_pct}%)`).join(', ')}`);
  }

  const promoSection = promos.length > 0
    ? `\nPROMOZIONI ATTIVE (applica in ordine di priorità):\n${promos.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';

  const langName: Record<string, string> = {
    it: 'italiano', en: 'English', de: 'Deutsch', es: 'español', fr: 'français'
  };

  return `Sei l'assistente virtuale del ${restaurantName}, tavolo ${tableNumber}.
Rispondo SEMPRE in ${langName[language] ?? language}.
Ora: ${time[language as keyof typeof time] ?? time.it}.
Sei cordiale, professionale e conciso (max 3-4 righe salvo richiesta dettagli).

MENU DISPONIBILE:
${menuJson}
${promoSection}

REGOLE UPSELLING AVANZATO (applica con naturalezza, mai in modo aggressivo):
- Servizio ${time.period === 'lunch' ? 'pranzo → suggerisci menu completo rapido (primo + acqua)' : 'cena → punta su esperienza completa (antipasto + vino + dessert)'}
- Se ordina solo primo → suggerisci UN antipasto O UN dessert (non entrambi)
- Se nessuna bevanda → suggerisci vino abbinato al piatto ordinato
- Se ci sono PROMOZIONI ATTIVE → menziona quei piatti come "specialità del giorno" o "consiglio dello chef"
- Combo: se vedi un abbinamento naturale (es. lasagna + vino rosso) proponi un prezzo bundle (sconto ~10%)
- Non riproporre qualcosa già ordinato o già rifiutato nella conversazione
- Max 1 suggerimento per messaggio

REGOLE ORDINE:
- Chiedi sempre conferma con riepilogo prima di finalizzare
- Dopo conferma esplicita del cliente, aggiungi in fondo (su riga separata):
  ORDER_JSON:{"items":[{"dish_id":"...","dish_name":"...","qty":1,"unit_price":0.0}]}
- Per allergeni e ingredienti: sii preciso, cita solo quelli del menu

NON inventare piatti, prezzi o ingredienti non presenti nel menu.`;
}

export async function processChat(ctx: ChatContext, userMessage: string) {
  const { restaurantId, restaurantName, tableNumber, language, conversationHistory } = ctx;

  const { dishes, expiring, highStock, topMargin } = await loadRestaurantContext(restaurantId);

  const systemPrompt = buildSystemPrompt(
    restaurantName, dishes, expiring, highStock, topMargin, language, tableNumber
  );

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const assistantMessage = response.content[0].type === 'text'
    ? response.content[0].text
    : '';

  const orderMatch = assistantMessage.match(/ORDER_JSON:(\{[\s\S]+?\})\s*$/m);
  const orderData = orderMatch ? JSON.parse(orderMatch[1]) : null;
  const visibleMessage = assistantMessage.replace(/ORDER_JSON:\{[\s\S]+?\}\s*$/m, '').trim();

  return { message: visibleMessage, orderData };
}
