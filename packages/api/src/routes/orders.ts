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

export default router;
