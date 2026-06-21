import { useState, useEffect, useRef, Component, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, color: '#e94560', background: '#0f0f1a', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#eaeaea' }}>Errore inatteso</div>
        <div style={{ fontSize: 13, color: '#a8a8b3', textAlign: 'center' }}>{this.state.error}</div>
        <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', background: '#e94560', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, cursor: 'pointer' }}>Ricarica</button>
      </div>
    );
    return this.props.children;
  }
}

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function getQRParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    restaurant: p.get('restaurant') ?? 'da-mario',
    table: parseInt(p.get('table') ?? '1'),
    lang: p.get('lang') ?? navigator.language.slice(0, 2) ?? 'it',
  };
}

interface Message { role: 'user' | 'assistant'; content: string; timestamp: string; }
interface OrderData { items: Array<{ dish_id: string; dish_name: string; qty: number; unit_price: number }>; }
interface Dish { id: string; name: string; description: string; price: number; category: string; available: boolean; }

type Screen = 'lang' | 'main' | 'confirm_order';
type Tab = 'menu' | 'chat';

const LANG_OPTIONS = [
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'es', label: '🇪🇸 Español' },
];

const CAT_LABELS: Record<string, Record<string, string>> = {
  antipasti: { it: 'Antipasti', en: 'Starters', de: 'Vorspeisen', es: 'Entrantes' },
  pizze:     { it: 'Pizze', en: 'Pizzas', de: 'Pizzen', es: 'Pizzas' },
  primi:     { it: 'Primi Piatti', en: 'Pasta & Risotto', de: 'Erste Gänge', es: 'Primeros Platos' },
  secondi:   { it: 'Secondi', en: 'Main Courses', de: 'Hauptgerichte', es: 'Segundos Platos' },
  dolci:     { it: 'Dolci', en: 'Desserts', de: 'Desserts', es: 'Postres' },
  cocktails: { it: 'Cocktails', en: 'Cocktails', de: 'Cocktails', es: 'Cócteles' },
  spirits:   { it: 'Spirits & Liquori', en: 'Spirits & Liqueurs', de: 'Spirituosen', es: 'Licores & Spirits' },
  birre:     { it: 'Birre', en: 'Beers', de: 'Biere', es: 'Cervezas' },
  vini:      { it: 'Vini', en: 'Wines', de: 'Weine', es: 'Vinos' },
  soft_drinks: { it: 'Analcolici', en: 'Soft Drinks', de: 'Alkoholfrei', es: 'Refrescos' },
};
function catLabel(cat: string, lang: string) { return CAT_LABELS[cat]?.[lang] ?? CAT_LABELS[cat]?.['it'] ?? cat; }
const CAT_ICONS: Record<string, string> = {
  antipasti: '🥗', pizze: '🍕', primi: '🍝', secondi: '🥩',
  dolci: '🍮', cocktails: '🍹', spirits: '🥃', birre: '🍺', vini: '🍷', soft_drinks: '🥤',
};
const CAT_ORDER = ['antipasti','pizze','primi','secondi','dolci','cocktails','spirits','birre','vini','soft_drinks'];

