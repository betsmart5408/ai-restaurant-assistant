import { Router } from 'express';
import { checkStockAlerts, checkExpiryAlerts, sendDailySummary } from '../services/alerts';
import { sendWhatsApp } from '../services/whatsapp';
import { db } from '../db/client';

const router = Router();

// POST /api/alerts/test-whatsapp — invia messaggio di test
router.post('/test-whatsapp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const ok = await sendWhatsApp(phone, '✅ *Test AI Restaurant Assistant*\n\nWhatsApp configurato correttamente! Gli alert automatici sono attivi.');
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/alerts/trigger/stock — forza controllo stock ora
router.post('/trigger/stock', async (_req, res) => {
  try {
    await checkStockAlerts();
    res.json({ success: true, message: 'Stock check completato' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/alerts/trigger/expiry — forza controllo scadenze ora
router.post('/trigger/expiry', async (_req, res) => {
  try {
    await checkExpiryAlerts();
    res.json({ success: true, message: 'Expiry check completato' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/alerts/trigger/summary — forza riepilogo serale ora
router.post('/trigger/summary', async (_req, res) => {
  try {
    await sendDailySummary();
    res.json({ success: true, message: 'Riepilogo inviato' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/alerts/expiry/:restaurantId/:ingredientId — imposta scadenza per test
router.patch('/expiry/:restaurantId/:ingredientId', async (req, res) => {
  try {
    const { restaurantId, ingredientId } = req.params;
    const { expiry_date } = req.body;

    await db.query(
      'UPDATE ingredients SET expiry_date = $1 WHERE id = $2 AND restaurant_id = $3',
      [expiry_date, ingredientId, restaurantId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
