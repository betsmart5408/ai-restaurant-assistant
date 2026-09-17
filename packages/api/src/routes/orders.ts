import { Router } from 'express';
import { db } from '../db/client';
import { deductInventory } from '../services/inventory';

const router = Router();

// POST /api/orders — crea ordine da chat
router.post('/', async (req, res) => {
  const { restaurant_id, table_id, session_id, items, language } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items deve essere un array non vuoto' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Prezzo e nome piatto vengono SEMPRE letti dal DB, mai fidandosi del client:
    // altrimenti chiunque potrebbe ordinare a qualsiasi prezzo (es. unit_price: 0.01).
    const dishIds = [...new Set(items.map((item: { dish_id: string }) => item.dish_id))];
    const dishesResult = await client.query(
      `SELECT id, name, price FROM dishes WHERE id = ANY($1::uuid[]) AND restaurant_id = $2 AND available = TRUE`,
      [dishIds, restaurant_id]
    );
    const dishById = new Map(dishesResult.rows.map((d) => [d.id, d]));

    const trustedItems: { dish_id: string; dish_name: string; qty: number; unit_price: number; note: string | null }[] = [];
    for (const item of items as { dish_id: string; qty: number; note?: string }[]) {
      const dish = dishById.get(item.dish_id);
      const qty = Number(item.qty);
      if (!dish || !Number.isInteger(qty) || qty <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Piatto non disponibile o quantità non valida' });
      }
      trustedItems.push({
        dish_id: dish.id,
        dish_name: dish.name,
        qty,
        unit_price: parseFloat(dish.price),
        note: item.note ?? null,
      });
    }

    const total = trustedItems.reduce((sum, item) => sum + item.unit_price * item.qty, 0);

    const order = await client.query(
      `INSERT INTO orders (restaurant_id, table_id, session_id, total, language, status)
       VALUES ($1, $2, $3, $4, $5, 'CONFIRMED')
       RETURNING *`,
      [restaurant_id, table_id, session_id, total, language]
    );

    const orderId = order.rows[0].id;

    for (const item of trustedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, dish_id, dish_name, qty, unit_price, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.dish_id, item.dish_name, item.qty, item.unit_price, item.note]
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

    res.status(201).json({ ...order.rows[0], items: trustedItems });
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

    // Questa rotta è pubblica (usata dal Kitchen Display, che non ha login):
    // NON deve poter impostare 'PAID' — quello spetta solo ai webhook POS
    // (packages/api/src/routes/pos.ts) o al dashboard autenticato del ristoratore.
    const validStatuses = ['CONFIRMED', 'IN_KITCHEN', 'READY', 'SERVED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(
      `UPDATE orders SET status = $1 WHERE id = $2 AND status != 'PAID' RETURNING *`,
      [status, orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
