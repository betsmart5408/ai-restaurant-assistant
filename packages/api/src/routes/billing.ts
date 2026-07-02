import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2026-06-24.dahlia' });
const PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5174';

// POST /api/billing/checkout — crea sessione Stripe Checkout
router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT id, name, billing_email, stripe_customer_id FROM restaurants WHERE id = $1',
      [req.auth!.restaurantId]
    );
    const rest = result.rows[0];
    if (!rest) return res.status(404).json({ error: 'Ristorante non trovato' });

    let customerId = rest.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: rest.billing_email ?? req.body.email,
        name: rest.name,
        metadata: { restaurant_id: rest.id },
      });
      customerId = customer.id;
      await db.query('UPDATE restaurants SET stripe_customer_id = $1 WHERE id = $2', [customerId, rest.id]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${APP_URL}/dashboard?billing=success`,
      cancel_url: `${APP_URL}/dashboard?billing=cancelled`,
      metadata: { restaurant_id: rest.id },
    });

    res.json({ url: session.url });
  } catch (err: unknown) {
    console.error('Billing checkout error:', err);
    res.status(500).json({ error: 'Errore creazione checkout' });
  }
});

// POST /api/billing/portal — apre il portale clienti Stripe
router.post('/portal', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await db.query(
      'SELECT stripe_customer_id FROM restaurants WHERE id = $1',
      [req.auth!.restaurantId]
    );
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'Nessun abbonamento attivo' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/dashboard`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Errore portale billing' });
  }
});

// GET /api/billing/status — stato abbonamento corrente
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const result = await db.query(
    `SELECT plan, subscription_status, trial_ends_at, monthly_price, suspended_at
     FROM restaurants WHERE id = $1`,
    [req.auth!.restaurantId]
  );
  res.json(result.rows[0] ?? {});
});

// POST /api/billing/webhook — webhook Stripe (raw body)
router.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch {
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  const meta = (event.data.object as { metadata?: { restaurant_id?: string } }).metadata;
  const restaurantId = meta?.restaurant_id;

  try {
    await db.query(
      `INSERT INTO billing_events (restaurant_id, stripe_event_id, event_type, status)
       VALUES ($1, $2, $3, 'received') ON CONFLICT (stripe_event_id) DO NOTHING`,
      [restaurantId ?? null, event.id, event.type]
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription && session.metadata?.restaurant_id) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await db.query(
            `UPDATE restaurants SET
               stripe_subscription_id = $1,
               subscription_status = 'active',
               plan = 'pro',
               suspended_at = NULL
             WHERE id = $2`,
            [sub.id, session.metadata.restaurant_id]
          );
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = (inv as { subscription?: string }).subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const rid = sub.metadata?.restaurant_id;
          if (rid) {
            await db.query(
              `UPDATE restaurants SET subscription_status='active', suspended_at=NULL WHERE id=$1`,
              [rid]
            );
            await db.query(
              `UPDATE billing_events SET amount=$1, status='paid' WHERE stripe_event_id=$2`,
              [(inv.amount_paid / 100).toFixed(2), event.id]
            );
          }
        }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const subId = (inv as { subscription?: string }).subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const rid = sub.metadata?.restaurant_id;
          if (rid) {
            await db.query(
              `UPDATE restaurants SET subscription_status='past_due' WHERE id=$1`, [rid]
            );
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const rid = sub.metadata?.restaurant_id;
        if (rid) {
          await db.query(
            `UPDATE restaurants SET subscription_status='cancelled', suspended_at=NOW() WHERE id=$1`,
            [rid]
          );
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Processing error' });
  }
});

export default router;
