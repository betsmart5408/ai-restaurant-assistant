import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/client';
import { signToken, requireAuth } from '../middleware/auth';

const router = Router();

// POST /api/auth/register — registra nuovo ristorante + owner
router.post('/register', async (req, res) => {
  const { restaurant_name, email, password, languages = ['it', 'en'], whatsapp } = req.body;

  if (!restaurant_name || !email || !password) {
    return res.status(400).json({ error: 'restaurant_name, email e password sono obbligatori' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Genera slug univoco dal nome ristorante
    const baseSlug = restaurant_name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existing = await client.query('SELECT id FROM restaurants WHERE slug = $1', [baseSlug]);
    const slug = existing.rows.length > 0 ? `${baseSlug}-${Date.now()}` : baseSlug;

    // Crea ristorante
    const restaurant = await client.query(
      `INSERT INTO restaurants (name, slug, languages, whatsapp)
       VALUES ($1, $2, $3, $4) RETURNING id, name, slug`,
      [restaurant_name, slug, languages, whatsapp ?? null]
    );

    const restaurantId = restaurant.rows[0].id;

    // Crea tavoli di default (1-10)
    for (let i = 1; i <= 10; i++) {
      await client.query(
        'INSERT INTO tables (restaurant_id, number) VALUES ($1, $2)',
        [restaurantId, i]
      );
    }

    // Crea utente owner
    const hash = await bcrypt.hash(password, 10);
    const user = await client.query(
      `INSERT INTO users (restaurant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [restaurantId, email, hash]
    );

    await client.query('COMMIT');

    const token = signToken({
      userId: user.rows[0].id,
      restaurantId,
      role: 'owner',
    });

    res.status(201).json({
      token,
      restaurant: restaurant.rows[0],
      message: `Ristorante "${restaurant_name}" creato! QR base: ?restaurant=${slug}&table=1`,
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const e = err as { code?: string; message: string };
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email già registrata' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registrazione fallita' });
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email e password obbligatori' });
  }

  const result = await db.query(
    `SELECT u.id, u.password_hash, u.role, u.restaurant_id,
            r.name as restaurant_name, r.slug
     FROM users u
     JOIN restaurants r ON r.id = u.restaurant_id
     WHERE u.email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });

  const token = signToken({
    userId: user.id,
    restaurantId: user.restaurant_id,
    role: user.role,
  });

  res.json({
    token,
    restaurant: { id: user.restaurant_id, name: user.restaurant_name, slug: user.slug },
    role: user.role,
  });
});

// GET /api/auth/me — info utente corrente
router.get('/me', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.email, u.role,
            r.id as restaurant_id, r.name as restaurant_name, r.slug
     FROM users u JOIN restaurants r ON r.id = u.restaurant_id
     WHERE u.id = $1`,
    [req.auth!.userId]
  );
  res.json(result.rows[0]);
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;

  const result = await db.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.auth!.userId]
  );

  const ok = await bcrypt.compare(current_password, result.rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'Password attuale errata' });

  const hash = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.auth!.userId]);

  res.json({ success: true });
});

// GET /api/auth/restaurants — lista pubblica dei ristoranti
router.get('/restaurants', async (_req, res) => {
  const result = await db.query('SELECT id, name, slug FROM restaurants ORDER BY name');
  res.json(result.rows);
});

export default router;
