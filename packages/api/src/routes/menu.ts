import { Router } from 'express';
import { db } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';

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
    const { items, lang }: { items: { id: string; text: string }[]; lang: string } = req.body;
    if (!items?.length || lang === 'es') return res.json(items.map(i => ({ id: i.id, translated: i.text })));
    const langNames: Record<string, string> = { it: 'Italian', en: 'English', de: 'German', fr: 'French' };
    const client = new Anthropic();
    const compact = items.map((item, idx) => `${idx}|${item.text}`).join('\n');
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: `Translate each line to ${langNames[lang] || 'English'}. Keep format INDEX|TRANSLATION exactly. One per line:\n\n${compact}` }],
    });
    const lines = (msg.content[0] as { text: string }).text.trim().split('\n');
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
    const { text, lang } = req.body;
    if (!text || !lang || lang === 'es') return res.json({ translated: text });
    const langNames: Record<string, string> = { it: 'Italian', en: 'English', de: 'German', fr: 'French' };
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: `Translate this dish description to ${langNames[lang] || 'English'}. Reply with ONLY the translated text, nothing else:\n\n${text}` }],
    });
    res.json({ translated: (msg.content[0] as { text: string }).text.trim() });
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

    if (lang === 'es' || dishes.length === 0) {
      return res.json(dishes);
    }

    const langNames: Record<string, string> = { it: 'Italian', en: 'English', de: 'German', fr: 'French' };
    const targetLang = langNames[lang] || 'English';

    // Batch translate descriptions with Claude
    const client = new Anthropic();
    const compact = dishes.map((d, i) => `${i}|${d.description || ''}`).join('\n');
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Translate each dish description below to ${targetLang}. Keep the same format: INDEX|TRANSLATED_DESCRIPTION. One per line. Do not change dish names or prices. If description is empty, return INDEX| (empty after pipe).\n\n${compact}`,
      }],
    });

    const translated = (msg.content[0] as { text: string }).text.trim().split('\n');
    const descMap: Record<number, string> = {};
    for (const line of translated) {
      const pipe = line.indexOf('|');
      if (pipe !== -1) {
        const idx = parseInt(line.slice(0, pipe));
        if (!isNaN(idx)) descMap[idx] = line.slice(pipe + 1);
      }
    }

    const translatedDishes = dishes.map((d, i) => ({
      ...d,
      description: descMap[i] !== undefined ? descMap[i] : d.description,
    }));

    res.json(translatedDishes);
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
