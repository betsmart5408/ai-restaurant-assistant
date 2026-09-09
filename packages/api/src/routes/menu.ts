import { Router } from 'express';
import { db } from '../db/client';
import Groq from 'groq-sdk';
import { traduciESalva, lingueDelRistorante, TUTTE_LE_LINGUE } from '../services/translate';
import { scegliModello } from '../services/groq-model';
import { requireAuth, requireOwnSlug } from '../middleware/auth';

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

// POST /api/menu/:restaurantSlug/ig-event — contatori dell'invito Instagram.
// Pubblico (lo chiama il chat cliente). event: "shown" | "click".
router.post('/:restaurantSlug/ig-event', async (req, res) => {
  try {
    const colonna = req.body?.event === 'click' ? 'ig_follow_clicks' : 'ig_popup_shown';
    await db.query(
      `UPDATE restaurants SET ${colonna} = ${colonna} + 1 WHERE slug = $1`,
      [req.params.restaurantSlug]
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });   // una metrica persa non deve mai disturbare il cliente
  }
});

// GET /api/menu/:restaurantSlug — menu pubblico per il QR chat
router.get('/:restaurantSlug', async (req, res) => {
  try {
    const { restaurantSlug } = req.params;

    const restaurant = await db.query(
      'SELECT id, name, languages, currency, logo_url, primary_color, background_color, ai_name, font_family, instagram_url FROM restaurants WHERE slug = $1',
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
    const modello = await scegliModello(groq, groqKey || process.env.GROQ_API_KEY || '');
    if (!modello) return res.status(503).json({ error: 'Traduzione non disponibile: chiave Groq mancante o non valida' });
    const msg = await groq.chat.completions.create({
      model: modello,
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
    const modello = await scegliModello(groq, groqKey || process.env.GROQ_API_KEY || '');
    if (!modello) return res.status(503).json({ error: 'Traduzione non disponibile: chiave Groq mancante o non valida' });
    const msg = await groq.chat.completions.create({
      model: modello,
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

    // Traduzioni gia' salvate in dish_translations (riempite una volta sola dallo
    // script translate-menu). Se per un piatto manca la traduzione si mostra
    // l'originale: il menu non resta mai vuoto ne' a meta'.
    const result = await db.query(
      `SELECT d.id,
              COALESCE(NULLIF(t.name, ''), d.name)               AS name,
              COALESCE(NULLIF(t.description, ''), d.description) AS description,
              d.price, d.category, d.available,
              COALESCE(NULLIF(ct.name, ''), d.category)          AS category_label
       FROM dishes d
       JOIN restaurants r ON r.id = d.restaurant_id
       LEFT JOIN dish_translations t ON t.dish_id = d.id AND t.lang = $2
       LEFT JOIN category_translations ct
              ON ct.restaurant_id = r.id AND ct.category = d.category AND ct.lang = $2
       WHERE r.slug = $1 AND d.available = true
       ORDER BY d.category, d.name`,
      [restaurantSlug, lang]
    );

    res.json(result.rows);
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
router.post('/:restaurantSlug/dishes', requireAuth, requireOwnSlug, async (req, res) => {
  try {
    const restaurantSlug = String(req.params.restaurantSlug);
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

    const nuovo = result.rows[0];

    // Traduce subito il piatto appena creato in tutte le lingue attive:
    // se qualcosa va storto il piatto resta comunque salvato.
    let traduzioni = 0;
    try {
      const { base, lingue } = await lingueDelRistorante(restaurant.rows[0].id);
      const key = await getRestaurantGroqKey(restaurantSlug);
      const esito = await traduciESalva(
        [{ id: nuovo.id, name: nuovo.name, description: nuovo.description }], base, lingue, key
      );
      traduzioni = esito.scritte;
    } catch (e) { console.error('Traduzione non riuscita:', e); }

    res.status(201).json({ ...nuovo, traduzioni });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/menu/:restaurantSlug/dishes/:dishId — aggiorna disponibilità
router.patch('/:restaurantSlug/dishes/:dishId', requireAuth, requireOwnSlug, async (req, res) => {
  try {
    const restaurantSlug = String(req.params.restaurantSlug);
    const dishId = String(req.params.dishId);
    const { available, price, description, name, category, cost } = req.body;

    // Verifica che il piatto appartenga al ristorante indicato nello slug
    const ownership = await db.query(
      `SELECT d.id FROM dishes d
       JOIN restaurants r ON r.id = d.restaurant_id
       WHERE d.id = $1 AND r.slug = $2`,
      [dishId, restaurantSlug]
    );
    if (ownership.rows.length === 0) {
      return res.status(404).json({ error: 'Dish not found for this restaurant' });
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (available !== undefined) { fields.push(`available = $${idx++}`); values.push(available); }
    if (price !== undefined) { fields.push(`price = $${idx++}`); values.push(price); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category); }
    if (cost !== undefined) { fields.push(`cost = $${idx++}`); values.push(cost); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(dishId);
    const result = await db.query(
      `UPDATE dishes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    const piatto = result.rows[0];

    // Se e' cambiato il testo, le vecchie traduzioni non valgono piu': si rifanno.
    let traduzioni = 0;
    if (name !== undefined || description !== undefined) {
      try {
        await db.query(
          `DELETE FROM dish_translations WHERE dish_id = $1 AND source IS DISTINCT FROM 'manual'`,
          [dishId]
        );
        const { base, lingue } = await lingueDelRistorante(piatto.restaurant_id);
        const key = await getRestaurantGroqKey(restaurantSlug);
        const esito = await traduciESalva(
          [{ id: piatto.id, name: piatto.name, description: piatto.description }], base, lingue, key
        );
        traduzioni = esito.scritte;
      } catch (e) { console.error('Traduzione non riuscita:', e); }
    }

    res.json({ ...piatto, traduzioni });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/menu/:restaurantSlug/info — dati del ristorante per la dashboard
router.get('/:restaurantSlug/info', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, name, slug, languages, currency, logo_url, primary_color, background_color, base_lang, ai_name, font_family
       FROM restaurants WHERE slug = $1`,
      [req.params.restaurantSlug]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Ristorante non trovato' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/menu/:restaurantSlug/dishes/:dishId — elimina un piatto
router.delete('/:restaurantSlug/dishes/:dishId', requireAuth, requireOwnSlug, async (req, res) => {
  try {
    const { restaurantSlug, dishId } = req.params;
    const result = await db.query(
      `DELETE FROM dishes d
       USING restaurants r
       WHERE d.restaurant_id = r.id AND d.id = $1 AND r.slug = $2
       RETURNING d.id`,
      [dishId, restaurantSlug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Piatto non trovato' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  Gestione traduzioni (per la dashboard del ristoratore)
// ─────────────────────────────────────────────────────────────

// GET /api/menu/:slug/translations?lang=xx — elenco piatti con la traduzione
router.get('/:restaurantSlug/translations', requireAuth, requireOwnSlug, async (req, res) => {
  try {
    const { restaurantSlug } = req.params;
    const lang = String(req.query.lang || 'en');
    const result = await db.query(
      `SELECT d.id, d.name AS original_name, d.description AS original_description,
              t.name AS name, t.description AS description, t.source
       FROM dishes d
       JOIN restaurants r ON r.id = d.restaurant_id
       LEFT JOIN dish_translations t ON t.dish_id = d.id AND t.lang = $2
       WHERE r.slug = $1
       ORDER BY d.category, d.name`,
      [restaurantSlug, lang]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/menu/:slug/translations/:dishId/:lang — correzione a mano
// Viene salvata come definitiva: nessuna traduzione automatica la sovrascrivera'.
router.put('/:restaurantSlug/translations/:dishId/:lang', requireAuth, requireOwnSlug, async (req, res) => {
  try {
    const { restaurantSlug, dishId, lang } = req.params;
    const { name, description } = req.body;

    const ownership = await db.query(
      `SELECT d.id FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id
       WHERE d.id = $1 AND r.slug = $2`, [dishId, restaurantSlug]
    );
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Piatto non trovato' });

    await db.query(
      `INSERT INTO dish_translations (dish_id, lang, name, description, source)
       VALUES ($1, $2, $3, $4, 'manual')
       ON CONFLICT (dish_id, lang) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description,
             source = 'manual', updated_at = NOW()`,
      [dishId, lang, name ?? '', description ?? '']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/menu/:slug/translations/refresh — riempie le traduzioni mancanti
// di tutto il menu. Utile dopo un caricamento massivo di piatti.
router.post('/:restaurantSlug/translations/refresh', requireAuth, requireOwnSlug, async (req, res) => {
  try {
    const restaurantSlug = String(req.params.restaurantSlug);
    const r = await db.query('SELECT id FROM restaurants WHERE slug = $1', [restaurantSlug]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Ristorante non trovato' });
    const restaurantId = r.rows[0].id;

    const { base, lingue } = await lingueDelRistorante(restaurantId);
    const daFare = (req.body?.langs as string[] | undefined)?.filter(l => TUTTE_LE_LINGUE.includes(l)) ?? lingue;

    // Solo i piatti a cui manca almeno una lingua, al massimo 25 per chiamata
    // (le funzioni online hanno un tempo massimo di esecuzione).
    const mancanti = await db.query(
      `SELECT d.id, d.name, d.description
       FROM dishes d
       WHERE d.restaurant_id = $1
         AND EXISTS (
           SELECT 1 FROM unnest($2::text[]) AS l(lang)
           WHERE l.lang <> $3
             AND NOT EXISTS (
               SELECT 1 FROM dish_translations t
               WHERE t.dish_id = d.id AND t.lang = l.lang AND t.name <> ''
             )
         )
       ORDER BY d.category, d.name
       LIMIT 25`,
      [restaurantId, daFare, base]
    );

    if (mancanti.rows.length === 0) return res.json({ completato: true, tradotti: 0, rimanenti: 0 });

    const key = await getRestaurantGroqKey(restaurantSlug);
    const esito = await traduciESalva(mancanti.rows, base, daFare, key);

    res.json({
      completato: false,
      tradotti: mancanti.rows.length,
      scritte: esito.scritte,
      errore: esito.errore,
      nota: 'Rilancia finche non risponde completato: true',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
