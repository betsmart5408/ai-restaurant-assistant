import { Router } from 'express';
import { db } from '../db/client';
import { deductInventory } from '../services/inventory';

const router = Router();

// POST /api/orders — crea ordine da chat
router.post('/', async (req, res) => {
  const client = await db.connect();
  try {
    const { restaurant_id, table_id, session_id, items, language } = req.body;

    await client.query('BEGIN');

    const total = items.reduce(
      (sum: number, item: { unit_price: number; qty: number }) =>
        sum + item.unit_price * item.qty,
      0
    );

    const order = await client.query(
      `INSERT INTO orders (restaurant_id, table_id, session_id, total, language, status)
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED')
       RETURNING *`,
      [restaurant_id, table_id, session_id, total, language]
    );

    const orderId = order.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, dish_id, dish_name, qty, unit_price, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.dish_id, item.dish_name, item.qty, item.unit_price, item.note ?? null]
      );

      // Scala magazzino per ogni unità ordinata
      await deductInventory(client, restaurant_id, item.dish_id, item.qty, orderId);
    }

    // Aggiorna sessione chat con l'ordine
    await client.query(
      'UPDATE chat_sessions SET order_id = $1 WHERE id = $2',
      [orderId, session_id]
    );

    await client.query('COMMIT');

    res.status(201).json({ ...order.rows[0], items });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
});

// GET /api/orders/kitchen/:restaurantId — ordini attivi per cucina
router.get('/kitchen/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const orders = await db.query(
      `SELECT o.id, o.status, o.created_at, o.language, o.notes,
              t.number as table_number,
              json_agg(json_build_object(
                'name', oi.dish_name,
                'qty', oi.qty,
                'note', oi.note
              ) ORDER BY oi.created_at) as items
       FROM orders o
       JOIN tables t ON t.id = o.table_id
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.restaurant_id = $1
         AND o.status IN ('CONFIRMED', 'IN_KITCHEN')
       GROUP BY o.id, t.number
       ORDER BY o.created_at ASC`,
      [restaurantId]
    );

    res.json(orders.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/orders/:orderId/status — aggiorna stato ordine
router.patch('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ['PENDING', 'CONFIRMED', 'IN_KITCHEN', 'READY', 'SERVED', 'PAID'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, orderId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
