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

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Indirizzo email non valido' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
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
  try {
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
      return res.status(401).json({ error: 'Ristorante: email o password non corretti' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Ristorante: email o password non corretti' });

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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Accesso non riuscito' });
  }
});

// GET /api/auth/me — info utente corrente
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.role,
              r.id as restaurant_id, r.name as restaurant_name, r.slug
       FROM users u JOIN restaurants r ON r.id = u.restaurant_id
       WHERE u.id = $1`,
      [req.auth!.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Password attuale e nuova password obbligatorie' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
    }

    const result = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.auth!.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

    const ok = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Password attuale errata' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.auth!.userId]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/restaurants — lista pubblica dei ristoranti
router.get('/restaurants', async (_req, res) => {
  try {
    const result = await db.query('SELECT id, name, slug FROM restaurants ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── "Attiva la tua demo" ────────────────────────────────────────────────────
// GET /api/auth/claim?slug=&token=  — dati per la schermata di attivazione
router.get('/claim', async (req, res) => {
  try {
    const slug = String(req.query.slug ?? '').trim();
    const token = String(req.query.token ?? '').trim();
    if (!slug || !token) return res.status(400).json({ error: 'Link non valido' });
    const r = await db.query(
      `SELECT name, logo_url, is_demo, demo_claim_token FROM restaurants WHERE slug = $1`,
      [slug]
    );
    const row = r.rows[0];
    if (!row || row.demo_claim_token !== token) {
      return res.status(404).json({ error: 'Link non valido' });
    }
    if (!row.is_demo) {
      return res.status(410).json({ error: 'Questa demo è già stata attivata', already_claimed: true });
    }
    res.json({ name: row.name, logo_url: row.logo_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/claim  { slug, token, email, password }
router.post('/claim', async (req, res) => {
  const { slug, token, email, password } = req.body ?? {};
  if (!slug || !token || !email || !password) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'Indirizzo email non valido' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, name, slug FROM restaurants
       WHERE slug = $1 AND demo_claim_token = $2 AND is_demo = TRUE
       FOR UPDATE`,
      [slug, token]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Link non valido o demo già attivata' });
    }
    const rest = r.rows[0];

    const emailPulita = String(email).toLowerCase().trim();
    const gia = await client.query('SELECT id FROM users WHERE email = $1', [emailPulita]);
    if (gia.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email già registrata: accedi dalla pagina di login' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await client.query(
      `INSERT INTO users (restaurant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [rest.id, emailPulita, hash]
    );

    // La demo diventa un cliente vero: niente più is_demo, trial da adesso.
    const giorniProva = Number(process.env.SALES_TRIAL_DAYS) || 7;
    await client.query(
      `UPDATE restaurants SET
         is_demo = FALSE,
         demo_claim_token = NULL,
         billing_email = $2,
         demo_email = COALESCE(demo_email, $2),
         plan = 'trial',
         subscription_status = 'trialing',
         trial_ends_at = NOW() + make_interval(days => $3)
       WHERE id = $1`,
      [rest.id, emailPulita, giorniProva]
    );

    // Le demo hanno un solo tavolo: un ristorante vero ne vuole di più.
    await client.query(
      `INSERT INTO tables (restaurant_id, number)
       SELECT $1, g FROM generate_series(2, 12) g
       ON CONFLICT DO NOTHING`,
      [rest.id]
    );

    await client.query('COMMIT');

    const jwt = signToken({ userId: user.rows[0].id, restaurantId: rest.id, role: 'owner' });
    res.status(201).json({
      token: jwt,
      restaurant: { id: rest.id, name: rest.name, slug: rest.slug },
      role: 'owner',
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const e = err as { code?: string };
    if (e.code === '23505') return res.status(409).json({ error: 'Email già registrata' });
    console.error('claim error:', err);
    res.status(500).json({ error: 'Attivazione non riuscita' });
  } finally {
    client.release();
  }
});

export default router;
