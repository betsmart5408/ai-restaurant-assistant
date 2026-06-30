import { Router } from 'express';
import { db } from '../db/client';
import Groq from 'groq-sdk';

function getGroqClient(apiKey?: string | null) {
  return new Groq({ apiKey: apiKey || process.env.GROQ_API_KEY });
}

async function getRestaurantGroqKey(slug?: string): Promise<string | null> {
  if (!slug) return null;
  try {
    const r = await db.query('SELECT groq_api_key FROM restaurants WHERE slug = $1', [slug]);
    return r.rows[0]?.groq_api_key || null;
  } catch { return null; }
}

const router = Router();

// GET /api/menu/:restaurantSlug — menu pubblico per il QR chat
router.get('/:restaurantSlug', async (req, res) => {
  try {
    const { restaurantSlug } = req.params;

    const restaurant = await db.query(
      'SELECT id, name, languages, currency FROM restaurants WHERE slug = $1',
      [restaurantSlug]
    );

    if (restaurant.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const restaurantId = restaurant.rows[0].id;

    const dishes = await db.query(
      `SELECT id, name, description, price, category, allergens, image_url, available, prep_time_min
       FROM dishes
       WHERE restaurant_id = $1 AND available = true
       ORDER BY category, sort_order, name`,
      [restaurantId]
    );

    // Raggruppa per categoria
    const menuByCategory: Record<string, typeof dishes.rows> = {};
    for (const dish of dishes.rows) {
      if (!menuByCategory[dish.category]) {
        menuByCategory[dish.category] = [];
      }
      menuByCategory[dish.category].push(dish);
    }

    res.json({
      restaurant: restaurant.rows[0],
      menu: menuByCategory,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/menu/translate-batch — traduce un array di descrizioni {id, text}
router.post('/translate-batch', async (req, res) => {
  try {
    const { items, lang, restaurant_slug }: { items: { id: string; text: string }[]; lang: string; restaurant_slug?: string } = req.body;
    if (!items?.length || lang === 'es') return res.json(items.map(i => ({ id: i.id, translated: i.text })));
    const langNames: Record<string, string> = { it: 'Italian', en: 'English', de: 'German', fr: 'French', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)', ja: 'Japanese', ar: 'Arabic' };
    const compact = items.map((item, idx) => `${idx}|${item.text}`).join('\n');
    const groqKey = await getRestaurantGroqKey(restaurant_slug);
    const groq = getGroqClient(groqKey);
    const msg = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 2048,
      temperature: 0.1,
      messages: [{ role: 'user', content: `Translate each line to ${langNames[lang] || 'English'}. Keep format INDEX|TRANSLATION exactly. One per line:\n\n${compact}` }],
    });
    const lines = (msg.choices[0]?.message?.content ?? '').trim().split('\n');
    const result = items.map((item, idx) => {
      const line = lines.find(l => l.startsWith(`${idx}|`));
      return { id: item.id, translated: line ? line.slice(line.indexOf('|') + 1) : item.text };
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Batch translation failed' });
  }
});

// POST /api/menu/translate-desc — traduce una singola descrizione
router.post('/translate-desc', async (req, res) => {
  try {
    const { text, lang, restaurant_slug } = req.body;
    if (!text || !lang || lang === 'es') return res.json({ translated: text });
    const langNames: Record<string, string> = { en: 'English', de: 'German', fr: 'French', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese (Simplified)', ja: 'Japanese', ar: 'Arabic', es: 'Spanish' };
    const groqKey = await getRestaurantGroqKey(restaurant_slug);
    const groq = getGroqClient(groqKey);
    const msg = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 256,
      temperature: 0.1,
      messages: [{ role: 'user', content: `Translate this dish description to ${langNames[lang] || 'English'}. Reply with ONLY the translated text, nothing else:\n\n${text}` }],
    });
    res.json({ translated: (msg.choices[0]?.message?.content ?? text).trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// GET /api/menu/:restaurantSlug/dishes/translated?lang=XX — menu tradotto
router.get('/:restaurantSlug/dishes/translated', async (req, res) => {
  try {
    const { restaurantSlug } = req.params;
    const lang = (req.query.lang as string) || 'es';

    const result = await db.query(
      `SELECT d.id, d.name, d.description, d.price, d.category, d.available
       FROM dishes d
       JOIN restaurants r ON r.id = d.restaurant_id
       WHERE r.slug = $1 AND d.available = true
       ORDER BY d.category, d.name`,
      [restaurantSlug]
    );
    const dishes = result.rows;

    // Restituisce il menu in originale — le traduzioni avvengono on-demand per categoria via /translate-batch
    res.json(dishes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// GET /api/menu/:restaurantSlug/dishes — lista piatti per dashboard
router.get('/:restaurantSlug/dishes', async (req, res) => {
  try {
    const { restaurantSlug } = req.params;

    const result = await db.query(
      `SELECT d.*, r.id as restaurant_id
       FROM dishes d
       JOIN restaurants r ON r.id = d.restaurant_id
       WHERE r.slug = $1
       ORDER BY d.category, d.sort_order`,
      [restaurantSlug]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/menu/:restaurantSlug/dishes — crea nuovo piatto
router.post('/:restaurantSlug/dishes', async (req, res) => {
  try {
    const { restaurantSlug } = req.params;
    const { name, description, price, cost, category, allergens, prep_time_min } = req.body;

    const restaurant = await db.query(
      'SELECT id FROM restaurants WHERE slug = $1',
      [restaurantSlug]
    );

    if (restaurant.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const result = await db.query(
      `INSERT INTO dishes (restaurant_id, name, description, price, cost, category, allergens, prep_time_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [restaurant.rows[0].id, name, description, price, cost ?? 0, category, allergens ?? [], prep_time_min ?? 10]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/menu/:restaurantSlug/dishes/:dishId — aggiorna disponibilità
router.patch('/:restaurantSlug/dishes/:dishId', async (req, res) => {
  try {
    const { dishId } = req.params;
    const { available, price, description } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (available !== undefined) { fields.push(`available = $${idx++}`); values.push(available); }
    if (price !== undefined) { fields.push(`price = $${idx++}`); values.push(price); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(dishId);
    const result = await db.query(
      `UPDATE dishes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
