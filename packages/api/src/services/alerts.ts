import cron from 'node-cron';
import { db } from '../db/client';
import { controllaProve } from './prova';
import {
  sendWhatsApp,
  msgStockCritical,
  msgStockWarning,
  msgExpiryAlert,
  msgDailySummary,
} from './whatsapp';
import { pregeneraConsigli } from './pregenera';
import { cancellaChatVecchie } from './pulizia';

interface Restaurant {
  id: string;
  name: string;
  whatsapp: string;
}

// checkStockAlerts gira ogni ora: senza un cooldown, un ingrediente che resta
// sotto soglia per giorni manda lo stesso WhatsApp ogni ora, all'infinito
// (costo Twilio + alert fatigue per il ristoratore). Un ingrediente che
// peggiora da 'warning' a 'critical' deve comunque poter riavvisare subito.
const COOLDOWN_ALERT_MS = 12 * 60 * 60 * 1000; // 12 ore
const ultimoAlert = new Map<string, { level: 'critical' | 'warning'; at: number }>();

function deveAvvisare(restaurantId: string, ingredientId: string, level: 'critical' | 'warning'): boolean {
  const key = `${restaurantId}:${ingredientId}`;
  const prev = ultimoAlert.get(key);
  const ora = Date.now();
  const escalation = prev?.level === 'warning' && level === 'critical';
  if (prev && !escalation && ora - prev.at < COOLDOWN_ALERT_MS) return false;
  ultimoAlert.set(key, { level, at: ora });
  return true;
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
        if (deveAvvisare(restaurant.id, ing.id, 'critical')) {
          await sendWhatsApp(restaurant.whatsapp, msgStockCritical(restaurant.name, ing.name, qty, ing.unit));
        }
      } else if (qty <= threshold) {
        const hoursLeft = await estimateHoursLeft(restaurant.id, ing.id, qty);
        if (hoursLeft !== undefined && hoursLeft <= 3) {
          if (deveAvvisare(restaurant.id, ing.id, 'critical')) {
            await sendWhatsApp(restaurant.whatsapp, msgStockCritical(restaurant.name, ing.name, qty, ing.unit, hoursLeft));
          }
        } else if (deveAvvisare(restaurant.id, ing.id, 'warning')) {
          await sendWhatsApp(restaurant.whatsapp, msgStockWarning(restaurant.name, ing.name, qty, ing.unit));
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
        msgExpiryAlert(restaurant.name, ing.name, parseFloat(ing.current_qty), ing.unit, ing.days_left)
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
    await sendWhatsApp(restaurant.whatsapp, msgDailySummary(restaurant.name, {
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
  // Fine prova gratuita: promemoria, scadenza, pausa del menu
  cron.schedule('15 * * * *', () =>
    controllaProve().catch(err => console.error('Controllo prove error:', err))
  );
  // Le conversazioni vecchie si cancellano: dentro ci sono clienti che hanno
  // scritto le loro allergie, e dopo il pasto non servono piu' a nessuno.
  // Le statistiche stanno aggregate altrove e non si toccano.
  cron.schedule('0 4 * * *', () =>
    cancellaChatVecchie().catch(err => console.error('Pulizia chat error:', err))
  );
  // Consigli pronti scritti di notte, quando nessuno e' a tavola: il primo
  // cliente del giorno non aspetta e non consuma le sue domande al modello
  // per una risposta che poi leggeranno gratis tutti gli altri.
  cron.schedule('30 4 * * *', () =>
    pregeneraConsigli({ tutti: true }).catch(err => console.error('Pregenerazione consigli error:', err))
  );

  console.log('✅ Scheduler: stock/ora · scadenze/8:00 · riepilogo/22:00 · report/lunedì-8:30 · pulizia chat/4:00 · consigli/4:30');
}