export default function App() {
  const params = getQRParams();
  const [screen, setScreen] = useState<Screen>('lang');
  const [tab, setTab] = useState<Tab>('menu');
  const [lang, setLang] = useState(params.lang);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<OrderData | null>(null);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('antipasti');
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function startSession(selectedLang: string) {
    setLang(selectedLang);
    setStartError(null);
    setLoading(true);
    try {
      // Menu e sessione in parallelo
      const [menuRes, sessionRes] = await Promise.all([
        fetch(`${API}/api/menu/${params.restaurant}/dishes/translated?lang=es`),
        fetch(`${API}/api/chat/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurant_slug: params.restaurant, table_number: params.table, language: selectedLang }),
        }),
      ]);
      if (!menuRes.ok) throw new Error(`Menu ${menuRes.status}`);
      if (!sessionRes.ok) throw new Error(`Session ${sessionRes.status}`);

      const [menuData, sessionData]: [Dish[], { session_id: string; welcome_message: string }] =
        await Promise.all([menuRes.json(), sessionRes.json()]);

      const available = menuData.filter(d => d.available);
      setDishes(available);
      const firstCat = CAT_ORDER.find(c => available.some(d => d.category === c)) ?? available[0]?.category ?? 'antipasti';
      setSelectedCat(firstCat);
      setSessionId(sessionData.session_id);
      setMessages([{ role: 'assistant', content: sessionData.welcome_message, timestamp: new Date().toISOString() }]);
      setScreen('main');
    } catch (err) {
      setStartError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(text?: string) {
    const msg = text ?? input.trim();
    if (!msg || !sessionId || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }]);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/chat/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, timestamp: new Date().toISOString() }]);
      if (data.order_data) { setPendingOrder(data.order_data); setScreen('confirm_order'); }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Errore di rete. Riprova.', timestamp: new Date().toISOString() }]);
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
        body: JSON.stringify({ session_id: sessionId, items: pendingOrder.items, language: lang }),
      });
      setOrderConfirmed(true);
      setPendingOrder(null);
      setScreen('main');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: lang === 'de' ? '✅ Bestellung erhalten!' : lang === 'en' ? '✅ Order received!' : lang === 'es' ? '✅ ¡Pedido recibido!' : '✅ Ordine ricevuto!',
        timestamp: new Date().toISOString(),
      }]);
    } catch { alert('Errore conferma ordine'); } finally { setLoading(false); }
  }

  async function openDish(dish: Dish) {
    setSelectedDish(dish);
    setTranslatedDesc(null);
    if (lang === 'es' || !dish.description) return;
    try {
      const res = await fetch(`${API}/api/menu/translate-desc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: dish.description, lang }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranslatedDesc(data.translated);
      }
    } catch { /* mostra originale */ }
  }

  function askAboutDish(dish: Dish) {
    setSelectedDish(null);
    setTab('chat');
    const isDrink = ['cocktails', 'spirits', 'birre', 'vini', 'soft_drinks'].includes(dish.category);
    let prompt = '';
    if (isDrink) {
      prompt = lang === 'en'
        ? `Tell me about "${dish.name}": what it tastes like, how it's served, and what food would pair well with it.`
        : lang === 'de'
        ? `Erkläre mir "${dish.name}": Geschmack, wie es serviert wird und welche Speisen dazu passen.`
        : lang === 'es'
        ? `Cuéntame sobre "${dish.name}": cómo sabe, cómo se sirve y qué platos maridan bien.`
        : `Parlami di "${dish.name}": com'è, come si serve e con quali piatti si abbina.`;
    } else {
      prompt = lang === 'en'
        ? `Tell me about "${dish.name}": ingredients, flavor, and what drink would you recommend with it.`
        : lang === 'de'
        ? `Erkläre mir "${dish.name}": Zutaten, Geschmack und welches Getränk du dazu empfiehlst.`
        : lang === 'es'
        ? `Cuéntame sobre "${dish.name}": ingredientes, sabor y qué bebida recomiendas para acompañarlo.`
        : `Parlami di "${dish.name}": ingredienti, sapore e cosa consigli da bere in abbinamento.`;
    }
    sendMessage(prompt);
  }

  // ─── Lingua / Loading / Errore ────────────────────────────
  if (screen === 'lang') {
    if (loading) {
      return (
        <div style={S.loadingScreen}>
          <div style={S.spinner} />
          <p style={S.loadingText}>
            {lang === 'en' ? 'Loading menu...' : lang === 'de' ? 'Lade Menü...' : lang === 'es' ? 'Cargando carta...' : 'Caricamento menu...'}
          </p>
          <p style={S.loadingSubText}>
            {lang === 'es' ? 'El primer inicio puede tardar 30 segundos' : 'Il primo avvio può richiedere 30 secondi'}
          </p>
        </div>
      );
    }
    return (
      <div style={S.langScreen}>
        <div style={S.logoArea}>
          <div style={S.logo}>🍽️</div>
          <h1 style={S.logoTitle}>Benvenuto</h1>
          <p style={S.logoSub}>Scegli la tua lingua / Choose your language</p>
        </div>
        {startError && (
          <div style={S.errorBox}>
            ⚠️ Connessione lenta. Riprova.
            <br /><span style={{ fontSize: 11, opacity: 0.6 }}>{startError}</span>
          </div>
        )}
        <div style={S.langGrid}>
          {LANG_OPTIONS.map(opt => (
            <button key={opt.code} style={S.langBtn} onClick={() => startSession(opt.code)}>{opt.label}</button>
          ))}
        </div>
        <p style={S.tableTag}>Tavolo {params.table}</p>
      </div>
    );
  }

  // ─── Conferma ordine ──────────────────────────────────────
  if (screen === 'confirm_order' && pendingOrder) {
    const total = pendingOrder.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    return (
      <div style={S.confirmScreen}>
        <h2 style={S.confirmTitle}>
          {lang === 'de' ? '📋 Bestellung bestätigen' : lang === 'en' ? '📋 Confirm order' : lang === 'es' ? '📋 Confirmar pedido' : '📋 Conferma ordine'}
        </h2>
        <div style={S.orderItems}>
          {pendingOrder.items.map((item, i) => (
            <div key={i} style={S.orderItem}>
              <span>{item.qty}× {item.dish_name}</span>
              <span>€{(item.unit_price * item.qty).toFixed(2)}</span>
            </div>
          ))}
          <div style={S.orderTotal}><strong>Totale</strong><strong>€{total.toFixed(2)}</strong></div>
        </div>
        <div style={S.confirmBtns}>
          <button style={S.btnCancel} onClick={() => setScreen('main')}>
            {lang === 'en' ? 'Modify' : lang === 'de' ? 'Ändern' : lang === 'es' ? 'Modificar' : 'Modifica'}
          </button>
          <button style={S.btnConfirm} onClick={confirmOrder} disabled={loading}>
            {loading ? '...' : lang === 'en' ? 'Confirm ✓' : lang === 'de' ? 'Bestätigen ✓' : lang === 'es' ? 'Confirmar ✓' : 'Conferma ✓'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Dettaglio piatto (modal) ──────────────────────────────
  const cats = CAT_ORDER.filter(c => dishes.some(d => d.category === c));
  const visibleDishes = dishes.filter(d => d.category === selectedCat);

  return (
    <div style={S.appWrap}>
      {/* Header */}
      <header style={S.header}>
        <button style={S.backBtn} onClick={() => setScreen('lang')}>←</button>
        <div style={{ flex: 1 }}>
          <div style={S.headerTitle}>🍽️ Menu AI</div>
          <div style={S.headerSub}>Tavolo {params.table}</div>
        </div>
        {orderConfirmed && <span style={S.orderBadge}>✓ Ordinato</span>}
      </header>

      {/* Tab bar */}
      <div style={S.tabBar}>
        <button style={tab === 'menu' ? S.tabActive : S.tabInactive} onClick={() => setTab('menu')}>
          🍽️ {lang === 'en' ? 'Menu' : lang === 'es' ? 'Carta' : 'Menu'}
        </button>
        <button style={tab === 'chat' ? S.tabActive : S.tabInactive} onClick={() => setTab('chat')}>
          💬 {lang === 'en' ? 'Assistant' : lang === 'de' ? 'Assistent' : lang === 'es' ? 'Asistente' : 'Assistente'}
          {messages.length > 1 && tab !== 'chat' && <span style={S.chatDot} />}
        </button>
      </div>

      {/* ── TAB MENU ── */}
      {tab === 'menu' && (
        <div style={S.menuWrap}>
          {/* Category pills */}
          <div style={S.catScroll}>
            {cats.map(c => (
              <button
                key={c}
                style={selectedCat === c ? S.catPillActive : S.catPill}
                onClick={() => setSelectedCat(c)}
              >
                {CAT_ICONS[c]} {catLabel(c, lang)}
              </button>
            ))}
          </div>

          {/* Dish cards */}
          <div style={S.dishGrid}>
            {visibleDishes.map(dish => (
              <button key={dish.id} style={S.dishCard} onClick={() => openDish(dish)}>
                <div style={S.dishIcon}>{CAT_ICONS[dish.category]}</div>
                <div style={S.dishInfo}>
                  <div style={S.dishName}>{dish.name}</div>
                  <div style={S.dishDesc}>{dish.description}</div>
                </div>
                <div style={S.dishPrice}>€{parseFloat(String(dish.price ?? 0)).toFixed(2)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB CHAT ── */}
      {tab === 'chat' && (
        <>
          <div style={S.messages}>
            {messages.map((msg, i) => (
              <div key={i} style={msg.role === 'user' ? S.bubbleUser : S.bubbleAI}>
                <div style={msg.role === 'user' ? S.bubbleUserInner : S.bubbleAIInner}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={S.bubbleAI}>
                <div style={S.bubbleAIInner}><span style={S.typing}>● ● ●</span></div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={S.inputArea}>
            <input
              style={S.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={lang === 'en' ? 'Write a message...' : lang === 'de' ? 'Nachricht...' : lang === 'es' ? 'Escribe...' : 'Scrivi un messaggio...'}
              disabled={loading}
            />
            <button style={S.sendBtn} onClick={() => sendMessage()} disabled={loading || !input.trim()}>➤</button>
          </div>
        </>
      )}

      {/* ── MODAL PIATTO ── */}
      {selectedDish && (
        <div style={S.modalOverlay} onClick={() => setSelectedDish(null)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <div style={S.modalIcon}>{CAT_ICONS[selectedDish.category]}</div>
            <h2 style={S.modalTitle}>{selectedDish.name}</h2>
            <div style={S.modalPrice}>€{parseFloat(String(selectedDish.price ?? 0)).toFixed(2)}</div>
            {(translatedDesc ?? selectedDish.description) && (
              <p style={S.modalDesc}>
                {translatedDesc ?? selectedDish.description}
                {!translatedDesc && lang !== 'es' && <span style={{ opacity: 0.4, fontSize: 11 }}> ↻</span>}
              </p>
            )}
            <button style={S.modalAskBtn} onClick={() => askAboutDish(selectedDish)}>
              💬 {lang === 'en' ? 'Ask the AI about this dish' : lang === 'de' ? 'KI fragen' : lang === 'es' ? 'Preguntar al asistente' : 'Chiedi all\'assistente AI'}
            </button>
            <button style={S.modalClose} onClick={() => setSelectedDish(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  appWrap: { display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0f0f1a', overflow: 'hidden' },
  loadingScreen: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 16, background: '#0f0f1a' },
  spinner: { width: 48, height: 48, border: '4px solid #2a2a4a', borderTop: '4px solid #e94560', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  loadingText: { fontSize: 18, fontWeight: 600, color: '#eaeaea' },
  loadingSubText: { fontSize: 13, color: '#a8a8b3', textAlign: 'center', padding: '0 32px' },
  errorBox: { background: '#2a1a1a', border: '1px solid #e94560', color: '#e94560', borderRadius: 10, padding: '12px 16px', fontSize: 14, textAlign: 'center', maxWidth: 320, width: '100%' },

  langScreen: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 32, padding: 24, background: 'linear-gradient(160deg, #0f0f1a 0%, #1a1a2e 100%)' },
  logoArea: { textAlign: 'center' },
  logo: { fontSize: 72, marginBottom: 12 },
  logoTitle: { fontSize: 32, fontWeight: 700, color: '#eaeaea', marginBottom: 8 },
  logoSub: { fontSize: 14, color: '#a8a8b3' },
  langGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 320 },
  langBtn: { padding: '16px 12px', borderRadius: 12, fontSize: 16, fontWeight: 600, background: '#16213e', color: '#eaeaea', border: '1.5px solid #2a2a4a', cursor: 'pointer' },
  tableTag: { color: '#a8a8b3', fontSize: 13 },

  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#16213e', borderBottom: '1px solid #2a2a4a', flexShrink: 0 },
  backBtn: { background: 'none', color: '#a8a8b3', fontSize: 20, padding: 4, border: 'none', cursor: 'pointer' },
  headerTitle: { fontWeight: 700, fontSize: 16, color: '#eaeaea' },
  headerSub: { fontSize: 12, color: '#a8a8b3' },
  orderBadge: { background: '#22c55e22', color: '#22c55e', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 },

  tabBar: { display: 'flex', background: '#16213e', borderBottom: '1px solid #2a2a4a', flexShrink: 0 },
  tabActive: { flex: 1, padding: '12px', fontSize: 14, fontWeight: 700, color: '#e94560', background: 'none', border: 'none', borderBottom: '2px solid #e94560', cursor: 'pointer', position: 'relative' },
  tabInactive: { flex: 1, padding: '12px', fontSize: 14, fontWeight: 500, color: '#a8a8b3', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', position: 'relative' },
  chatDot: { position: 'absolute', top: 8, right: 'calc(50% - 20px)', width: 8, height: 8, borderRadius: '50%', background: '#e94560' },

  // Menu tab
  menuWrap: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  catScroll: { display: 'flex', gap: 8, padding: '12px 12px 8px', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' },
  catPill: { flexShrink: 0, padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, background: '#16213e', color: '#a8a8b3', border: '1.5px solid #2a2a4a', cursor: 'pointer', whiteSpace: 'nowrap' },
  catPillActive: { flexShrink: 0, padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: '#e94560', color: '#fff', border: '1.5px solid #e94560', cursor: 'pointer', whiteSpace: 'nowrap' },
  dishGrid: { flex: 1, overflowY: 'auto', padding: '8px 12px 24px', display: 'flex', flexDirection: 'column', gap: 10 },
  dishCard: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
    background: '#16213e', borderRadius: 14, border: '1px solid #2a2a4a',
    cursor: 'pointer', textAlign: 'left', width: '100%',
    transition: 'border-color 0.2s',
  },
  dishIcon: { fontSize: 28, flexShrink: 0 },
  dishInfo: { flex: 1, minWidth: 0 },
  dishName: { fontWeight: 700, fontSize: 15, color: '#eaeaea', marginBottom: 3 },
  dishDesc: { fontSize: 12, color: '#a8a8b3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dishPrice: { fontWeight: 700, fontSize: 16, color: '#e94560', flexShrink: 0 },

  // Chat tab
  messages: { flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 12 },
  bubbleUser: { display: 'flex', justifyContent: 'flex-end' },
  bubbleAI: { display: 'flex', justifyContent: 'flex-start' },
  bubbleUserInner: { maxWidth: '78%', background: '#0f3460', color: '#eaeaea', borderRadius: '18px 18px 4px 18px', padding: '10px 14px', fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  bubbleAIInner: { maxWidth: '82%', background: '#1a1a2e', color: '#eaeaea', borderRadius: '18px 18px 18px 4px', padding: '10px 14px', fontSize: 15, lineHeight: 1.5, border: '1px solid #2a2a4a', whiteSpace: 'pre-wrap' },
  typing: { color: '#e94560', letterSpacing: 4, fontSize: 12 },
  inputArea: { display: 'flex', gap: 8, padding: '12px 12px 16px', background: '#16213e', borderTop: '1px solid #2a2a4a', flexShrink: 0 },
  input: { flex: 1, background: '#0f0f1a', color: '#eaeaea', border: '1.5px solid #2a2a4a', borderRadius: 24, padding: '10px 16px', fontSize: 15, outline: 'none' },
  sendBtn: { background: '#e94560', color: 'white', borderRadius: '50%', width: 44, height: 44, fontSize: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 100 },
  modalBox: { background: '#16213e', borderRadius: '24px 24px 0 0', padding: '28px 24px 40px', width: '100%', position: 'relative', border: '1px solid #2a2a4a' },
  modalIcon: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 22, fontWeight: 700, color: '#eaeaea', textAlign: 'center', marginBottom: 6 },
  modalPrice: { fontSize: 24, fontWeight: 800, color: '#e94560', textAlign: 'center', marginBottom: 14 },
  modalDesc: { fontSize: 14, color: '#c8c8d4', lineHeight: 1.6, textAlign: 'center', marginBottom: 24 },
  modalAskBtn: { display: 'block', width: '100%', padding: '16px', borderRadius: 14, fontSize: 16, fontWeight: 700, background: '#e94560', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 12 },
  modalClose: { position: 'absolute', top: 16, right: 16, background: '#2a2a4a', color: '#a8a8b3', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 14, cursor: 'pointer' },

  // Confirm
  confirmScreen: { padding: 24, display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100dvh', background: '#0f0f1a' },
  confirmTitle: { fontSize: 22, fontWeight: 700, color: '#eaeaea' },
  orderItems: { background: '#16213e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a4a' },
  orderItem: { display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2a2a4a', color: '#eaeaea', fontSize: 15 },
  orderTotal: { display: 'flex', justifyContent: 'space-between', padding: '14px 16px', color: '#e94560', fontSize: 17 },
  confirmBtns: { display: 'flex', gap: 12 },
  btnCancel: { flex: 1, padding: '14px', borderRadius: 12, fontSize: 16, background: '#1a1a2e', color: '#a8a8b3', border: '1.5px solid #2a2a4a', cursor: 'pointer' },
  btnConfirm: { flex: 2, padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 700, background: '#e94560', color: 'white', border: 'none', cursor: 'pointer' },
};
