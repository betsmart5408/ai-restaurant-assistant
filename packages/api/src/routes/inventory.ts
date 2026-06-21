import { Router } from 'express';
import { db } from '../db/client';
import { getStockAlerts, restockIngredient } from '../services/inventory';

const router = Router();

// GET /api/inventory/:restaurantId/alerts
router.get('/:restaurantId/alerts', async (req, res) => {
  try {
    const alerts = await getStockAlerts(req.params.restaurantId);
    res.json(alerts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/:restaurantId — lista completa ingredienti
router.get('/:restaurantId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, unit, current_qty, min_threshold, cost_per_unit, expiry_date
       FROM ingredients WHERE restaurant_id = $1 ORDER BY name`,
      [req.params.restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/:restaurantId/restock — ricarica ingrediente
router.post('/:restaurantId/restock', async (req, res) => {
  try {
    const { ingredient_id, qty } = req.body;
    await restockIngredient(req.params.restaurantId, ingredient_id, qty);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/inventory/:restaurantId/ingredients/:ingredientId — aggiorna soglia/scadenza
router.patch('/:restaurantId/ingredients/:ingredientId', async (req, res) => {
  try {
    const { ingredientId } = req.params;
    const { min_threshold, expiry_date, cost_per_unit } = req.body;

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (min_threshold !== undefined) { fields.push(`min_threshold = $${idx++}`); values.push(min_threshold); }
    if (expiry_date !== undefined) { fields.push(`expiry_date = $${idx++}`); values.push(expiry_date); }
    if (cost_per_unit !== undefined) { fields.push(`cost_per_unit = $${idx++}`); values.push(cost_per_unit); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(ingredientId);
    const result = await db.query(
      `UPDATE ingredients SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
