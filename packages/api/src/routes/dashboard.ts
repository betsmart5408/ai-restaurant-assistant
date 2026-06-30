import { Router } from 'express';
import { db } from '../db/client';

const router = Router();

// GET /api/dashboard/:restaurantId/today — KPI giornalieri
router.get('/:restaurantId/today', async (req, res) => {
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
router.get('/:restaurantId/weekly', async (req, res) => {
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
router.get('/:restaurantId/margins', async (req, res) => {
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
router.get('/:restaurantId/settings', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT groq_api_key FROM restaurants WHERE id = $1`,
      [req.params.restaurantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const key = result.rows[0].groq_api_key;
    // Maschera la chiave per sicurezza
    res.json({ groq_api_key: key ? `${key.slice(0, 8)}${'•'.repeat(20)}` : null, has_key: !!key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dashboard/:restaurantId/settings — salva API key
router.put('/:restaurantId/settings', async (req, res) => {
  try {
    const { groq_api_key } = req.body;
    if (!groq_api_key || !groq_api_key.startsWith('gsk_')) {
      return res.status(400).json({ error: 'Chiave non valida. Deve iniziare con gsk_' });
    }
    await db.query(
      `UPDATE restaurants SET groq_api_key = $1 WHERE id = $2`,
      [groq_api_key.trim(), req.params.restaurantId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
