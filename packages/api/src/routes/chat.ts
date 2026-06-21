import { Router } from 'express';
import { db } from '../db/client';
import { processChat } from '../services/ai-chat';

const router = Router();

// POST /api/chat/session — crea nuova sessione chat
router.post('/session', async (req, res) => {
  try {
    const { restaurant_slug, table_number, language = 'it' } = req.body;

    const restaurant = await db.query(
      'SELECT id, name FROM restaurants WHERE slug = $1',
      [restaurant_slug]
    );

    if (restaurant.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const { id: restaurantId, name: restaurantName } = restaurant.rows[0];

    const table = await db.query(
      'SELECT id FROM tables WHERE restaurant_id = $1 AND number = $2',
      [restaurantId, table_number]
    );

    if (table.rows.length === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const session = await db.query(
      `INSERT INTO chat_sessions (restaurant_id, table_id, language, messages)
       VALUES ($1, $2, $3, '[]')
       RETURNING id`,
      [restaurantId, table.rows[0].id, language]
    );

    // Messaggio di benvenuto iniziale
    const welcome = await processChat(
      {
        restaurantId,
        restaurantName,
        tableNumber: table_number,
        language,
        conversationHistory: [],
      },
      `Ciao! Ho appena scannerizzato il QR del tavolo ${table_number}. Presentati brevemente e mostrami il menu in modo accattivante.`
    );

    // Salva messaggio di benvenuto in sessione
    await db.query(
      `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
      [
        JSON.stringify([
          { role: 'assistant', content: welcome.message, timestamp: new Date().toISOString() },
        ]),
        session.rows[0].id,
      ]
    );

    res.json({
      session_id: session.rows[0].id,
      welcome_message: welcome.message,
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
              r.name as restaurant_name,
              t.number as table_number
       FROM chat_sessions cs
       JOIN restaurants r ON r.id = cs.restaurant_id
       JOIN tables t ON t.id = cs.table_id
       WHERE cs.id = $1`,
      [sessionId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const s = session.rows[0];
    const history = (s.messages as Array<{ role: 'user' | 'assistant'; content: string }>)
      .map(({ role, content }) => ({ role, content }));

    const response = await processChat(
      {
        restaurantId: s.restaurant_id,
        restaurantName: s.restaurant_name,
        tableNumber: s.table_number,
        language: s.language,
        conversationHistory: history,
      },
      message
    );

    // Aggiorna history in DB
    const newMessages = [
      { role: 'user', content: message, timestamp: new Date().toISOString() },
      { role: 'assistant', content: response.message, timestamp: new Date().toISOString() },
    ];

    await db.query(
      `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
      [JSON.stringify(newMessages), sessionId]
    );

    res.json({
      message: response.message,
      order_data: response.orderData ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process message' });
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

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
