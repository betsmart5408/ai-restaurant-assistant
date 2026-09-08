import { Router } from 'express';
import { db } from '../db/client';
import { requireAuth, requireOwnRestaurant } from '../middleware/auth';

const router = Router();

// Accetta "@nome", "instagram.com/nome", un URL intero o vuoto.
// Restituisce sempre "https://instagram.com/<nome>" oppure null.
function normalizzaInstagram(v: unknown): string | null {
  let s = (v ?? '').toString().trim();
  if (!s) return null;
  s = s.replace(/^@/, '');
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = m ? m[1] : (/^[A-Za-z0-9._]+$/.test(s) ? s : '');
  if (!handle || handle.length > 30) return null;
  return `https://instagram.com/${handle}`;
}

// GET /api/dashboard/:restaurantId/today — KPI giornalieri
router.get('/:restaurantId/today', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const today = await db.query(
      `SELECT
         COUNT(DISTINCT o.id) as orders_count,
         COUNT(DISTINCT o.table_id) as tables_served,
         COALESCE(SUM(o.total), 0) as revenue,
         COALESCE(AVG(o.total), 0) as avg_order
       FROM orders o
       WHERE o.restaurant_id = $1
         AND o.created_at >= CURRENT_DATE
         AND o.status != 'PENDING'`,
      [restaurantId]
    );

    const lastWeekSameDay = await db.query(
      `SELECT COALESCE(AVG(o.total), 0) as avg_order
       FROM orders o
       WHERE o.restaurant_id = $1
         AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'
         AND o.created_at < CURRENT_DATE - INTERVAL '6 days'
         AND o.status != 'PENDING'`,
      [restaurantId]
    );

    const activeOrders = await db.query(
      `SELECT COUNT(*) as count FROM orders
       WHERE restaurant_id = $1 AND status IN ('CONFIRMED', 'IN_KITCHEN', 'READY')`,
      [restaurantId]
    );

    const topDishes = await db.query(
      `SELECT oi.dish_name, SUM(oi.qty) as qty_sold, SUM(oi.qty * oi.unit_price) as revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.restaurant_id = $1 AND o.created_at >= CURRENT_DATE
       GROUP BY oi.dish_name
       ORDER BY qty_sold DESC
       LIMIT 5`,
      [restaurantId]
    );

    const stockAlerts = await db.query(
      `SELECT COUNT(*) FILTER (WHERE current_qty <= 0) as critical,
              COUNT(*) FILTER (WHERE current_qty > 0 AND current_qty <= min_threshold) as warning
       FROM ingredients WHERE restaurant_id = $1`,
      [restaurantId]
    );

    res.json({
      today: today.rows[0],
      last_week_avg_order: parseFloat(lastWeekSameDay.rows[0].avg_order),
      active_orders: parseInt(activeOrders.rows[0].count),
      top_dishes: topDishes.rows,
      stock_alerts: stockAlerts.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/:restaurantId/weekly — andamento settimanale
router.get('/:restaurantId/weekly', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const result = await db.query(
      `SELECT
         DATE(o.created_at) as date,
         COUNT(DISTINCT o.id) as orders,
         COALESCE(SUM(o.total), 0) as revenue,
         COALESCE(AVG(o.total), 0) as avg_order
       FROM orders o
       WHERE o.restaurant_id = $1
         AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'
         AND o.status != 'PENDING'
       GROUP BY DATE(o.created_at)
       ORDER BY date ASC`,
      [restaurantId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/:restaurantId/margins — margini per piatto
router.get('/:restaurantId/margins', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const result = await db.query(
      `SELECT
         d.id, d.name, d.price, d.cost, d.category,
         CASE WHEN d.price > 0 THEN ROUND((1 - d.cost/d.price) * 100, 1) ELSE 0 END as margin_pct,
         COALESCE(SUM(oi.qty), 0) as sold_last_30d,
         COALESCE(SUM(oi.qty * (oi.unit_price - d.cost)), 0) as profit_last_30d
       FROM dishes d
       LEFT JOIN order_items oi ON oi.dish_id = d.id
       LEFT JOIN orders o ON o.id = oi.order_id
         AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
         AND o.status != 'PENDING'
       WHERE d.restaurant_id = $1
       GROUP BY d.id
       ORDER BY profit_last_30d DESC`,
      [restaurantId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/:restaurantId/settings — legge impostazioni
router.get('/:restaurantId/settings', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT groq_api_key, ai_name FROM restaurants WHERE id = $1`,
      [req.params.restaurantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const key = result.rows[0].groq_api_key;
    // Maschera la chiave per sicurezza
    res.json({
      groq_api_key: key ? `${key.slice(0, 8)}${'•'.repeat(20)}` : null,
      has_key: !!key,
      ai_name: result.rows[0].ai_name || 'Marco',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dashboard/:restaurantId/settings — salva API key
router.put('/:restaurantId/settings', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const { groq_api_key, ai_name } = req.body;

    const campi: string[] = [];
    const valori: unknown[] = [];
    let i = 1;

    if (groq_api_key !== undefined && groq_api_key !== '') {
      if (!String(groq_api_key).startsWith('gsk_')) {
        return res.status(400).json({ error: 'Chiave non valida. Deve iniziare con gsk_' });
      }
      campi.push(`groq_api_key = $${i++}`); valori.push(String(groq_api_key).trim());
    }

    if (ai_name !== undefined) {
      const nome = String(ai_name).trim();
      if (nome.length > 30) return res.status(400).json({ error: 'Il nome e\' troppo lungo (massimo 30 caratteri)' });
      // vuoto = torna al nome predefinito
      campi.push(`ai_name = $${i++}`); valori.push(nome || 'Marco');
    }

    if (campi.length === 0) return res.status(400).json({ error: 'Niente da salvare' });

    valori.push(req.params.restaurantId);
    await db.query(`UPDATE restaurants SET ${campi.join(', ')} WHERE id = $${i}`, valori);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/:restaurantId/appearance — colori attuali
router.get('/:restaurantId/appearance', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT primary_color, background_color, font_family FROM restaurants WHERE id = $1',
      [req.params.restaurantId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dashboard/:restaurantId/appearance — salva i colori
router.put('/:restaurantId/appearance', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const { primary_color, background_color, font_family } = req.body;
    const CARATTERI = ['system', 'Inter', 'Poppins', 'Montserrat', 'Lora', 'Playfair Display', 'Caveat'];
    const valido = (c: unknown) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

    const campi: string[] = [];
    const valori: unknown[] = [];
    let i = 1;
    if (primary_color !== undefined) {
      if (!valido(primary_color)) return res.status(400).json({ error: 'Colore principale non valido (usa il formato #rrggbb)' });
      campi.push(`primary_color = $${i++}`); valori.push(primary_color);
    }
    if (background_color !== undefined) {
      if (!valido(background_color)) return res.status(400).json({ error: 'Colore di sfondo non valido (usa il formato #rrggbb)' });
      campi.push(`background_color = $${i++}`); valori.push(background_color);
    }
    if (font_family !== undefined) {
      if (!CARATTERI.includes(String(font_family))) {
        return res.status(400).json({ error: 'Carattere non ammesso' });
      }
      campi.push(`font_family = $${i++}`); valori.push(String(font_family));
    }

    if (campi.length === 0) return res.status(400).json({ error: 'Niente da salvare' });

    valori.push(req.params.restaurantId);
    await db.query(`UPDATE restaurants SET ${campi.join(', ')} WHERE id = $${i}`, valori);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/:restaurantId/locale — dati del locale
router.get('/:restaurantId/locale', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT city, country, cuisine_type, about, timezone, latitude, longitude, instagram_url
       FROM restaurants WHERE id = $1`,
      [req.params.restaurantId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/cerca-citta?q=... — elenco di citta' vere fra cui scegliere
// Nessuno deve digitare il paese o il fuso orario a mano: si sceglie dalla lista.
router.get('/cerca-citta', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ risultati: [] });
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=it&format=json`;
    const risposta = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    const dati: any = await risposta.json();
    const risultati = (Array.isArray(dati?.results) ? dati.results : []).map((r: any) => ({
      city: r.name,
      region: r.admin1 ?? null,
      country: r.country ?? null,
      timezone: r.timezone ?? null,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      etichetta: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    }));
    res.json({ risultati });
  } catch {
    res.json({ risultati: [], errore: 'Ricerca non disponibile in questo momento' });
  }
});

// PUT /api/dashboard/:restaurantId/locale — salva il locale.
// La citta' arriva gia' scelta dalla lista, con coordinate e fuso: qui non si
// indovina piu' niente.
router.put('/:restaurantId/locale', requireAuth, requireOwnRestaurant, async (req, res) => {
  try {
    const { city, region, country, timezone, latitude, longitude, cuisine_type, about, instagram_url } = req.body;

    const coordinateValide =
      typeof latitude === 'number' && typeof longitude === 'number' &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

    await db.query(
      `UPDATE restaurants
       SET city = $1, country = $2, cuisine_type = $3, about = $4,
           latitude = $5, longitude = $6,
           timezone = COALESCE($7, timezone),
           instagram_url = $8
       WHERE id = $9`,
      [
        (city ?? '').toString().trim() || null,
        (country ?? '').toString().trim() || null,
        (cuisine_type ?? '').toString().trim() || null,
        (about ?? '').toString().trim() || null,
        coordinateValide ? latitude : null,
        coordinateValide ? longitude : null,
        (timezone ?? '').toString().trim() || null,
        normalizzaInstagram(instagram_url),
        req.params.restaurantId,
      ]
    );

    res.json({ success: true, completo: coordinateValide });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
