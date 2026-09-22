import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/client';
import { signToken, requireAuth } from '../middleware/auth';
import { mandaEmail, emailConPulsante, escapeHtml } from '../services/email';

const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://app.lingofork.com').replace(/\/+$/, '');
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

const router = Router();

// POST /api/auth/register — registra nuovo ristorante + owner
router.post('/register', async (req, res) => {
  const { restaurant_name, password, languages = ['it', 'en'], whatsapp } = req.body;
  const email = String(req.body.email ?? '').toLowerCase().trim();

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
    const { password } = req.body;
    const email = String(req.body.email ?? '').toLowerCase().trim();

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
    // 400 e non 401: la dashboard tratta ogni 401 come sessione scaduta.
    if (!ok) return res.status(400).json({ error: 'La password attuale non è corretta' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.auth!.userId]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Accedi con Google ───────────────────────────────────────────────────────
// Il browser riceve da Google un "ID token" firmato; qui lo facciamo
// verificare a Google stesso (tokeninfo) e controlliamo che sia stato emesso
// per la NOSTRA app e che l'email sia verificata. Nessuna libreria in piu'.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';

async function verificaGoogle(credential: string): Promise<{ email: string }> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Accesso con Google non configurato');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) throw new Error('Accesso Google non valido o scaduto, riprova');
  const t = await r.json() as { aud?: string; iss?: string; email?: string; email_verified?: string | boolean };
  const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (t.aud !== GOOGLE_CLIENT_ID || !issOk) throw new Error('Accesso Google non valido');
  if (!t.email || String(t.email_verified) !== 'true') throw new Error("L'email di questo account Google non è verificata");
  return { email: t.email.toLowerCase().trim() };
}

// GET /api/auth/google-config — l'ID client e' pubblico: la pagina di login
// lo chiede qui, cosi' si configura solo su Railway senza ricompilare.
router.get('/google-config', (_req, res) => {
  res.json({ client_id: GOOGLE_CLIENT_ID || null });
});

// POST /api/auth/google { credential } — entra se l'email Google ha un ristorante
router.post('/google', async (req, res) => {
  let email: string;
  try {
    email = (await verificaGoogle(String(req.body?.credential ?? ''))).email;
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  try {
    const result = await db.query(
      `SELECT u.id, u.role, u.restaurant_id, r.name AS restaurant_name, r.slug
       FROM users u JOIN restaurants r ON r.id = u.restaurant_id WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({
        error: `Nessun ristorante registrato con ${email}. Usa l'email con cui hai attivato l'account, oppure accedi con la password.`,
      });
    }
    res.json({
      token: signToken({ userId: user.id, restaurantId: user.restaurant_id, role: user.role }),
      restaurant: { id: user.restaurant_id, name: user.restaurant_name, slug: user.slug },
      role: user.role,
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Accesso non riuscito' });
  }
});

// ── Password dimenticata ────────────────────────────────────────────────────
// POST /api/auth/forgot-password { email }
// Risponde sempre allo stesso modo, che l'email esista o no: altrimenti
// chiunque potrebbe scoprire quali email sono registrate.
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const risposta = { ok: true };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(risposta);

  try {
    const u = await db.query(
      `SELECT u.id, r.name AS restaurant_name FROM users u
       JOIN restaurants r ON r.id = u.restaurant_id WHERE u.email = $1`,
      [email]
    );
    const user = u.rows[0];
    if (!user) return res.json(risposta);

    // Al massimo 3 richieste l'ora per utente: niente caselle intasate.
    const recenti = await db.query(
      `SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [user.id]
    );
    if (recenti.rows[0].n >= 3) return res.json(risposta);

    const token = crypto.randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, hashToken(token)]
    );

    const link = `${DASHBOARD_URL}/?reset=${token}`;
    await mandaEmail({
      to: email,
      subject: 'Reimposta la password di LingoFork',
      html: emailConPulsante({
        titolo: 'Reimposta la password',
        paragrafi: [
          `Qualcuno ha chiesto di reimpostare la password della dashboard di <strong>${escapeHtml(user.restaurant_name)}</strong>.`,
          "Clicca il pulsante per sceglierne una nuova. Il link vale per un'ora e si può usare una volta sola.",
        ],
        pulsante: 'Scegli una nuova password',
        link,
        nota: 'Se non sei stato tu, ignora questa email: la tua password resta quella di prima.',
      }),
      text: `Per reimpostare la password della dashboard di ${user.restaurant_name} apri questo link (vale un'ora):
${link}

Se non sei stato tu, ignora questa email.`,
    });
    res.json(risposta);
  } catch (err) {
    console.error('Forgot password error:', err);
    res.json(risposta);
  }
});

// POST /api/auth/reset-password { token, password } — sceglie la nuova password ed entra
router.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token ?? '');
  const password = String(req.body?.password ?? '');
  if (!token) return res.status(400).json({ error: 'Link non valido' });
  if (password.length < 8) return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT pr.id, pr.user_id FROM password_resets pr
       WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > NOW()
       FOR UPDATE`,
      [hashToken(token)]
    );
    if (!r.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Il link è scaduto o è già stato usato. Chiedine uno nuovo.' });
    }
    const { user_id } = r.rows[0];

    const hash = await bcrypt.hash(password, 10);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user_id]);
    // Brucia questo link e tutti gli altri ancora aperti per lo stesso utente
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user_id]);

    const u = await client.query(
      `SELECT u.id, u.role, u.restaurant_id, r.name AS restaurant_name, r.slug
       FROM users u JOIN restaurants r ON r.id = u.restaurant_id WHERE u.id = $1`,
      [user_id]
    );
    await client.query('COMMIT');

    const user = u.rows[0];
    res.json({
      token: signToken({ userId: user.id, restaurantId: user.restaurant_id, role: user.role }),
      restaurant: { id: user.restaurant_id, name: user.restaurant_name, slug: user.slug },
      role: user.role,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Non è stato possibile cambiare la password' });
  } finally {
    client.release();
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

// POST /api/auth/claim-link { slug, lang } — il tasto "Attiva" dentro la demo.
// Il link di attivazione e' la chiave del locale: non lo mostriamo mai nella
// pagina, lo mandiamo solo all'email ufficiale del locale (demo_email).
// Limiti in memoria: un invio ogni 10 minuti per demo, 5 l'ora per indirizzo IP.
const ultimoInvioDemo = new Map<string, number>();
const inviiPerIp = new Map<string, number[]>();
router.post('/claim-link', async (req, res) => {
  const slug = String(req.body?.slug ?? '').trim();
  const lingua: 'it' | 'en' = req.body?.lang === 'it' ? 'it' : 'en';
  if (!slug) return res.status(400).json({ error: 'Dati mancanti' });

  const adesso = Date.now();
  const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim();
  const recenti = (inviiPerIp.get(ip) ?? []).filter(t => adesso - t < 3600_000);
  if (recenti.length >= 5) return res.status(429).json({ error: 'Troppi tentativi, riprova più tardi' });
  if (adesso - (ultimoInvioDemo.get(slug) ?? 0) < 10 * 60_000) {
    // gia' mandato da poco: rispondiamo ok senza rimandarlo
    return res.json({ ok: true, gia_inviato: true });
  }

  try {
    const r = await db.query(
      `SELECT id, name, slug, demo_email, demo_claim_token FROM restaurants WHERE slug = $1 AND is_demo = TRUE`,
      [slug]
    );
    const rest = r.rows[0];
    if (!rest || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(rest.demo_email ?? ''))) {
      return res.status(404).json({ error: 'Demo non trovata' });
    }
    let token: string = rest.demo_claim_token;
    if (!token) {
      token = crypto.randomBytes(18).toString('base64url');
      await db.query('UPDATE restaurants SET demo_claim_token = $1 WHERE id = $2', [token, rest.id]);
    }
    const link = `${DASHBOARD_URL}/attiva?attiva=${encodeURIComponent(rest.slug)}&token=${token}`;
    const nome = escapeHtml(rest.name);
    const giorni = Number(process.env.SALES_TRIAL_DAYS) || 7;
    const t = lingua === 'it'
      ? {
          oggetto: `Attiva il menu digitale di ${rest.name}`,
          titolo: 'Il tuo menu è pronto',
          righe: [
            `Il menu di <strong>${nome}</strong> è già caricato e tradotto in più lingue, con l'assistente che risponde ai tuoi clienti.`,
            `Clicca il pulsante per attivarlo: scegli una password (o entra con Google) e hai ${giorni} giorni di prova gratuita, senza carta.`,
          ],
          pulsante: 'Attiva il tuo menu',
          nota: 'Hai ricevuto questa email perché qualcuno ha chiesto di attivare la demo del tuo locale su LingoFork. Se non sei stato tu, ignorala.',
        }
      : {
          oggetto: `Activate the digital menu for ${rest.name}`,
          titolo: 'Your menu is ready',
          righe: [
            `The menu for <strong>${nome}</strong> is already uploaded and translated into several languages, with an assistant that answers your guests' questions.`,
            `Click the button to activate it: choose a password (or sign in with Google) and get a ${giorni}-day free trial, no card required.`,
          ],
          pulsante: 'Activate your menu',
          nota: "You received this email because someone asked to activate your venue's demo on LingoFork. If it wasn't you, just ignore it.",
        };
    const ok = await mandaEmail({
      to: String(rest.demo_email).trim(),
      subject: t.oggetto,
      html: emailConPulsante({ titolo: t.titolo, paragrafi: t.righe, pulsante: t.pulsante, link, nota: t.nota }),
      text: `${t.righe.join('\n\n').replace(/<[^>]+>/g, '')}\n\n${link}`,
    });
    if (!ok) return res.status(502).json({ error: 'Invio non riuscito, riprova tra poco' });

    ultimoInvioDemo.set(slug, adesso);
    inviiPerIp.set(ip, [...recenti, adesso]);
    console.log(`[attiva] link di attivazione mandato per ${rest.slug}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Claim link error:', err);
    res.status(500).json({ error: 'Invio non riuscito, riprova tra poco' });
  }
});

// POST /api/auth/claim  { slug, token, email, password } oppure { slug, token, google_credential }
router.post('/claim', async (req, res) => {
  const { slug, token, google_credential } = req.body ?? {};
  let { email, password } = req.body ?? {};
  if (google_credential) {
    try {
      email = (await verificaGoogle(String(google_credential))).email;
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    // Chi entra con Google non sceglie una password: ne mettiamo una casuale
    // che nessuno conosce. Se un giorno la vuole, usa "password dimenticata".
    password = crypto.randomBytes(24).toString('base64url');
  }
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
         trial_ends_at = NOW() + make_interval(days => $3),
         -- il numero con cui ci ha scritto su WhatsApp per questa demo:
         -- serve per i promemoria di fine prova
         whatsapp = COALESCE(NULLIF(whatsapp, ''),
           (SELECT phone FROM whatsapp_leads WHERE slug = $4 ORDER BY last_msg_at DESC LIMIT 1))
       WHERE id = $1`,
      [rest.id, emailPulita, giorniProva, rest.slug]
    );
    await client.query(`UPDATE whatsapp_leads SET stato = 'attivato' WHERE slug = $1`, [rest.slug]);

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
