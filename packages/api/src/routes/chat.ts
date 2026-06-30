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
      'SELECT id, name, groq_api_key FROM restaurants WHERE slug = $1',
      [restaurant_slug]
    );
    if (restaurant.rows.length === 0) return res.status(404).json({ error: 'Restaurant not found' });

    const { id: restaurantId, name: restaurantName, groq_api_key } = restaurant.rows[0];

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

    const welcomeMessages: Record<string, string> = {
      it: `Ciao! 👋 Sono Marco, il tuo assistente virtuale da ${restaurantName}.\nSono qui per aiutarti a scegliere i piatti migliori, scoprire abbinamenti e ordinare. Hai allergie o intolleranze di cui dovrei sapere?`,
      en: `Hello! 👋 I'm Marco, your virtual assistant at ${restaurantName}.\nI'm here to help you choose the best dishes, discover pairings and place your order. Do you have any allergies or intolerances I should know about?`,
      de: `Hallo! 👋 Ich bin Marco, Ihr virtueller Assistent bei ${restaurantName}.\nIch helfe Ihnen, die besten Gerichte zu wählen und zu bestellen. Haben Sie Allergien oder Unverträglichkeiten?`,
      es: `¡Hola! 👋 Soy Marco, tu asistente virtual en ${restaurantName}.\nEstoy aquí para ayudarte a elegir los mejores platos y hacer tu pedido. ¿Tienes alguna alergia o intolerancia?`,
      fr: `Bonjour! 👋 Je suis Marco, votre assistant virtuel chez ${restaurantName}.\nJe suis là pour vous aider à choisir les meilleurs plats et passer votre commande. Avez-vous des allergies ou intolérances?`,
      pt: `Olá! 👋 Sou Marco, o seu assistente virtual em ${restaurantName}.\nEstou aqui para ajudá-lo a escolher os melhores pratos e fazer o seu pedido. Tem alguma alergia ou intolerância?`,
      ru: `Привет! 👋 Я Марко, ваш виртуальный ассистент в ${restaurantName}.\nЯ здесь, чтобы помочь вам выбрать лучшие блюда и сделать заказ. Есть ли у вас аллергии или непереносимость?`,
      zh: `你好！👋 我是Marco，${restaurantName}的虚拟助手。\n我在这里帮您选择最好的菜肴并下单。您有任何过敏或不耐受症状吗？`,
      ja: `こんにちは！👋 私はMarco、${restaurantName}のバーチャルアシスタントです。\n最高の料理を選び、ご注文をお手伝いします。アレルギーや食物不耐症はありますか？`,
      ar: `مرحباً! 👋 أنا Marco، مساعدك الافتراضي في ${restaurantName}.\nأنا هنا لمساعدتك في اختيار أفضل الأطباق وتقديم طلبك. هل لديك أي حساسية أو عدم تحمل؟`,
    };
    const welcomeMsg = welcomeMessages[language] ?? welcomeMessages['it'];
    const defaultSuggestions: Record<string, string[]> = {
      it: ["Cosa mi consiglia?", "Ho un'allergia", 'Menu degustazione'],
      en: ['What do you recommend?', 'I have an allergy', 'Tasting menu'],
      de: ['Was empfehlen Sie?', 'Ich habe eine Allergie', 'Degustationsmenü'],
      es: ['¿Qué recomienda?', 'Tengo una alergia', 'Menú degustación'],
      fr: ['Que recommandez-vous?', "J'ai une allergie", 'Menu dégustation'],
      pt: ['O que recomenda?', 'Tenho uma alergia', 'Menu degustação'],
      ru: ['Что вы рекомендуете?', 'У меня аллергия', 'Дегустационное меню'],
      zh: ['您推荐什么？', '我有过敏', '品鉴菜单'],
      ja: ['何がおすすめですか？', 'アレルギーがあります', 'テイスティングメニュー'],
      ar: ['ماذا توصي؟', 'لدي حساسية', 'قائمة التذوق'],
    };
    const suggestions = defaultSuggestions[language] ?? defaultSuggestions['it'];

    if (existingSessionId) {
      const sessionId = existingSessionId;
      const alreadyOrdered = await getSessionOrders(sessionId);
      const joinMsg = alreadyOrdered
        ? `${welcomeMsg}\n\n_Al tavolo è già stato ordinato: ${alreadyOrdered}_`
        : welcomeMsg;
      await db.query(
        `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
        [JSON.stringify([{ role: 'assistant', content: joinMsg, timestamp: new Date().toISOString() }]), sessionId]
      );
      return res.json({
        session_id: sessionId,
        welcome_message: joinMsg,
        suggestions,
        joined_existing: true,
        already_ordered: alreadyOrdered,
      });
    }

    // ── Crea nuova sessione ───────────────────────────────────────────────────
    const session = await db.query(
      `INSERT INTO chat_sessions (restaurant_id, table_id, language, messages)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [restaurantId, tableId, language, JSON.stringify([{ role: 'assistant', content: welcomeMsg, timestamp: new Date().toISOString() }])]
    );

    res.json({
      session_id: session.rows[0].id,
      welcome_message: welcomeMsg,
      suggestions,
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
    const { message, language } = req.body;

    const session = await db.query(
      `SELECT cs.id, cs.language, cs.messages, cs.restaurant_id, cs.table_id,
              r.name as restaurant_name, r.groq_api_key, t.number as table_number
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
        language: language || s.language,
        conversationHistory: history,
        existingOrders,
      },
      message,
      s.groq_api_key || undefined
    );

    await db.query(
      `UPDATE chat_sessions SET messages = messages || $1::jsonb WHERE id = $2`,
      [JSON.stringify([
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        { role: 'assistant', content: response.message, timestamp: new Date().toISOString() },
      ]), sessionId]
    );

    // Risolve dish_id per nome se mancante (AI non ha più gli id nel prompt)
    let orderData = response.orderData ?? null;
    if (orderData?.items) {
      const resolved = await Promise.all(orderData.items.map(async (item: { dish_id?: string; dish_name: string; qty: number; unit_price: number }) => {
        if (item.dish_id) return item;
        const match = await db.query(
          `SELECT id FROM dishes WHERE restaurant_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [s.restaurant_id, item.dish_name]
        );
        return { ...item, dish_id: match.rows[0]?.id ?? null };
      }));
      orderData = { items: resolved };
    }

    res.json({
      message: response.message,
      order_data: orderData,
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
