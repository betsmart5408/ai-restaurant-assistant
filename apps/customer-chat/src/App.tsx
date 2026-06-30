import { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';

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
    restaurant: p.get('restaurant') ?? 'gusto-alcazabilla',
    table: parseInt(p.get('table') ?? '1'),
    lang: p.get('lang') ?? navigator.language.slice(0, 2) ?? 'it',
  };
}

interface Message { role: 'user' | 'assistant'; content: string; timestamp: string; }
interface Dish { id: string; name: string; description: string; price: number; category: string; available: boolean; image_url?: string; }

// Converte **bold**, *italic*, _italic_ e \n in React nodes
function renderMarkdown(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\n)/g;
  let last = 0, i = 0, match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) result.push(text.slice(last, match.index));
    const m = match[0];
    if (m === '\n') result.push(<br key={i} />);
    else if (m.startsWith('**')) result.push(<strong key={i}>{m.slice(2, -2)}</strong>);
    else result.push(<em key={i}>{m.slice(1, -1)}</em>);
    last = match.index + m.length;
    i++;
  }
  if (last < text.length) result.push(text.slice(last));
  return result;
}

const STORAGE_KEY = (restaurant: string) => `gusto_prefs_${restaurant}`;
interface SavedPrefs { allergies: string; groupSize: number; }
function loadPrefs(restaurant: string): SavedPrefs | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY(restaurant)) ?? 'null'); } catch { return null; }
}
function savePrefs(restaurant: string, prefs: SavedPrefs) {
  try { localStorage.setItem(STORAGE_KEY(restaurant), JSON.stringify(prefs)); } catch {}
}

const SESSION_KEY = (restaurant: string, table: number) => `gusto_session_${restaurant}_${table}`;
const HISTORY_KEY = (restaurant: string) => `gusto_history_${restaurant}`;
const SAVED_DISHES_KEY = (restaurant: string, table: number) => `gusto_saved_${restaurant}_${table}`;

interface SavedDishesStore { items: SavedDishItem[]; savedAt: string; }
function saveDishList(restaurant: string, table: number, items: SavedDishItem[]) {
  try { localStorage.setItem(SAVED_DISHES_KEY(restaurant, table), JSON.stringify({ items, savedAt: new Date().toISOString() })); } catch {}
}
function loadDishList(restaurant: string, table: number): SavedDishItem[] {
  try {
    const raw: SavedDishesStore = JSON.parse(localStorage.getItem(SAVED_DISHES_KEY(restaurant, table)) ?? 'null');
    if (!raw) return [];
    const hours = (Date.now() - new Date(raw.savedAt).getTime()) / 3600000;
    if (hours >= 12) { localStorage.removeItem(SAVED_DISHES_KEY(restaurant, table)); return []; }
    return raw.items ?? [];
  } catch { return []; }
}
interface SavedSession { sessionId: string; lang: string; messages: Message[]; alreadyOrdered: string; joinedExisting: boolean; savedAt?: string; }
interface CustomerHistory { lastVisitAt: string; mentionedDishes: string[]; lang: string; }

function saveSession(restaurant: string, table: number, data: SavedSession) {
  try { localStorage.setItem(SESSION_KEY(restaurant, table), JSON.stringify({ ...data, savedAt: new Date().toISOString() })); } catch {}
}
function loadSession(restaurant: string, table: number): SavedSession | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY(restaurant, table)) ?? 'null'); } catch { return null; }
}
function clearSession(restaurant: string, table: number) {
  try { localStorage.removeItem(SESSION_KEY(restaurant, table)); } catch {}
}

// Estrae i piatti menzionati dai messaggi dell'assistente (nomi in grassetto o dopo "consiglio")
function extractMentionedDishes(messages: Message[]): string[] {
  const dishes = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    // Cattura parole in grassetto **nome** o *nome*
    const bold = m.content.matchAll(/\*{1,2}([^*\n]{3,40})\*{1,2}/g);
    for (const match of bold) dishes.add(match[1].trim());
  }
  return [...dishes].slice(0, 10);
}

function saveCustomerHistory(restaurant: string, messages: Message[], lang: string) {
  try {
    const history: CustomerHistory = {
      lastVisitAt: new Date().toISOString(),
      mentionedDishes: extractMentionedDishes(messages),
      lang,
    };
    localStorage.setItem(HISTORY_KEY(restaurant), JSON.stringify(history));
  } catch {}
}

function loadCustomerHistory(restaurant: string): CustomerHistory | null {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY(restaurant)) ?? 'null'); } catch { return null; }
}

function isReturningCustomer(history: CustomerHistory | null): boolean {
  if (!history) return false;
  const diffHours = (Date.now() - new Date(history.lastVisitAt).getTime()) / 3600000;
  return diffHours >= 12;
}

type Screen = 'lang' | 'main' | 'saved_dishes';
type Tab = 'menu' | 'chat';
interface SavedDishItem { dish: Dish; qty: number; }

