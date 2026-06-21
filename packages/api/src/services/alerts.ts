import cron from 'node-cron';
import { db } from '../db/client';
import {
  sendWhatsApp,
  msgStockCritical,
  msgStockWarning,
  msgExpiryAlert,
  msgDailySummary,
} from './whatsapp';

interface Restaurant {
  id: string;
  name: string;
  whatsapp: string;
}

async function estimateHoursLeft(restaurantId: string, ingredientId: string, currentQty: number): Promise<number | undefined> {
  const result = await db.query(
    `SELECT ABS(SUM(qty_delta)) as consumed
     FROM inventory_movements
     WHERE restaurant_id = $1
       AND ingredient_id = $2
       AND qty_delta < 0
       AND created_at >= NOW() - INTERVAL '4 hours'`,
    [restaurantId, ingredientId]
  );
  const consumed = parseFloat(result.rows[0]?.consumed ?? 0);
  if (consumed === 0) return undefined;
  return Math.round(currentQty / (consumed / 4));
}

// ── Controllo stock ogni ora ─────────────────────────────────
export async function checkStockAlerts() {
  const restaurants = await db.query<Restaurant>(
    'SELECT id, name, whatsapp FROM restaurants WHERE whatsapp IS NOT NULL'
  );
  for (const restaurant of restaurants.rows) {
    const ingredients = await db.query(
      'SELECT id, name, current_qty, min_threshold, unit FROM ingredients WHERE restaurant_id = $1',
      [restaurant.id]
    );
    for (const ing of ingredients.rows) {
      const qty = parseFloat(ing.current_qty);
      const threshold = parseFloat(ing.min_threshold);
      if (qty <= 0) {
        await sendWhatsApp(restaurant.whatsapp, msgStockCritical(ing.name, qty, ing.unit));
      } else if (qty <= threshold) {
        const hoursLeft = await estimateHoursLeft(restaurant.id, ing.id, qty);
        if (hoursLeft !== undefined && hoursLeft <= 3) {
          await sendWhatsApp(restaurant.whatsapp, msgStockCritical(ing.name, qty, ing.unit, hoursLeft));
        } else {
          await sendWhatsApp(restaurant.whatsapp, msgStockWarning(ing.name, qty, ing.unit));
        }
      }
    }
  }
}

// ── Controllo scadenze ogni mattina alle 8:00 ────────────────
export async function checkExpiryAlerts() {
  const restaurants = await db.query<Restaurant>(
    'SELECT id, name, whatsapp FROM restaurants WHERE whatsapp IS NOT NULL'
  );
  for (const restaurant of restaurants.rows) {
    const expiring = await db.query(
      `SELECT name, current_qty, unit, (expiry_date::date - CURRENT_DATE) as days_left
       FROM ingredients
       WHERE restaurant_id = $1
         AND expiry_date IS NOT NULL
         AND expiry_date <= CURRENT_DATE + INTERVAL '2 days'
         AND current_qty > 0
       ORDER BY expiry_date ASC`,
      [restaurant.id]
    );
    for (const ing of expiring.rows) {
      await sendWhatsApp(
        restaurant.whatsapp,
        msgExpiryAlert(ing.name, parseFloat(ing.current_qty), ing.unit, ing.days_left)
      );
    }
  }
}

// ── Riepilogo serale alle 22:00 ──────────────────────────────
export async function sendDailySummary() {
  const restaurants = await db.query<Restaurant>(
    'SELECT id, name, whatsapp FROM restaurants WHERE whatsapp IS NOT NULL'
  );
  for (const restaurant of restaurants.rows) {
    const today = await db.query(
      `SELECT COALESCE(SUM(total), 0)::float as revenue,
              COUNT(*)::int as orders,
              COALESCE(AVG(total), 0)::float as avg_order
       FROM orders
       WHERE restaurant_id = $1 AND created_at >= CURRENT_DATE AND status != 'PENDING'`,
      [restaurant.id]
    );
    const yesterday = await db.query(
      `SELECT COALESCE(AVG(total), 0)::float as avg_order
       FROM orders
       WHERE restaurant_id = $1
         AND created_at >= CURRENT_DATE - INTERVAL '1 day'
         AND created_at < CURRENT_DATE AND status != 'PENDING'`,
      [restaurant.id]
    );
    const topDish = await db.query(
      `SELECT oi.dish_name FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.restaurant_id = $1 AND o.created_at >= CURRENT_DATE
       GROUP BY oi.dish_name ORDER BY SUM(oi.qty) DESC LIMIT 1`,
      [restaurant.id]
    );
    const critical = await db.query(
      'SELECT COUNT(*)::int as count FROM ingredients WHERE restaurant_id = $1 AND current_qty <= min_threshold',
      [restaurant.id]
    );
    const r = today.rows[0];
    await sendWhatsApp(restaurant.whatsapp, msgDailySummary({
      revenue: r.revenue,
      orders: r.orders,
      avgOrder: r.avg_order,
      avgOrderDelta: r.avg_order - yesterday.rows[0].avg_order,
      topDish: topDish.rows[0]?.dish_name ?? 'N/D',
      criticalIngredients: critical.rows[0].count,
    }));
  }
}

// ── Report PDF ogni lunedì alle 8:30 ────────────────────────
export async function sendWeeklyReport() {
  const { generateWeeklyReport } = await import('./report');
  const restaurants = await db.query<Restaurant>(
    'SELECT id, name, whatsapp FROM restaurants WHERE whatsapp IS NOT NULL'
  );
  for (const restaurant of restaurants.rows) {
    try {
      const pdf = await generateWeeklyReport(restaurant.id);
      console.log(`[Report] PDF ${restaurant.name}: ${pdf.length} bytes — pronto per invio email/WhatsApp`);
    } catch (err) {
      console.error(`Report error for ${restaurant.name}:`, err);
    }
  }
}

// ── Avvio scheduler ──────────────────────────────────────────
export function startAlertScheduler() {
  cron.schedule('0 * * * *', () =>
    checkStockAlerts().catch(err => console.error('Stock alert error:', err))
  );
  cron.schedule('0 8 * * *', () =>
    checkExpiryAlerts().catch(err => console.error('Expiry alert error:', err))
  );
  cron.schedule('0 22 * * *', () =>
    sendDailySummary().catch(err => console.error('Daily summary error:', err))
  );
  cron.schedule('30 8 * * 1', () =>
    sendWeeklyReport().catch(err => console.error('Weekly report error:', err))
  );

  console.log('✅ Scheduler: stock/ora · scadenze/8:00 · riepilogo/22:00 · report/lunedì-8:30');
}
