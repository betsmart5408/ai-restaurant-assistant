import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/client';
import { requireAuth, requireSuperAdmin, signToken } from '../middleware/auth';
import { SQL_IN_PAUSA } from '../services/prova';
import { catenaFornitori, clientePer } from '../services/fornitori-ia';
import { modelliDisponibili } from '../services/groq-model';

const router = Router();

// POST /api/admin/login — login superadmin
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email e password obbligatori' });

    const result = await db.query(
      'SELECT * FROM superadmins WHERE LOWER(email) = $1',
      [String(email).toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Se la tabella e' proprio vuota il problema non e' la password:
      // nessuno ha ancora creato il primo superadmin. Dirlo apertamente
      // non svela niente e fa risparmiare mezz'ora di tentativi.
      const quanti = await db.query('SELECT COUNT(*)::int AS n FROM superadmins');
      if (quanti.rows[0].n === 0) {
        return res.status(401).json({
          error: 'Nessun super admin registrato. Crealo con: .\\crea-superadmin.ps1 -Email tua@email.com -Password LaTuaPassword',
        });
      }
      return res.status(401).json({ error: 'Super admin: email o password non corretti' });
    }

    const sa = result.rows[0];
    const ok = await bcrypt.compare(password, sa.password_hash);
    if (!ok) return res.status(401).json({ error: 'Super admin: email o password non corretti' });

    const token = signToken({ userId: sa.id, restaurantId: 'superadmin', role: 'superadmin' });
    res.json({ token, role: 'superadmin' });
  } catch (err) {
    console.error('Superadmin login error:', err);
    res.status(500).json({ error: 'Accesso non riuscito' });
  }
});

// Tutte le route successive richiedono auth superadmin
router.use(requireAuth, requireSuperAdmin);

