import { useState, useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// Legge parametri QR: ?restaurant=da-mario&table=3&lang=de
function getQRParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    restaurant: p.get('restaurant') ?? 'da-mario',
    table: parseInt(p.get('table') ?? '1'),
    lang: p.get('lang') ?? navigator.language.slice(0, 2) ?? 'it',
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface OrderData {
  items: Array<{ dish_id: string; dish_name: string; qty: number; unit_price: number }>;
}

type Screen = 'lang' | 'chat' | 'confirm_order';

const LANG_OPTIONS = [
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'es', label: '🇪🇸 Español' },
];

export default function App() {
  const params = getQRParams();
  const [screen, setScreen] = useState<Screen>('lang');
  const [lang, setLang] = useState(params.lang);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<OrderData | null>(null);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function startSession(selectedLang: string) {
    setLang(selectedLang);
    setScreen('chat');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/chat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_slug: params.restaurant,
          table_number: params.table,
          language: selectedLang,
        }),
      });
      const data = await res.json();
      setSessionId(data.session_id);
      setMessages([{
        role: 'assistant',
        content: data.welcome_message,
        timestamp: new Date().toISOString(),
      }]);
    } catch {
      setMessages([{
        role: 'assistant',
        content: '⚠️ Connessione non disponibile. Riprova tra poco.',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || !sessionId || loading) return;
    const text = input.trim();
    setInput('');

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/chat/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
        timestamp: new Date().toISOString(),
      }]);

      if (data.order_data) {
        setPendingOrder(data.order_data);
        setScreen('confirm_order');
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Errore di rete. Riprova.',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  async function confirmOrder() {
    if (!pendingOrder || !sessionId) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          items: pendingOrder.items,
          language: lang,
        }),
      });
      setOrderConfirmed(true);
      setPendingOrder(null);
      setScreen('chat');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: lang === 'de'
          ? '✅ Bestellung erhalten! Die Küche bereitet alles vor.'
          : lang === 'en'
          ? '✅ Order received! The kitchen is preparing everything.'
          : lang === 'es'
          ? '✅ ¡Pedido recibido! La cocina está preparando todo.'
          : '✅ Ordine ricevuto! La cucina sta preparando tutto.',
        timestamp: new Date().toISOString(),
      }]);
    } catch {
      alert('Errore nella conferma ordine');
    } finally {
      setLoading(false);
    }
  }

  // ─── Schermata selezione lingua ───────────────────────────
  if (screen === 'lang') {
    return (
      <div style={styles.langScreen}>
        <div style={styles.logoArea}>
          <div style={styles.logo}>🍽️</div>
          <h1 style={styles.logoTitle}>Benvenuto</h1>
          <p style={styles.logoSub}>Scegli la tua lingua / Choose your language</p>
        </div>
        <div style={styles.langGrid}>
          {LANG_OPTIONS.map(opt => (
            <button
              key={opt.code}
              style={styles.langBtn}
              onClick={() => startSession(opt.code)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={styles.tableTag}>Tavolo {params.table}</p>
      </div>
    );
  }

  // ─── Conferma ordine ──────────────────────────────────────
  if (screen === 'confirm_order' && pendingOrder) {
    const total = pendingOrder.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    return (
      <div style={styles.confirmScreen}>
        <h2 style={styles.confirmTitle}>
          {lang === 'de' ? '📋 Bestellung bestätigen' :
           lang === 'en' ? '📋 Confirm order' :
           lang === 'es' ? '📋 Confirmar pedido' :
           '📋 Conferma ordine'}
        </h2>
        <div style={styles.orderItems}>
          {pendingOrder.items.map((item, i) => (
            <div key={i} style={styles.orderItem}>
              <span>{item.qty}× {item.dish_name}</span>
              <span>€{(item.unit_price * item.qty).toFixed(2)}</span>
            </div>
          ))}
          <div style={styles.orderTotal}>
            <strong>Totale</strong>
            <strong>€{total.toFixed(2)}</strong>
          </div>
        </div>
        <div style={styles.confirmBtns}>
          <button style={styles.btnCancel} onClick={() => setScreen('chat')}>
            {lang === 'en' ? 'Modify' : lang === 'de' ? 'Ändern' : lang === 'es' ? 'Modificar' : 'Modifica'}
          </button>
          <button style={styles.btnConfirm} onClick={confirmOrder} disabled={loading}>
            {loading ? '...' : lang === 'en' ? 'Confirm ✓' : lang === 'de' ? 'Bestätigen ✓' : lang === 'es' ? 'Confirmar ✓' : 'Conferma ✓'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Chat principale ──────────────────────────────────────
  return (
    <div style={styles.chatScreen}>
      {/* Header */}
      <header style={styles.header}>
        <button style={styles.backBtn} onClick={() => setScreen('lang')}>←</button>
        <div>
          <div style={styles.headerTitle}>🍽️ Menu AI</div>
          <div style={styles.headerSub}>Tavolo {params.table}</div>
        </div>
        {orderConfirmed && <span style={styles.orderBadge}>✓ Ordinato</span>}
      </header>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} style={msg.role === 'user' ? styles.bubbleUser : styles.bubbleAI}>
            <div style={msg.role === 'user' ? styles.bubbleUserInner : styles.bubbleAIInner}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={styles.bubbleAI}>
            <div style={styles.bubbleAIInner}>
              <span style={styles.typing}>● ● ●</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <input
          style={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder={
            lang === 'en' ? 'Write a message...' :
            lang === 'de' ? 'Nachricht schreiben...' :
            lang === 'es' ? 'Escribe un mensaje...' :
            'Scrivi un messaggio...'
          }
          disabled={loading}
        />
        <button style={styles.sendBtn} onClick={sendMessage} disabled={loading || !input.trim()}>
          ➤
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  langScreen: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100dvh', gap: 32, padding: 24,
    background: 'linear-gradient(160deg, #0f0f1a 0%, #1a1a2e 100%)',
  },
  logoArea: { textAlign: 'center' },
  logo: { fontSize: 72, marginBottom: 12 },
  logoTitle: { fontSize: 32, fontWeight: 700, color: '#eaeaea', marginBottom: 8 },
  logoSub: { fontSize: 14, color: '#a8a8b3' },
  langGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 320 },
  langBtn: {
    padding: '16px 12px', borderRadius: 12, fontSize: 16, fontWeight: 600,
    background: '#16213e', color: '#eaeaea', border: '1.5px solid #2a2a4a',
    transition: 'all 0.2s', cursor: 'pointer',
  },
  tableTag: { color: '#a8a8b3', fontSize: 13 },

  chatScreen: { display: 'flex', flexDirection: 'column', height: '100dvh' },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 16px', background: '#16213e',
    borderBottom: '1px solid #2a2a4a', flexShrink: 0,
  },
  backBtn: { background: 'none', color: '#a8a8b3', fontSize: 20, padding: 4 },
  headerTitle: { fontWeight: 700, fontSize: 16, color: '#eaeaea' },
  headerSub: { fontSize: 12, color: '#a8a8b3' },
  orderBadge: {
    marginLeft: 'auto', background: '#22c55e22', color: '#22c55e',
    padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
  },

  messages: {
    flex: 1, overflowY: 'auto', padding: '16px 12px',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  bubbleUser: { display: 'flex', justifyContent: 'flex-end' },
  bubbleAI: { display: 'flex', justifyContent: 'flex-start' },
  bubbleUserInner: {
    maxWidth: '78%', background: '#0f3460', color: '#eaeaea',
    borderRadius: '18px 18px 4px 18px', padding: '10px 14px',
    fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap',
  },
  bubbleAIInner: {
    maxWidth: '82%', background: '#1a1a2e', color: '#eaeaea',
    borderRadius: '18px 18px 18px 4px', padding: '10px 14px',
    fontSize: 15, lineHeight: 1.5, border: '1px solid #2a2a4a',
    whiteSpace: 'pre-wrap',
  },
  typing: { color: '#e94560', letterSpacing: 4, fontSize: 12 },

  inputArea: {
    display: 'flex', gap: 8, padding: '12px 12px 16px',
    background: '#16213e', borderTop: '1px solid #2a2a4a', flexShrink: 0,
  },
  input: {
    flex: 1, background: '#0f0f1a', color: '#eaeaea', border: '1.5px solid #2a2a4a',
    borderRadius: 24, padding: '10px 16px', fontSize: 15, outline: 'none',
  },
  sendBtn: {
    background: '#e94560', color: 'white', borderRadius: '50%',
    width: 44, height: 44, fontSize: 18, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  confirmScreen: {
    padding: 24, display: 'flex', flexDirection: 'column',
    gap: 20, minHeight: '100dvh', background: '#0f0f1a',
  },
  confirmTitle: { fontSize: 22, fontWeight: 700, color: '#eaeaea' },
  orderItems: {
    background: '#16213e', borderRadius: 12, overflow: 'hidden',
    border: '1px solid #2a2a4a',
  },
  orderItem: {
    display: 'flex', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #2a2a4a',
    color: '#eaeaea', fontSize: 15,
  },
  orderTotal: {
    display: 'flex', justifyContent: 'space-between',
    padding: '14px 16px', color: '#e94560', fontSize: 17,
  },
  confirmBtns: { display: 'flex', gap: 12 },
  btnCancel: {
    flex: 1, padding: '14px', borderRadius: 12, fontSize: 16,
    background: '#1a1a2e', color: '#a8a8b3', border: '1.5px solid #2a2a4a',
  },
  btnConfirm: {
    flex: 2, padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 700,
    background: '#e94560', color: 'white',
  },
};
