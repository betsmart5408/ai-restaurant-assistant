import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/client';
import { requireAuth, requireSuperAdmin, signToken } from '../middleware/auth';

const router = Router();

// POST /api/admin/login — login superadmin
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email e password obbligatori' });

  const result = await db.query('SELECT * FROM superadmins WHERE email = $1', [email]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Credenziali non valide' });

  const sa = result.rows[0];
  const ok = await bcrypt.compare(password, sa.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });

  const token = signToken({ userId: sa.id, restaurantId: 'superadmin', role: 'superadmin' });
  res.json({ token, role: 'superadmin' });
});

// Tutte le route successive richiedono auth superadmin
router.use(requireAuth, requireSuperAdmin);

// GET /api/admin/restaurants — tutti i ristoranti con billing
router.get('/restaurants', async (_req, res) => {
  const result = await db.query(`
    SELECT r.id, r.name, r.slug, r.created_at, r.logo_url,
           r.plan, r.subscription_status, r.trial_ends_at,
           r.monthly_price, r.suspended_at, r.billing_email,
           u.email as owner_email,
           COUNT(DISTINCT d.id) as dish_count,
           COUNT(DISTINCT cs.id) FILTER (WHERE cs.created_at >= NOW() - INTERVAL '30 days') as sessions_30d
    FROM restaurants r
    LEFT JOIN users u ON u.restaurant_id = r.id AND u.role = 'owner'
    LEFT JOIN dishes d ON d.restaurant_id = r.id
    LEFT JOIN chat_sessions cs ON cs.restaurant_id = r.id
    GROUP BY r.id, u.email
    ORDER BY r.created_at DESC
  `);
  res.json(result.rows);
});

// GET /api/admin/stats — KPI globali
router.get('/stats', async (_req, res) => {
  const result = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM restaurants) as total_restaurants,
      (SELECT COUNT(*) FROM restaurants WHERE subscription_status = 'active') as active_subscriptions,
      (SELECT COUNT(*) FROM restaurants WHERE subscription_status = 'trialing') as trialing,
      (SELECT COUNT(*) FROM restaurants WHERE suspended_at IS NOT NULL) as suspended,
      (SELECT COALESCE(SUM(monthly_price), 0) FROM restaurants WHERE subscription_status = 'active') as mrr,
      (SELECT COUNT(*) FROM chat_sessions WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as sessions_30d,
      (SELECT COUNT(*) FROM restaurants WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_30d
  `);
  res.json(result.rows[0]);
});

// POST /api/admin/restaurants — crea nuovo ristorante
router.post('/restaurants', async (req: Request, res: Response) => {
  const { restaurant_name, owner_email, owner_password, monthly_price = 49 } = req.body;
  if (!restaurant_name || !owner_email || !owner_password) {
    return res.status(400).json({ error: 'restaurant_name, owner_email, owner_password obbligatori' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const baseSlug = restaurant_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await client.query('SELECT id FROM restaurants WHERE slug = $1', [baseSlug]);
    const slug = existing.rows.length > 0 ? `${baseSlug}-${Date.now()}` : baseSlug;

    const restaurant = await client.query(
      `INSERT INTO restaurants (name, slug, billing_email, monthly_price, plan, subscription_status, trial_ends_at)
       VALUES ($1, $2, $3, $4, 'trial', 'trialing', NOW() + INTERVAL '14 days')
       RETURNING id, name, slug`,
      [restaurant_name, slug, owner_email, monthly_price]
    );
    const restaurantId = restaurant.rows[0].id;

    for (let i = 1; i <= 10; i++) {
      await client.query('INSERT INTO tables (restaurant_id, number) VALUES ($1, $2)', [restaurantId, i]);
    }

    const hash = await bcrypt.hash(owner_password, 10);
    await client.query(
      `INSERT INTO users (restaurant_id, email, password_hash, role) VALUES ($1, $2, $3, 'owner')`,
      [restaurantId, owner_email, hash]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...restaurant.rows[0], qr_base_url: `?restaurant=${slug}&table=1` });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const e = err as { code?: string };
    if (e.code === '23505') return res.status(409).json({ error: 'Email o slug già esistente' });
    res.status(500).json({ error: 'Creazione fallita' });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/restaurants/:id — sospendi / riattiva / cambia piano
router.patch('/restaurants/:id', async (req: Request, res: Response) => {
  const { action, monthly_price, plan } = req.body;
  if (action === 'suspend') {
    await db.query(`UPDATE restaurants SET suspended_at = NOW(), subscription_status = 'suspended' WHERE id = $1`, [req.params.id]);
  } else if (action === 'activate') {
    await db.query(`UPDATE restaurants SET suspended_at = NULL, subscription_status = 'active', plan = 'pro' WHERE id = $1`, [req.params.id]);
  } else if (action === 'update_price') {
    await db.query(`UPDATE restaurants SET monthly_price = $1 WHERE id = $2`, [monthly_price, req.params.id]);
  } else if (action === 'update_plan') {
    await db.query(`UPDATE restaurants SET plan = $1 WHERE id = $2`, [plan, req.params.id]);
  }
  res.json({ success: true });
});

// DELETE /api/admin/restaurants/:id
router.delete('/restaurants/:id', async (req: Request, res: Response) => {
  await db.query(`UPDATE restaurants SET suspended_at = NOW(), subscription_status = 'suspended' WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
});

// POST /api/admin/create-superadmin — crea primo superadmin (solo se non esiste)
router.post('/create-superadmin', async (req: Request, res: Response) => {
  const { email, password, secret } = req.body;
  if (secret !== process.env.SUPERADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO superadmins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET password_hash = $2',
    [email, hash]
  );
  res.json({ success: true });
});

export default router;