// GET /api/admin/restaurants — tutti i ristoranti con billing
router.get('/restaurants', async (_req, res) => {
  try {
    // Ogni demo deve avere la sua chiave di attivazione: serve al link per
    // il DM ("Copia link per DM"). Quelle che non ce l'hanno la ricevono ora.
    const senza = await db.query(`SELECT id FROM restaurants WHERE is_demo = TRUE AND demo_claim_token IS NULL`);
    for (const { id } of senza.rows) {
      await db.query('UPDATE restaurants SET demo_claim_token = $1 WHERE id = $2 AND demo_claim_token IS NULL',
        [crypto.randomBytes(18).toString('base64url'), id]);
    }

    const result = await db.query(`
      SELECT r.id, r.name, r.slug, r.created_at, r.logo_url,
             r.plan, r.subscription_status, r.trial_ends_at,
             r.monthly_price, r.suspended_at, r.billing_email,
             u.email as owner_email,
             r.is_demo,
             CASE WHEN r.is_demo THEN r.demo_claim_token END AS demo_claim_token,
             ${SQL_IN_PAUSA} AS in_pausa,
             COUNT(DISTINCT d.id) as dish_count,
             COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(TRIM(d.description), '') <> '') as dishes_with_description,
             COUNT(DISTINCT cs.id) FILTER (WHERE cs.created_at >= NOW() - INTERVAL '30 days') as sessions_30d
      FROM restaurants r
      LEFT JOIN users u ON u.restaurant_id = r.id AND u.role = 'owner'
      LEFT JOIN dishes d ON d.restaurant_id = r.id
      LEFT JOIN chat_sessions cs ON cs.restaurant_id = r.id
      GROUP BY r.id, u.email
      -- Prima i menu con le descrizioni dei piatti (sono le demo che si
      -- vendono meglio), dal piu' completo al meno; poi tutti gli altri.
      ORDER BY
        (COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(TRIM(d.description), '') <> '') > 0) DESC,
        COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(TRIM(d.description), '') <> '')::float
          / NULLIF(COUNT(DISTINCT d.id), 0) DESC NULLS LAST,
        COUNT(DISTINCT d.id) DESC,
        r.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/consumi?giorni=30 — quanto consuma l'IA, per ristorante
// Domande = tutte quelle arrivate alla chat; "senza IA" = risolte dalle
// risposte pronte; "IA" = chiamate al modello; "limite" = rimandate al
// personale perche' il ristorante aveva finito le domande del giorno.
router.get('/consumi', async (req, res) => {
  const giorni = Math.min(Math.max(Number(req.query.giorni) || 30, 1), 365);
  try {
    const ristoranti = await db.query(
      `WITH intenti AS (
         SELECT restaurant_id,
                SUM(quanti)::int AS domande,
                SUM(quanti) FILTER (WHERE intento NOT IN ('modello', 'limite'))::int AS senza_ia,
                SUM(quanti) FILTER (WHERE intento = 'limite')::int AS limite
         FROM chat_intenti WHERE giorno > CURRENT_DATE - $1::int
         GROUP BY restaurant_id
       ), ia AS (
         SELECT restaurant_id,
                SUM(chiamate)::int AS chiamate_ia,
                SUM(token_in)::bigint AS token_in,
                SUM(token_out)::bigint AS token_out,
                SUM(costo_usd)::float AS costo_usd,
                MAX(giorno) AS ultimo_giorno
         FROM consumi_ia WHERE giorno > CURRENT_DATE - $1::int
         GROUP BY restaurant_id
       )
       SELECT r.id, r.name, r.slug, r.is_demo, r.subscription_status,
              COALESCE(i.domande, 0) AS domande, COALESCE(i.senza_ia, 0) AS senza_ia, COALESCE(i.limite, 0) AS limite,
              COALESCE(ia.chiamate_ia, 0) AS chiamate_ia, COALESCE(ia.token_in, 0) AS token_in,
              COALESCE(ia.token_out, 0) AS token_out, COALESCE(ia.costo_usd, 0) AS costo_usd
       FROM restaurants r
       LEFT JOIN intenti i ON i.restaurant_id = r.id
       LEFT JOIN ia ON ia.restaurant_id = r.id
       WHERE i.restaurant_id IS NOT NULL OR ia.restaurant_id IS NOT NULL
       ORDER BY COALESCE(ia.costo_usd, 0) DESC, COALESCE(ia.chiamate_ia, 0) DESC, COALESCE(i.domande, 0) DESC`,
      [giorni]
    );
    const fornitori = await db.query(
      `SELECT fornitore, SUM(chiamate)::int AS chiamate, SUM(token_in + token_out)::bigint AS token, SUM(costo_usd)::float AS costo_usd
       FROM consumi_ia WHERE giorno > CURRENT_DATE - $1::int
       GROUP BY fornitore ORDER BY chiamate DESC`,
      [giorni]
    );
    res.json({ giorni, ristoranti: ristoranti.rows, fornitori: fornitori.rows });
  } catch (err) {
    console.error('Consumi error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/fornitori — prova ogni fornitore IA della catena con una
// domanda minuscola: risponde? con quale modello? in quanto tempo? Le chiavi
// non escono mai, si vede solo il nome del fornitore.
router.get('/fornitori', async (_req, res) => {
  const catena = catenaFornitori();
  const esiti = await Promise.all(catena.map(async f => {
    const inizio = Date.now();
    try {
      const cliente = clientePer(f);
      const modelli = f.modelli.length > 0 ? f.modelli : await modelliDisponibili(cliente, f.chiave);
      if (modelli.length === 0) return { nome: f.nome, ok: false, errore: 'nessun modello disponibile con questa chiave' };
      const r = await cliente.chat.completions.create({
        model: modelli[0], max_tokens: 5, messages: [{ role: 'user', content: 'Rispondi solo: ok' }],
      } as any);
      const testo = String(r.choices?.[0]?.message?.content ?? '').trim();
      return { nome: f.nome, ok: true, modello: modelli[0], ms: Date.now() - inizio, risposta: testo.slice(0, 20) };
    } catch (err: any) {
      const stato = err?.status ? `${err.status} ` : '';
      const quota = err?.status === 429 || /rate limit|quota|429/i.test(String(err?.message ?? ''));
      return {
        nome: f.nome, ok: false, quota, ms: Date.now() - inizio,
        errore: quota ? 'quota esaurita per ora (si ricarica da sola)' : `${stato}${String(err?.message ?? err).slice(0, 160)}`,
      };
    }
  }));
  res.json({ fornitori: esiti });
});

// GET /api/admin/conversazioni?giorni=7&slug=&sospette=1 — le chat vere dei
// clienti, per leggerle e trovare gli errori dell'assistente. Una risposta e'
// "sospetta" se contiene promesse impossibili, il messaggio di ripiego
// ("non riesco a rispondere"), il tetto raggiunto o fatti sul locale.
const SOSPETTA: Array<[RegExp, string]> = [
  [/avviso io|faccio verificare|lo segnalo|chiamo (io )?il cameriere|i['’]ll (let|tell|inform|notify|call)|i will (let|tell|inform|notify|call)/i, 'promessa impossibile'],
  [/non riesco a rispondere|can.t answer right now|no puedo responder/i, 'nessun fornitore IA ha risposto'],
  [/abbiamo parlato parecchio|talked quite a lot/i, 'tetto della conversazione'],
  [/password|campanell|bell on the table|accettiamo tutte|we accept all/i, 'possibile fatto inventato sul locale'],
];
router.get('/conversazioni', async (req, res) => {
  const giorni = Math.min(Math.max(Number(req.query.giorni) || 7, 1), 90);
  const slug = String(req.query.slug ?? '').trim();
  const soloSospette = req.query.sospette === '1';
  try {
    const r = await db.query(
      `SELECT cs.id, cs.language, cs.created_at, cs.messages, r.name, r.slug, r.is_demo
       FROM chat_sessions cs JOIN restaurants r ON r.id = cs.restaurant_id
       WHERE cs.created_at > NOW() - make_interval(days => $1)
         AND ($2 = '' OR r.slug = $2)
         AND jsonb_array_length(COALESCE(cs.messages, '[]'::jsonb)) > 1
       ORDER BY cs.created_at DESC
       LIMIT 300`,
      [giorni, slug]
    );
    const conversazioni = r.rows.map(c => {
      const messaggi = (Array.isArray(c.messages) ? c.messages : []).map((m: any) => {
        const motivi = m?.role === 'assistant'
          ? SOSPETTA.filter(([re]) => re.test(String(m.content ?? ''))).map(([, motivo]) => motivo)
          : [];
        return { role: m?.role, content: String(m?.content ?? ''), timestamp: m?.timestamp ?? null, motivi };
      });
      const sospette = messaggi.filter((m: { motivi: string[] }) => m.motivi.length > 0).length;
      return { id: c.id, ristorante: c.name, slug: c.slug, demo: c.is_demo, lingua: c.language, inizio: c.created_at, domande: messaggi.filter((m: { role: string }) => m.role === 'user').length, sospette, messaggi };
    }).filter(c => !soloSospette || c.sospette > 0);
    const elenco = await db.query(
      `SELECT r.slug, r.name AS nome, COUNT(*)::int AS chat
       FROM chat_sessions cs JOIN restaurants r ON r.id = cs.restaurant_id
       WHERE cs.created_at > NOW() - make_interval(days => $1)
         AND jsonb_array_length(COALESCE(cs.messages, '[]'::jsonb)) > 1
       GROUP BY r.slug, r.name ORDER BY chat DESC LIMIT 200`,
      [giorni]
    );
    const ristoranti = elenco.rows;
    res.json({ giorni, conversazioni: conversazioni.slice(0, 100), ristoranti });
  } catch (err) {
    console.error('Conversazioni error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/stats — KPI globali
router.get('/stats', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM restaurants WHERE is_demo IS NOT TRUE) as total_restaurants,
        (SELECT COUNT(*) FROM restaurants WHERE is_demo IS NOT TRUE AND subscription_status = 'active') as active_subscriptions,
        (SELECT COUNT(*) FROM restaurants WHERE is_demo IS NOT TRUE AND subscription_status = 'trialing' AND (trial_ends_at IS NULL OR trial_ends_at > NOW())) as trialing,
        (SELECT COUNT(*) FROM restaurants WHERE is_demo IS NOT TRUE AND subscription_status = 'trialing' AND trial_ends_at <= NOW()) as prova_scaduta,
        (SELECT COUNT(*) FROM restaurants WHERE is_demo = TRUE) as demos,
        (SELECT COUNT(*) FROM restaurants WHERE is_demo IS NOT TRUE AND suspended_at IS NOT NULL) as suspended,
        (SELECT COALESCE(SUM(monthly_price), 0) FROM restaurants WHERE is_demo IS NOT TRUE AND subscription_status = 'active') as mrr,
        (SELECT COUNT(*) FROM chat_sessions WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as sessions_30d,
        (SELECT COUNT(*) FROM restaurants WHERE is_demo IS NOT TRUE AND created_at >= CURRENT_DATE - INTERVAL '30 days') as new_30d
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/restaurants — crea nuovo ristorante
router.post('/restaurants', async (req: Request, res: Response) => {
  const { restaurant_name, owner_email, owner_password, monthly_price = 30 } = req.body;
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
  try {
    const { action, monthly_price, plan } = req.body;
    if (action === 'suspend') {
      await db.query(`UPDATE restaurants SET suspended_at = NOW(), subscription_status = 'suspended' WHERE id = $1`, [req.params.id]);
    } else if (action === 'activate') {
      await db.query(`UPDATE restaurants SET suspended_at = NULL, subscription_status = 'active', plan = 'pro' WHERE id = $1`, [req.params.id]);
    } else if (action === 'update_price') {
      await db.query(`UPDATE restaurants SET monthly_price = $1 WHERE id = $2`, [monthly_price, req.params.id]);
    } else if (action === 'update_plan') {
      await db.query(`UPDATE restaurants SET plan = $1 WHERE id = $2`, [plan, req.params.id]);
    } else {
      return res.status(400).json({ error: 'Azione non riconosciuta' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/restaurants/:id
router.delete('/restaurants/:id', async (req: Request, res: Response) => {
  try {
    await db.query(`UPDATE restaurants SET suspended_at = NOW(), subscription_status = 'suspended' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Nota: il primo superadmin si crea da riga di comando, non via HTTP:
//   .\crea-superadmin.ps1 -Email tua@email.com -Password LaTuaPassword
// (la vecchia rotta /create-superadmin stava sotto la guardia di
//  autenticazione, quindi non era raggiungibile da chi non era gia' dentro)

export default router;
