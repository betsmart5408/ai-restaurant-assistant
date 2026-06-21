import { Router } from 'express';
import { db } from '../db/client';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';

const router = Router();

router.use(requireAuth, requireSuperAdmin);

// GET /api/admin/restaurants — tutti i ristoranti
router.get('/restaurants', async (_req, res) => {
  const result = await db.query(
    `SELECT r.id, r.name, r.slug, r.created_at,
            COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days') as orders_30d,
            COALESCE(SUM(o.total) FILTER (WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'), 0) as revenue_30d,
            COUNT(DISTINCT u.id) as user_count
     FROM restaurants r
     LEFT JOIN orders o ON o.restaurant_id = r.id AND o.status != 'PENDING'
     LEFT JOIN users u ON u.restaurant_id = r.id
     GROUP BY r.id
     ORDER BY r.created_at DESC`,
    []
  );
  res.json(result.rows);
});

// GET /api/admin/stats — KPI globali piattaforma
router.get('/stats', async (_req, res) => {
  const result = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM restaurants) as total_restaurants,
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM orders WHERE status != 'PENDING') as total_orders,
      (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'PENDING') as total_revenue,
      (SELECT COUNT(*) FROM orders
       WHERE created_at >= CURRENT_DATE AND status != 'PENDING') as orders_today,
      (SELECT COALESCE(SUM(total), 0) FROM orders
       WHERE created_at >= CURRENT_DATE AND status != 'PENDING') as revenue_today,
      (SELECT COUNT(DISTINCT restaurant_id) FROM orders
       WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as active_restaurants_7d
  `);
  res.json(result.rows[0]);
});

// DELETE /api/admin/restaurants/:id — disattiva ristorante
router.delete('/restaurants/:id', async (req, res) => {
  await db.query('UPDATE restaurants SET slug = slug || \'_disabled\' WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

export default router;
