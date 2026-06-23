import { Router } from 'express';
import { db } from '../db/client';
import { processChat } from '../services/ai-chat';

const router = Router();

// Recupera ordini già confermati per una sessione
async function getSessionOrders(sessionId: string): Promise<string> {
  try {
    const result = await db.query<{ dish_name: string; total_qty: number }>(
      `SELECT oi.dish_name, SUM(oi.qty) as total_qty
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.session_id = $1
       GROUP BY oi.dish_name
       ORDER BY oi.dish_name`,
      [sessionId]
    );
    if (result.rows.length === 0) return '';
    return result.rows.map(r => `${r.total_qty}x ${r.dish_name}`).join(', ');
  } catch {
    return '';
  }
}

// POST /api/chat/session — get-or-create sessione condivisa per tavolo
router.post('/session', async (req, res) => {
  try {
    const { restaurant_slug, table_number, language = 'it', group_size, saved_preferences } = req.body;

    const restaurant = await db.query(
      'SELECT id, name FROM restaurants WHERE slug = $1',
      [restaurant_slug]
    );
    if (restaurant.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });

    const { id: restaurantId, name: restaurantName } = restaurant.rows[0];

    const table = await db.query(
      'SELECT id FROM tables WHERE restaurant_id = $1 AND number = $2',
      [restaurantId, table_number]
    );
    if (table.rows.length === 0) return res.status(404).json({ error: 'Table not found' });

    const tableId = table.rows[0].id;

    // ── Cerca sessione attiva per questo tavolo ──────────────────────────────
    let existingSessionId: string | null = null;
    try {
      const existing = await db.query(
        `SELECT id FROM chat_sessions
         WHERE restaurant_id = $1 AND table_id = $2
           AND created_at > NOW() - INTERVAL '6 hours'
         ORDER BY created_at DESC LIMIT 1`,
        [restaurantId, tableId]
      );
      if (existing.rows.length > 0) existingSessionId = existing.rows[0].id;
    } catch {
      // created_at potrebbe non esistere — procediamo con nuova sessione
    }

    if (existingSessionId) {
      // ── Unisce alla sessione esistente ────────────────────────────────────
      const sessionId = existingSessionId;
      const alreadyOrdered = await getSessionOrders(sessionId);

      const joinPrompt = alreadyOrdered
        ? `Mi sono appena unito al tavolo ${table_number} scansionando il QR. Al tavolo è già stato ordinato: ${alreadyOrdered}. Salutami brevemente come Marco e chiedimi cosa voglio aggiungere (senza riproporre ciò che è già stato ordinato).`
        : `Mi sono appena unito al tavolo ${table_number} scansionando il QR. Il tavolo non ha ancora ordinato niente. Salutami come Marco e aiutami a scegliere.`;

      const join = await processChat(
        {
          restaurantId,
          restaurantName,
          tableNumber: table_number,
          language,
          conversationHistory: [],
          groupSize: group_size,
          savedPreferences: saved_preferences,
          existingOrders: alreadyOrdered,
        },
        joinPrompt
      );

      await db.query(
        `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
        [JSON.stringify([{ role: 'assistant', content: join.message, timestamp: new Date().toISOString() }]), sessionId]
      );

      return res.json({
        session_id: sessionId,
        welcome_message: join.message,
        suggestions: join.suggestions ?? [],
        joined_existing: true,
        already_ordered: alreadyOrdered,
      });
    }

    // ── Crea nuova sessione ───────────────────────────────────────────────────
    const session = await db.query(
      `INSERT INTO chat_sessions (restaurant_id, table_id, language, messages)
       VALUES ($1, $2, $3, '[]') RETURNING id`,
      [restaurantId, tableId, language]
    );

    const welcome = await processChat(
      {
        restaurantId,
        restaurantName,
        tableNumber: table_number,
        language,
        conversationHistory: [],
        groupSize: group_size,
        savedPreferences: saved_preferences,
      },
      `Ciao! Ho scannerizzato il QR del tavolo ${table_number}. Presentati come Marco e dai il benvenuto al cliente.`
    );

    await db.query(
      `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
      [JSON.stringify([{ role: 'assistant', content: welcome.message, timestamp: new Date().toISOString() }]), session.rows[0].id]
    );

    res.json({
      session_id: session.rows[0].id,
      welcome_message: welcome.message,
      suggestions: welcome.suggestions ?? [],
      joined_existing: false,
      already_ordered: '',
    });
  } catch (err: unknown) {
    const e = err as Error;
    console.error('Chat session error:', e.message, e.stack);
    res.status(500).json({ error: 'Failed to create chat session', detail: e.message });
  }
});

// POST /api/chat/:sessionId/message — invia messaggio
router.post('/:sessionId/message', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    const session = await db.query(
      `SELECT cs.id, cs.language, cs.messages, cs.restaurant_id, cs.table_id,
              r.name as restaurant_name, t.number as table_number
       FROM chat_sessions cs
       JOIN restaurants r ON r.id = cs.restaurant_id
       JOIN tables t ON t.id = cs.table_id
       WHERE cs.id = $1`,
      [sessionId]
    );
    if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const s = session.rows[0];
    const history = (s.messages as Array<{ role: 'user' | 'assistant'; content: string }>)
      .map(({ role, content }) => ({ role, content }));

    const existingOrders = await getSessionOrders(sessionId);

    const response = await processChat(
      {
        restaurantId: s.restaurant_id,
        restaurantName: s.restaurant_name,
        tableNumber: s.table_number,
        language: s.language,
        conversationHistory: history,
        existingOrders,
      },
      message
    );

    await db.query(
      `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
      [JSON.stringify([
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        { role: 'assistant', content: response.message, timestamp: new Date().toISOString() },
      ]), sessionId]
    );

    res.json({
      message: response.message,
      order_data: response.orderData ?? null,
      suggestions: response.suggestions ?? [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// DELETE /api/chat/session/table/:slug/:tableNumber — cameriere chiude il tavolo
router.delete('/session/table/:slug/:tableNumber', async (req, res) => {
  try {
    const { slug, tableNumber } = req.params;

    const result = await db.query(
      `UPDATE chat_sessions cs
       SET created_at = NOW() - INTERVAL '7 hours'
       FROM restaurants r, tables t
       WHERE r.id = cs.restaurant_id AND t.id = cs.table_id
         AND r.slug = $1 AND t.number = $2
         AND cs.created_at > NOW() - INTERVAL '6 hours'`,
      [slug, parseInt(tableNumber)]
    );

    res.json({ closed: result.rowCount ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

// GET /api/chat/:sessionId — recupera history
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await db.query(
      'SELECT messages, language, order_id FROM chat_sessions WHERE id = $1',
      [sessionId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