const LANG_OPTIONS = [
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'pt', label: '🇵🇹 Português' },
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'zh', label: '🇨🇳 中文' },
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'ar', label: '🇸🇦 العربية' },
];

const UI: Record<string, Record<string, string>> = {
  menu:        { it: 'Menu', en: 'Menu', de: 'Speisekarte', es: 'Carta', fr: 'Menu', pt: 'Menu', ru: 'Меню', zh: '菜单', ja: 'メニュー', ar: 'قائمة' },
  assistant:   { it: 'Assistente', en: 'Assistant', de: 'Assistent', es: 'Asistente', fr: 'Assistant', pt: 'Assistente', ru: 'Ассистент', zh: '助手', ja: 'アシスタント', ar: 'مساعد' },
  write:       { it: 'Scrivi un messaggio...', en: 'Write a message...', de: 'Nachricht...', es: 'Escribe...', fr: 'Écris un message...', pt: 'Escreva...', ru: 'Написать...', zh: '输入消息...', ja: 'メッセージを入力...', ar: 'اكتب رسالة...' },
  listening:   { it: '🎤 Sto ascoltando...', en: '🎤 Listening...', de: '🎤 Ich höre zu...', es: '🎤 Escuchando...', fr: '🎤 J\'écoute...', pt: '🎤 Ouvindo...', ru: '🎤 Слушаю...', zh: '🎤 正在聆听...', ja: '🎤 聞いています...', ar: '🎤 أستمع...' },
  confirm:     { it: '📋 Conferma ordine', en: '📋 Confirm order', de: '📋 Bestellung bestätigen', es: '📋 Confirmar pedido', fr: '📋 Confirmer la commande', pt: '📋 Confirmar pedido', ru: '📋 Подтвердить заказ', zh: '📋 确认订单', ja: '📋 注文確認', ar: '📋 تأكيد الطلب' },
  modify:      { it: 'Modifica', en: 'Modify', de: 'Ändern', es: 'Modificar', fr: 'Modifier', pt: 'Modificar', ru: 'Изменить', zh: '修改', ja: '修正', ar: 'تعديل' },
  confirmBtn:  { it: 'Conferma ✓', en: 'Confirm ✓', de: 'Bestätigen ✓', es: 'Confirmar ✓', fr: 'Confirmer ✓', pt: 'Confirmar ✓', ru: 'Подтвердить ✓', zh: '确认 ✓', ja: '確認 ✓', ar: 'تأكيد ✓' },
  ordered:     { it: '✓ Ordinato', en: '✓ Ordered', de: '✓ Bestellt', es: '✓ Pedido', fr: '✓ Commandé', pt: '✓ Pedido', ru: '✓ Заказано', zh: '✓ 已点', ja: '✓ 注文済', ar: '✓ تم الطلب' },
  orderOk:     { it: '✅ Ordine ricevuto! Buon appetito!', en: '✅ Order received! Enjoy!', de: '✅ Bestellung erhalten! Guten Appetit!', es: '✅ ¡Pedido recibido! ¡Que lo disfruten!', fr: '✅ Commande reçue ! Bon appétit !', pt: '✅ Pedido recebido! Bom apetite!', ru: '✅ Заказ принят! Приятного аппетита!', zh: '✅ 订单已收到！请慢用！', ja: '✅ ご注文を承りました！どうぞ！', ar: '✅ تم استلام طلبك! بالهناء!' },
  askMarco:    { it: 'Chiedi a Marco', en: 'Ask Marco', de: 'Marco fragen', es: 'Preguntar a Marco', fr: 'Demander à Marco', pt: 'Perguntar ao Marco', ru: 'Спросить Марко', zh: '询问Marco', ja: 'Marcoに聞く', ar: 'اسأل Marco' },
  addOrder:    { it: '💾 Salva piatto', en: '💾 Save dish', de: '💾 Merken', es: '💾 Guardar plato', fr: '💾 Sauvegarder', pt: '💾 Guardar prato', ru: '💾 Сохранить', zh: '💾 保存菜品', ja: '💾 保存する', ar: '💾 احفظ الطبق' },
  savedList:   { it: '🍽️ I tuoi piatti salvati', en: '🍽️ Your saved dishes', de: '🍽️ Gemerkte Gerichte', es: '🍽️ Tus platos guardados', fr: '🍽️ Vos plats sauvegardés', pt: '🍽️ Os seus pratos guardados', ru: '🍽️ Сохранённые блюда', zh: '🍽️ 已保存的菜肴', ja: '🍽️ 保存した料理', ar: '🍽️ أطباقك المحفوظة' },
  savedEmpty:  { it: 'Nessun piatto salvato', en: 'No saved dishes', de: 'Keine Gerichte gemerkt', es: 'Ningún plato guardado', fr: 'Aucun plat sauvegardé', pt: 'Nenhum prato guardado', ru: 'Нет сохранённых блюд', zh: '没有保存的菜肴', ja: '保存した料理はありません', ar: 'لا توجد أطباق محفوظة' },
  savedNote:   { it: '⚠️ Il personale prenderà il tuo ordine al tavolo', en: '⚠️ Staff will take your order at the table', de: '⚠️ Das Personal nimmt Ihre Bestellung am Tisch auf', es: '⚠️ El personal tomará su pedido en la mesa', fr: '⚠️ Le personnel prendra votre commande à table', pt: '⚠️ O pessoal tomará o seu pedido na mesa', ru: '⚠️ Персонал примет ваш заказ за столом', zh: '⚠️ 服务员将在桌边为您点餐', ja: '⚠️ スタッフがテーブルでご注文を承ります', ar: '⚠️ سيأخذ الموظفون طلبك على الطاولة' },
  total:       { it: 'Totale stimato', en: 'Estimated total', de: 'Geschätztes Gesamt', es: 'Total estimado', fr: 'Total estimé', pt: 'Total estimado', ru: 'Примерная сумма', zh: '预计总计', ja: '合計（目安）', ar: 'المجموع التقديري' },
  sharedTable: { it: 'Sessione tavolo condivisa', en: 'Shared table', de: 'Gemeinsamer Tisch', es: 'Mesa compartida', fr: 'Table partagée', pt: 'Mesa compartilhada', ru: 'Общий стол', zh: '共享桌台', ja: 'テーブル共有', ar: 'طاولة مشتركة' },
  alreadyOrd:  { it: 'Già ordinato', en: 'Already ordered', de: 'Bereits bestellt', es: 'Ya pedido', fr: 'Déjà commandé', pt: 'Já pedido', ru: 'Уже заказано', zh: '已点', ja: '注文済み', ar: 'تم الطلب' },
};
function t(key: string, lang: string) { return UI[key]?.[lang] ?? UI[key]?.['it'] ?? key; }

