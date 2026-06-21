import { Router } from 'express';
import { db } from '../db/client';

const router = Router();

// ── Webhook Square ────────────────────────────────────────────
// Square invia eventi di pagamento a questo endpoint
// Da configurare in: Square Developer Dashboard → Webhooks
router.post('/webhook/square', async (req, res) => {
  try {
    const event = req.body;

    // Square invia "payment.completed" quando il cliente paga
    if (event.type !== 'payment.completed') {
      return res.json({ ignored: true });
    }

    const payment = event.data?.object?.payment;
    if (!payment) return res.status(400).json({ error: 'Invalid payload' });

    const amountCents = payment.amount_money?.amount ?? 0;
    const amountEuro = amountCents / 100;
    const squarePaymentId = payment.id;
    const locationId = payment.location_id;

    // Trova il ristorante tramite il location_id Square configurato
    const restaurant = await db.query(
      `SELECT id FROM restaurants WHERE pos_config->>'square_location_id' = $1`,
      [locationId]
    );

    if (restaurant.rows.length === 0) {
      return res.json({ ignored: true, reason: 'Unknown location_id' });
    }

    const restaurantId = restaurant.rows[0].id;

    // Trova l'ordine aperto più recente con lo stesso totale (±5 cent di tolleranza)
    const order = await db.query(
      `SELECT id FROM orders
       WHERE restaurant_id = $1
         AND status IN ('CONFIRMED', 'IN_KITCHEN', 'READY', 'SERVED')
         AND ABS(total - $2) < 0.10
       ORDER BY created_at DESC LIMIT 1`,
      [restaurantId, amountEuro]
    );

    if (order.rows.length === 0) {
      console.warn(`[POS] Pagamento Square €${amountEuro} non abbinato a nessun ordine`);
      return res.json({ matched: false });
    }

    const orderId = order.rows[0].id;

    await db.query(
      `UPDATE orders SET status = 'PAID', pos_payment_id = $1 WHERE id = $2`,
      [squarePaymentId, orderId]
    );

    console.log(`[POS Square] Ordine ${orderId} → PAID (€${amountEuro})`);
    res.json({ matched: true, order_id: orderId });
  } catch (err) {
    console.error('[POS Square webhook error]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Webhook SumUp ─────────────────────────────────────────────
router.post('/webhook/sumup', async (req, res) => {
  try {
    const { event_type, payload } = req.body;

    if (event_type !== 'SUCCESSFUL') {
      return res.json({ ignored: true });
    }

    const amountEuro = parseFloat(payload?.amount ?? 0);
    const merchantCode = payload?.merchant_code;

    const restaurant = await db.query(
      `SELECT id FROM restaurants WHERE pos_config->>'sumup_merchant_code' = $1`,
      [merchantCode]
    );

    if (restaurant.rows.length === 0) return res.json({ ignored: true });

    const order = await db.query(
      `SELECT id FROM orders
       WHERE restaurant_id = $1
         AND status IN ('CONFIRMED', 'IN_KITCHEN', 'READY', 'SERVED')
         AND ABS(total - $2) < 0.10
       ORDER BY created_at DESC LIMIT 1`,
      [restaurant.rows[0].id, amountEuro]
    );

    if (order.rows.length === 0) return res.json({ matched: false });

    await db.query(
      `UPDATE orders SET status = 'PAID', pos_payment_id = $1 WHERE id = $2`,
      [payload.transaction_id, order.rows[0].id]
    );

    res.json({ matched: true, order_id: order.rows[0].id });
  } catch (err) {
    console.error('[POS SumUp webhook error]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── Webhook generico (qualsiasi POS) ─────────────────────────
// Formato: { restaurant_id, amount, payment_id, table_number? }
router.post('/webhook/generic', async (req, res) => {
  try {
    const { restaurant_id, amount, payment_id, table_number } = req.body;

    if (!restaurant_id || !amount) {
      return res.status(400).json({ error: 'restaurant_id e amount obbligatori' });
    }

    let query = `SELECT id FROM orders
       WHERE restaurant_id = $1
         AND status IN ('CONFIRMED', 'IN_KITCHEN', 'READY', 'SERVED')
         AND ABS(total - $2) < 0.10`;
    const params: (string | number)[] = [restaurant_id, amount];

    if (table_number) {
      query += ` AND table_id = (SELECT id FROM tables WHERE restaurant_id = $1 AND number = $3)`;
      params.push(table_number);
    }

    query += ' ORDER BY created_at DESC LIMIT 1';

    const order = await db.query(query, params);

    if (order.rows.length === 0) return res.json({ matched: false });

    await db.query(
      `UPDATE orders SET status = 'PAID', pos_payment_id = $1 WHERE id = $2`,
      [payment_id ?? `manual-${Date.now()}`, order.rows[0].id]
    );

    res.json({ matched: true, order_id: order.rows[0].id });
  } catch (err) {
    console.error('[POS generic webhook error]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/pos/config/:restaurantId — configurazione POS attuale
router.get('/config/:restaurantId', async (req, res) => {
  const result = await db.query(
    'SELECT pos_config FROM restaurants WHERE id = $1',
    [req.params.restaurantId]
  );
  res.json(result.rows[0]?.pos_config ?? {});
});

// PATCH /api/pos/config/:restaurantId — salva configurazione POS
router.patch('/config/:restaurantId', async (req, res) => {
  try {
    const { provider, ...config } = req.body;
    // Merge con la config esistente
    await db.query(
      `UPDATE restaurants
       SET pos_config = COALESCE(pos_config, '{}'::jsonb) || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify({ provider, ...config }), req.params.restaurantId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