const CAT_LABELS: Record<string, Record<string, string>> = {
  antipasti:   { it: 'Antipasti', en: 'Starters', de: 'Vorspeisen', es: 'Entrantes', fr: 'Entrées', pt: 'Entradas', ru: 'Закуски', zh: '前菜', ja: '前菜', ar: 'مقبلات' },
  pizze:       { it: 'Pizze', en: 'Pizzas', de: 'Pizzen', es: 'Pizzas', fr: 'Pizzas', pt: 'Pizzas', ru: 'Пиццы', zh: '披萨', ja: 'ピザ', ar: 'بيتزا' },
  primi:       { it: 'Primi Piatti', en: 'Pasta & Risotto', de: 'Erste Gänge', es: 'Primeros Platos', fr: 'Pâtes & Risotto', pt: 'Massas', ru: 'Паста', zh: '主食', ja: 'パスタ', ar: 'معكرونة' },
  secondi:     { it: 'Secondi', en: 'Main Courses', de: 'Hauptgerichte', es: 'Segundos Platos', fr: 'Plats Principaux', pt: 'Pratos Principais', ru: 'Основные', zh: '主菜', ja: 'メイン', ar: 'أطباق رئيسية' },
  dolci:       { it: 'Dolci', en: 'Desserts', de: 'Desserts', es: 'Postres', fr: 'Desserts', pt: 'Sobremesas', ru: 'Десерты', zh: '甜点', ja: 'デザート', ar: 'حلويات' },
  cocktails:   { it: 'Cocktails', en: 'Cocktails', de: 'Cocktails', es: 'Cócteles', fr: 'Cocktails', pt: 'Cocktails', ru: 'Коктейли', zh: '鸡尾酒', ja: 'カクテル', ar: 'كوكتيل' },
  spirits:     { it: 'Spirits & Liquori', en: 'Spirits & Liqueurs', de: 'Spirituosen', es: 'Licores', fr: 'Spiritueux', pt: 'Destilados', ru: 'Спиртное', zh: '烈酒', ja: 'スピリッツ', ar: 'مشروبات روحية' },
  birre:       { it: 'Birre', en: 'Beers', de: 'Biere', es: 'Cervezas', fr: 'Bières', pt: 'Cervejas', ru: 'Пиво', zh: '啤酒', ja: 'ビール', ar: 'بيرة' },
  vini:        { it: 'Vini', en: 'Wines', de: 'Weine', es: 'Vinos', fr: 'Vins', pt: 'Vinhos', ru: 'Вина', zh: '葡萄酒', ja: 'ワイン', ar: 'نبيذ' },
  soft_drinks: { it: 'Analcolici', en: 'Soft Drinks', de: 'Alkoholfrei', es: 'Refrescos', fr: 'Sans Alcool', pt: 'Refrigerantes', ru: 'Безалкогольные', zh: '软饮', ja: 'ソフトドリンク', ar: 'مشروبات خفيفة' },
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
  const [savedDishes, setSavedDishes] = useState<SavedDishItem[]>(() => loadDishList(getQRParams().restaurant, getQRParams().table));
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('antipasti');
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
  const [translatedDishes, setTranslatedDishes] = useState<Record<string, string>>({}); // dish.id -> translated desc
  const [translatingCat, setTranslatingCat] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [groupSize, setGroupSize] = useState<number>(2);
  const [alreadyOrdered, setAlreadyOrdered] = useState('');
  const [joinedExisting, setJoinedExisting] = useState(false);
  const [listening, setListening] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMsgRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Carica preferenze salvate al primo render
  useEffect(() => {
    const prefs = loadPrefs(params.restaurant);
    if (prefs?.groupSize) setGroupSize(prefs.groupSize);
  }, []);

  // Salva sessione in localStorage ad ogni cambio messaggi
  useEffect(() => {
    if (!sessionId) return;
    saveSession(params.restaurant, params.table, { sessionId, lang, messages, alreadyOrdered, joinedExisting });
  }, [sessionId, lang, messages]);

  // Salva piatti selezionati in localStorage ad ogni cambio (non al primo render)
  const savedDishesInitRef = useRef(true);
  useEffect(() => {
    if (savedDishesInitRef.current) { savedDishesInitRef.current = false; return; }
    saveDishList(params.restaurant, params.table, savedDishes);
  }, [savedDishes]);

  useEffect(() => {
    if (loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      lastMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messages, loading]);

  // Cleanup SpeechRecognition all'unmount
  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  // Traduce le descrizioni della categoria visibile (on-demand)
  useEffect(() => {
    if (lang === 'es' || screen !== 'main') return;
    const catDishes = dishes.filter(d => d.category === selectedCat);
    const toTranslate = catDishes.filter(d => d.description && !translatedDishes[d.id]);
    if (toTranslate.length === 0) return;

    let cancelled = false;
    setTranslatingCat(selectedCat);
    fetch(`${API}/api/menu/translate-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: toTranslate.map(d => ({ id: d.id, text: d.description })), lang, restaurant_slug: params.restaurant }),
    })
      .then(r => r.json())
      .then((data: { id: string; translated: string }[]) => {
        if (cancelled || !Array.isArray(data)) return;
        setTranslatedDishes(prev => {
          const next = { ...prev };
          for (const item of data) next[item.id] = item.translated;
          return next;
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTranslatingCat(null); });

    return () => { cancelled = true; setTranslatingCat(null); };
  }, [selectedCat, screen, lang]);

  async function startSession(selectedLang: string) {
    setLang(selectedLang);
    setStartError(null);
    setLoading(true);
    savePrefs(params.restaurant, { allergies: '', groupSize });

    // Controlla sessione salvata e storico cliente
    const saved = loadSession(params.restaurant, params.table);
    const history = loadCustomerHistory(params.restaurant);
    const returning = isReturningCustomer(history);

    // Sessione attiva (< 12h) nella stessa lingua → ripristina
    if (saved && saved.lang === selectedLang && !returning) {
      const savedHours = saved.savedAt ? (Date.now() - new Date(saved.savedAt).getTime()) / 3600000 : 99;
      if (savedHours < 12) {
        try {
          const menuRes = await fetch(`${API}/api/menu/${params.restaurant}/dishes/translated?lang=${selectedLang}`);
          if (menuRes.ok) {
            const menuData: Dish[] = await menuRes.json();
            const available = menuData.filter(d => d.available);
            setDishes(available);
            const firstCat = CAT_ORDER.find(c => available.some(d => d.category === c)) ?? 'antipasti';
            setSelectedCat(firstCat);
            setSessionId(saved.sessionId);
            setMessages(saved.messages);
            setAlreadyOrdered(saved.alreadyOrdered ?? '');
            setJoinedExisting(saved.joinedExisting ?? false);
            setScreen('main');
            setLoading(false);
            return;
          }
        } catch { /* fallback a nuova sessione */ }
      }
    }

    // Se c'è una sessione vecchia, salva lo storico prima di ripartire
    if (saved?.messages?.length) {
      saveCustomerHistory(params.restaurant, saved.messages, saved.lang);
      clearSession(params.restaurant, params.table);
    }

    // Ricarica lo storico aggiornato (potrebbe essere appena salvato)
    const freshHistory = loadCustomerHistory(params.restaurant);
    const isReturning = isReturningCustomer(freshHistory);

    try {
      const savedPrefs = loadPrefs(params.restaurant);
      const [menuRes, sessionRes] = await Promise.all([
        fetch(`${API}/api/menu/${params.restaurant}/dishes/translated?lang=${selectedLang}`),
        fetch(`${API}/api/chat/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurant_slug: params.restaurant,
            table_number: params.table,
            language: selectedLang,
            group_size: groupSize,
            saved_preferences: savedPrefs?.allergies || undefined,
            returning_customer: isReturning,
            previous_dishes: isReturning ? (freshHistory?.mentionedDishes ?? []) : [],
          }),
        }),
      ]);
      if (!menuRes.ok) throw new Error(`Menu error ${menuRes.status}`);
      if (!sessionRes.ok) {
        const errBody = await sessionRes.json().catch(() => ({}));
        throw new Error(`Session ${sessionRes.status}: ${errBody.detail || errBody.error || 'unknown'}`);
      }

      const [menuData, sessionData]: [Dish[], { session_id: string; welcome_message: string; suggestions?: string[]; joined_existing?: boolean; already_ordered?: string }] =
        await Promise.all([menuRes.json(), sessionRes.json()]);

      const available = menuData.filter(d => d.available);
      setDishes(available);
      const firstCat = CAT_ORDER.find(c => available.some(d => d.category === c)) ?? available[0]?.category ?? 'antipasti';
      setSelectedCat(firstCat);
      setSessionId(sessionData.session_id);
      setMessages([{ role: 'assistant', content: sessionData.welcome_message, timestamp: new Date().toISOString() }]);

      setSuggestions(sessionData.suggestions ?? []);
      setJoinedExisting(sessionData.joined_existing ?? false);
      setAlreadyOrdered(sessionData.already_ordered ?? '');
      setScreen('main');
    } catch (err) {
      setStartError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || !sessionId || loading) return;
    setInput('');
    setSuggestions([]);
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }]);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/chat/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, language: lang }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, timestamp: new Date().toISOString() }]);
      setSuggestions(data.suggestions ?? []);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Errore di rete. Riprova.', timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  }, [input, sessionId, loading, lang]);

  async function openDish(dish: Dish) {
    setSelectedDish(dish);
    setTranslatedDesc(null);
    if (lang === 'es' || !dish.description) return;
    try {
      const res = await fetch(`${API}/api/menu/translate-desc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: dish.description, lang, restaurant_slug: params.restaurant }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranslatedDesc(data.translated);
      }
    } catch { /* mostra originale */ }
  }

  function toggleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Riconoscimento vocale non supportato in questo browser'); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const recognition = new SR();
    const langMap: Record<string, string> = { it: 'it-IT', en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', pt: 'pt-PT', ru: 'ru-RU', zh: 'zh-CN', ja: 'ja-JP', ar: 'ar-SA' };
    recognition.lang = langMap[lang] ?? 'it-IT';
    recognition.interimResults = false;
    recognition.onresult = (e: any) => {
      const transcript: string = e.results[0][0].transcript;
      setInput(transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }

  function askAboutDish(dish: Dish) {
    setSelectedDish(null);
    setTab('chat');
    const isDrink = ['cocktails', 'spirits', 'birre', 'vini', 'soft_drinks'].includes(dish.category);
    const drinkP: Record<string, string> = { it: `Parlami di "${dish.name}": com'è, come si serve e con quali piatti si abbina.`, en: `Tell me about "${dish.name}": taste, serving and food pairing.`, de: `Erkläre mir "${dish.name}": Geschmack, Servierung und passende Speisen.`, es: `Cuéntame sobre "${dish.name}": sabor, servicio y maridaje.`, fr: `Parle-moi de "${dish.name}": goût, service et accord mets.`, pt: `Fala-me de "${dish.name}": sabor, serviço e harmonização.`, ru: `Расскажи о "${dish.name}": вкус, подача и сочетание с едой.`, zh: `告诉我"${dish.name}"的口感、上菜方式和搭配食物。`, ja: `"${dish.name}"の味、提供方法、相性の良い料理を教えてください。`, ar: `أخبرني عن "${dish.name}": المذاق والتقديم والأطباق المناسبة.` };
    const dishP: Record<string, string> = { it: `Parlami di "${dish.name}": ingredienti, sapore e cosa consigli da bere.`, en: `Tell me about "${dish.name}": ingredients, flavor and drink pairing.`, de: `Erkläre mir "${dish.name}": Zutaten, Geschmack und Getränkeempfehlung.`, es: `Cuéntame sobre "${dish.name}": ingredientes, sabor y bebida recomendada.`, fr: `Parle-moi de "${dish.name}": ingrédients, saveur et boisson conseillée.`, pt: `Fala-me de "${dish.name}": ingredientes, sabor e bebida.`, ru: `Расскажи о "${dish.name}": ингредиенты, вкус и напиток.`, zh: `告诉我"${dish.name}"的食材、口味和推荐饮品。`, ja: `"${dish.name}"の食材、風味、おすすめ飲み物を教えてください。`, ar: `أخبرني عن "${dish.name}": المكونات والمذاق والمشروب الموصى به.` };
    const prompt = isDrink ? (drinkP[lang] ?? drinkP['it']) : (dishP[lang] ?? dishP['it']);
    sendMessage(prompt);
  }

  // ─── Lingua / Loading / Errore ────────────────────────────
  if (screen === 'lang') {
    return (
      <div style={S.langScreen}>
        <img src="/logo.png" alt="Gusto" style={S.coverLogo} />

        {startError && (
          <div style={S.errorBox}>
            ⚠️ Connessione lenta. Riprova.
            <br /><span style={{ fontSize: 11, opacity: 0.6 }}>{startError}</span>
          </div>
        )}

        {loading ? (
          <div style={S.pizzaSpinner}>🍕</div>
        ) : (
          <>
            <div style={S.groupSelector}>
              <span style={S.groupLabel}>👥</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  style={groupSize === n ? S.groupBtnActive : S.groupBtn}
                  onClick={() => setGroupSize(n)}
                >{n === 5 ? '5+' : n}</button>
              ))}
            </div>
            <div style={S.langGrid}>
              {LANG_OPTIONS.map(opt => (
                <button key={opt.code} style={S.langBtn} onClick={() => startSession(opt.code)}>{opt.label}</button>
              ))}
            </div>
          </>
        )}

      </div>
    );
  }

  // ─── Piatti salvati ───────────────────────────────────────
  if (screen === 'saved_dishes') {
    const total = savedDishes.reduce((s, i) => s + parseFloat(String(i.dish.price)) * i.qty, 0);
    return (
      <div style={S.confirmScreen}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button style={S.backBtn} onClick={() => setScreen('main')}>←</button>
          <h2 style={{ ...S.confirmTitle, margin: 0 }}>{t('savedList', lang)}</h2>
        </div>
        <div style={{ background: '#1a1a2e', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#f59e0b' }}>
          {t('savedNote', lang)}
        </div>
        {savedDishes.length === 0 ? (
          <p style={{ color: '#a8a8b3', textAlign: 'center', marginTop: 32 }}>{t('savedEmpty', lang)}</p>
        ) : (
          <div style={S.orderItems}>
            {savedDishes.map((item, i) => (
              <div key={i} style={{ ...S.orderItem, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{item.qty}× {item.dish.name}</span>
                  <span style={{ color: '#e94560', fontWeight: 700 }}>€{(parseFloat(String(item.dish.price)) * item.qty).toFixed(2)}</span>
                </div>
                {(translatedDishes[item.dish.id] ?? item.dish.description) && (
                  <span style={{ fontSize: 12, color: '#a8a8b3' }}>{translatedDishes[item.dish.id] ?? item.dish.description}</span>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button style={S.qtyBtn} onClick={() => setSavedDishes(prev => {
                    const updated = prev.map(x => x.dish.id === item.dish.id ? { ...x, qty: x.qty - 1 } : x);
                    return updated.filter(x => x.qty > 0);
                  })}>−</button>
                  <span style={{ color: '#eaeaea', minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                  <button style={S.qtyBtn} onClick={() => setSavedDishes(prev =>
                    prev.map(x => x.dish.id === item.dish.id ? { ...x, qty: x.qty + 1 } : x)
                  )}>+</button>
                </div>
              </div>
            ))}
            <div style={S.orderTotal}>
              <strong>{t('total', lang)}</strong>
              <strong style={{ color: '#e94560' }}>€{total.toFixed(2)}</strong>
            </div>
          </div>
        )}
        <button style={{ ...S.btnConfirm, marginTop: 16 }} onClick={() => setScreen('main')}>← {t('menu', lang)}</button>
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
        <button style={S.backBtn} onClick={() => setShowLangPicker(true)} title="Cambia lingua">
          {LANG_OPTIONS.find(o => o.code === lang)?.label.split(' ')[0] ?? '🌐'}
        </button>
        <img src="/logo.png" alt="Gusto" style={S.headerLogo} />
        <div style={S.headerSub2}>{params.restaurant.replace(/-/g, ' ')}</div>
        {savedDishes.length > 0 && (
          <button style={S.savedBadgeBtn} onClick={() => setScreen('saved_dishes')}>
            🛒 <span style={S.savedBadgeCount}>{savedDishes.reduce((s, i) => s + i.qty, 0)}</span>
          </button>
        )}
      </header>

      {/* Language picker overlay */}
      {showLangPicker && (
        <div style={S.langPickerOverlay} onClick={() => setShowLangPicker(false)}>
          <div style={S.langPickerBox} onClick={e => e.stopPropagation()}>
            <div style={S.langPickerGrid}>
              {LANG_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  style={lang === opt.code ? S.langPickerBtnActive : S.langPickerBtn}
                  onClick={() => {
                    if (opt.code === lang) { setShowLangPicker(false); return; }
                    // Cancella sessione localStorage: al prossimo refresh parte nella lingua corretta
                    clearSession(params.restaurant, params.table);
                    const SUGG: Record<string, string[]> = { it: ["Cosa mi consiglia?", "Ho un'allergia", 'Menu degustazione'], en: ['What do you recommend?', 'I have an allergy', 'Tasting menu'], de: ['Was empfehlen Sie?', 'Ich habe eine Allergie', 'Degustationsmenü'], es: ['¿Qué recomienda?', 'Tengo una alergia', 'Menú degustación'], fr: ['Que recommandez-vous?', "J'ai une allergie", 'Menu dégustation'], pt: ['O que recomenda?', 'Tenho uma alergia', 'Menu degustação'], ru: ['Что вы рекомендуете?', 'У меня аллергия', 'Дегустационное меню'], zh: ['您推荐什么？', '我有过敏', '品鉴菜单'], ja: ['何がおすすめですか？', 'アレルギーがあります', 'テイスティングメニュー'], ar: ['ماذا توصي؟', 'لدي حساسية', 'قائمة التذوق'] };
                    setSuggestions(SUGG[opt.code] ?? SUGG['it']);
                    setShowLangPicker(false);
                    setLang(opt.code);
                    setTranslatedDishes({});
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Banner sessione condivisa */}
      {joinedExisting && (
        <div style={S.sharedBanner}>
          👥 {t('sharedTable', lang)}
          {alreadyOrdered && (
            <span style={S.sharedOrdered}>
              {' '}· {t('alreadyOrd', lang)}: {alreadyOrdered}
            </span>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div style={S.tabBar}>
        <button style={tab === 'menu' ? S.tabActive : S.tabInactive} onClick={() => setTab('menu')}>
          🍽️ {t('menu', lang)}
        </button>
        <button style={tab === 'chat' ? S.tabActive : S.tabInactive} onClick={() => setTab('chat')}>
          💬 {t('assistant', lang)}
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
                {CAT_ICONS[c]} {catLabel(c, lang)}{translatingCat === c ? ' ↻' : ''}
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
                  <div style={S.dishDesc}>{translatedDishes[dish.id] ?? dish.description}</div>
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
              <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined} style={msg.role === 'user' ? S.bubbleUser : S.bubbleAI}>
                <div style={msg.role === 'user' ? S.bubbleUserInner : S.bubbleAIInner}>
                  {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={S.bubbleAI}>
                <div style={S.bubbleAIInner}>
                  <span style={S.typingDots}>
                    <span style={S.dot1}>●</span>
                    <span style={S.dot2}>●</span>
                    <span style={S.dot3}>●</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {suggestions.length > 0 && !loading && (
            <div style={S.suggestionsRow}>
              {suggestions.map((s, i) => (
                <button key={i} style={S.suggestionChip} onClick={() => { setSuggestions([]); sendMessage(s); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <div style={S.inputArea}>
            <button style={listening ? S.micBtnActive : S.micBtn} onClick={toggleVoice} title="Parla">
              {listening ? '🔴' : '🎤'}
            </button>
            <input
              style={S.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={listening ? t('listening', lang) : t('write', lang)}
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
            {selectedDish.image_url
              ? <img src={selectedDish.image_url} alt={selectedDish.name} style={S.modalImg} />
              : <div style={S.modalIcon}>{CAT_ICONS[selectedDish.category]}</div>
            }
            <h2 style={S.modalTitle}>{selectedDish.name}</h2>
            <div style={S.modalPrice}>€{parseFloat(String(selectedDish.price ?? 0)).toFixed(2)}</div>
            {(translatedDesc ?? translatedDishes[selectedDish.id] ?? selectedDish.description) && (
              <p style={S.modalDesc}>{translatedDesc ?? translatedDishes[selectedDish.id] ?? selectedDish.description}</p>
            )}
            <button style={S.modalAskBtn} onClick={() => askAboutDish(selectedDish)}>
              💬 {t('askMarco', lang)}
            </button>
            <button style={S.modalOrderBtn} onClick={() => {
              setSavedDishes(prev => {
                const existing = prev.find(i => i.dish.id === selectedDish.id);
                if (existing) return prev.map(i => i.dish.id === selectedDish.id ? { ...i, qty: i.qty + 1 } : i);
                return [...prev, { dish: selectedDish, qty: 1 }];
              });
              setSelectedDish(null);
            }}>
              {t('addOrder', lang)}
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

  langScreen: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 40, padding: 32, background: '#000' },
  coverLogo: { width: 220, objectFit: 'contain' as const },
  pizzaSpinner: { fontSize: 64, animation: 'spin 1.2s linear infinite' },
  langGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', maxWidth: 340 },
  langBtn: { padding: '16px 12px', borderRadius: 12, fontSize: 16, fontWeight: 600, background: '#16213e', color: '#eaeaea', border: '1.5px solid #2a2a4a', cursor: 'pointer' },
  tableTag: { color: '#555', fontSize: 13 },

  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#0f0f0f', borderBottom: '1px solid #2a2a4a', flexShrink: 0 },
  backBtn: { background: 'none', color: '#a8a8b3', fontSize: 20, padding: 4, border: 'none', cursor: 'pointer', flexShrink: 0 },
  headerLogo: { height: 36, objectFit: 'contain' as const, flex: 1 },
  headerSub2: { fontSize: 12, color: '#a8a8b3', flexShrink: 0 },
  headerSub: { fontSize: 12, color: '#a8a8b3' },
  orderBadge: { background: '#22c55e22', color: '#22c55e', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, flexShrink: 0 },

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
  typingDots: { display: 'inline-flex', gap: 4, alignItems: 'center' },
  dot1: { color: '#e94560', fontSize: 10, animation: 'bounce 1.2s infinite', animationDelay: '0s' },
  dot2: { color: '#e94560', fontSize: 10, animation: 'bounce 1.2s infinite', animationDelay: '0.2s' },
  dot3: { color: '#e94560', fontSize: 10, animation: 'bounce 1.2s infinite', animationDelay: '0.4s' },
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
  // Shared session banner
  sharedBanner: { background: '#0f3460', borderBottom: '1px solid #2a2a4a', padding: '8px 14px', fontSize: 12, color: '#a8c8ff', flexShrink: 0, display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  sharedOrdered: { color: '#22c55e', fontWeight: 600 },

  // Group size selector
  groupSelector: { display: 'flex', alignItems: 'center', gap: 8 },
  groupLabel: { fontSize: 20 },
  groupBtn: { width: 40, height: 40, borderRadius: '50%', fontSize: 15, fontWeight: 600, background: '#16213e', color: '#a8a8b3', border: '1.5px solid #2a2a4a', cursor: 'pointer' },
  groupBtnActive: { width: 40, height: 40, borderRadius: '50%', fontSize: 15, fontWeight: 700, background: '#e94560', color: '#fff', border: '1.5px solid #e94560', cursor: 'pointer' },

  // Voice input
  micBtn: { background: '#16213e', color: '#a8a8b3', border: '1.5px solid #2a2a4a', borderRadius: '50%', width: 44, height: 44, fontSize: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  micBtnActive: { background: '#e94560', color: '#fff', border: '1.5px solid #e94560', borderRadius: '50%', width: 44, height: 44, fontSize: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', animation: 'spin 1.5s linear infinite' },

  // Suggestions
  suggestionsRow: { display: 'flex', gap: 8, padding: '8px 12px', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' as const, position: 'relative', zIndex: 10 },
  suggestionChip: { flexShrink: 0, padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: '#0f3460', color: '#eaeaea', border: '1.5px solid #e94560', cursor: 'pointer', whiteSpace: 'nowrap' as const },

  // Modal
  modalImg: { width: '100%', height: 180, objectFit: 'cover' as const, borderRadius: 14, marginBottom: 12 },
  modalAskBtn: { display: 'block', width: '100%', padding: '14px', borderRadius: 14, fontSize: 15, fontWeight: 700, background: '#e94560', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 10 },
  modalOrderBtn: { display: 'block', width: '100%', padding: '14px', borderRadius: 14, fontSize: 15, fontWeight: 700, background: '#16213e', color: '#eaeaea', border: '1.5px solid #2a2a4a', cursor: 'pointer', marginBottom: 12 },
  modalClose: { position: 'absolute', top: 16, right: 16, background: '#2a2a4a', color: '#a8a8b3', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 14, cursor: 'pointer' },

  // Lang picker
  langPickerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 200 },
  langPickerBox: { background: '#16213e', borderRadius: '20px 20px 0 0', padding: '20px 16px 32px', width: '100%', border: '1px solid #2a2a4a' },
  langPickerGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  langPickerBtn: { padding: '12px 10px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: '#0f0f1a', color: '#a8a8b3', border: '1.5px solid #2a2a4a', cursor: 'pointer' },
  langPickerBtnActive: { padding: '12px 10px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: '#e94560', color: '#fff', border: '1.5px solid #e94560', cursor: 'pointer' },

  // Confirm
  confirmScreen: { padding: 24, display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100dvh', background: '#0f0f1a' },
  confirmTitle: { fontSize: 22, fontWeight: 700, color: '#eaeaea' },
  orderItems: { background: '#16213e', borderRadius: 12, overflow: 'hidden', border: '1px solid #2a2a4a' },
  orderItem: { display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2a2a4a', color: '#eaeaea', fontSize: 15 },
  orderTotal: { display: 'flex', justifyContent: 'space-between', padding: '14px 16px', color: '#e94560', fontSize: 17 },
  confirmBtns: { display: 'flex', gap: 12 },
  btnCancel: { flex: 1, padding: '14px', borderRadius: 12, fontSize: 16, background: '#1a1a2e', color: '#a8a8b3', border: '1.5px solid #2a2a4a', cursor: 'pointer' },
  btnConfirm: { flex: 2, padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 700, background: '#e94560', color: 'white', border: 'none', cursor: 'pointer' },
  savedBadgeBtn: { background: '#e94560', border: 'none', borderRadius: 20, padding: '6px 12px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  savedBadgeCount: { background: '#fff', color: '#e94560', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 },
  qtyBtn: { background: '#2a2a4a', color: '#eaeaea', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
