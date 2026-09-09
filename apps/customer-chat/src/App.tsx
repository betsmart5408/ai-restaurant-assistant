import { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null; dove: string | null }> {
  state = { error: null, dove: null };
  static getDerivedStateFromError(e: Error) {
    // la prima riga utile dello stack: serve a capire dove si e' rotto
    const riga = (e.stack || '').split('\n').slice(1, 3).join(' ').trim().slice(0, 180);
    return { error: e.message, dove: riga || null };
  }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, color: 'var(--brand)', background: 'var(--bg)', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>Errore inatteso</div>
        <div style={{ fontSize: 13, color: 'var(--text-soft)', textAlign: 'center' }}>{this.state.error}</div>
        {this.state.dove && (
          <div style={{ fontSize: 10, color: '#6b6b78', textAlign: 'center', maxWidth: 340, wordBreak: 'break-all' }}>{this.state.dove}</div>
        )}
        <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, cursor: 'pointer' }}>Ricarica</button>
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
interface Dish { id: string; name: string; description: string; price: number; category: string; category_label?: string; available: boolean; image_url?: string; }

// Converte **bold**, *italic*, _italic_ e \n in React nodes
function renderMarkdown(
  text: string,
  dishes?: { id: string; name: string; description: string; price: number; category: string; available: boolean; image_url?: string }[],
  onDishClick?: (dish: { id: string; name: string; description: string; price: number; category: string; available: boolean; image_url?: string }) => void
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  if (typeof text !== 'string' || !text) return result;   // messaggio vuoto: niente da disegnare
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\n)/g;
  let last = 0, i = 0, match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) result.push(text.slice(last, match.index));
    const m = match[0];
    if (m === '\n') result.push(<br key={i} />);
    else if (m.startsWith('**')) {
      const name = m.slice(2, -2);
      const matched = dishes?.find(d => d.name.toLowerCase() === name.toLowerCase());
      if (matched && onDishClick) {
        result.push(
          <button key={i} onClick={() => onDishClick(matched)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--brand)', fontWeight: 700, fontSize: 'inherit', textDecoration: 'underline', fontStyle: 'normal', display: 'inline' }}>
            {name}
          </button>
        );
      } else {
        result.push(<strong key={i}>{name}</strong>);
      }
    } else result.push(<em key={i}>{m.slice(1, -1)}</em>);
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


/**
 * Una visita e' un pasto, non una giornata.
 * Chat e promemoria si ritrovano solo se si sta ancora mangiando: stesso giorno,
 * stesso servizio (pranzo o cena) e non piu' di 3 ore dall'ultima attivita'.
 * Chi torna la sera dopo aver pranzato deve trovare tutto pulito.
 */
function stessaVisita(salvatoAt?: string | null): boolean {
  if (!salvatoAt) return false;
  const prima = new Date(salvatoAt);
  if (isNaN(prima.getTime())) return false;
  const ora = new Date();

  const ore = (ora.getTime() - prima.getTime()) / 3600000;
  if (ore > 3 || ore < 0) return false;
  if (prima.toDateString() !== ora.toDateString()) return false;

  const servizio = (d: Date) => (d.getHours() < 16 ? 'pranzo' : 'cena');
  return servizio(prima) === servizio(ora);
}

interface SavedDishesStore { items: SavedDishItem[]; savedAt: string; }
function saveDishList(restaurant: string, table: number, items: SavedDishItem[]) {
  try { localStorage.setItem(SAVED_DISHES_KEY(restaurant, table), JSON.stringify({ items, savedAt: new Date().toISOString() })); } catch {}
}
function loadDishList(restaurant: string, table: number): SavedDishItem[] {
  try {
    const raw: SavedDishesStore = JSON.parse(localStorage.getItem(SAVED_DISHES_KEY(restaurant, table)) ?? 'null');
    if (!raw) return [];
    if (!stessaVisita(raw.savedAt)) { localStorage.removeItem(SAVED_DISHES_KEY(restaurant, table)); return []; }
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

type Screen = 'lang' | 'home' | 'main' | 'saved_dishes';
type Tab = 'menu' | 'chat';
interface SavedDishItem { dish: Dish; qty: number; }

// Tutte le lingue che l'app sa mostrare. Quali compaiono davvero lo decide
// il ristorante (campo languages): un locale di Sydney offre coreano e
// indonesiano, uno di Malaga arabo e russo. La lista fissa mostrava a tutti
// le lingue di Malaga, comprese quelle senza traduzioni.
// Le lingue che l'app sa mostrare. Sono queste 13: le 10 di Sydney piu'
// portoghese, russo e arabo che servono a Malaga. Ogni ristorante ne mostra
// solo le proprie (campo languages): a Sydney se ne vedono 10, non 13.
// Per una citta' nuova con lingue diverse, si aggiunge una riga qui.
const LANG_OPTIONS = [
  { code: 'en', label: '🇬🇧 English' },
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'pt', label: '🇵🇹 Português' },
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'ar', label: '🇸🇦 العربية' },
  { code: 'zh', label: '🇨🇳 中文' },
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'ko', label: '🇰🇷 한국어' },
  { code: 'id', label: '🇮🇩 Bahasa Indonesia' },
  { code: 'hi', label: '🇮🇳 हिन्दी' },
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
  askMarco:    { it: 'Chiedi a {n}', en: 'Ask {n}', de: '{n} fragen', es: 'Preguntar a {n}', fr: 'Demander à {n}', pt: 'Perguntar ao {n}', ru: 'Спросить {n}', zh: '询问{n}', ja: '{n}に聞く', ar: 'اسأل {n}' },
  addOrder:    { it: '📋 Aggiungi al promemoria', en: '📋 Add to my list', de: '📋 Zur Liste', es: '📋 Añadir a mi lista', fr: '📋 Ajouter à ma liste', pt: '📋 Adicionar à lista', ru: '📋 В список', zh: '📋 加入清单', ja: '📋 リストに追加', ar: '📋 أضف إلى قائمتي' },
  savedList:   { it: '📋 Da mostrare al cameriere', en: '📋 Show this to the waiter', de: '🍽️ Gemerkte Gerichte', es: '🍽️ Tus platos guardados', fr: '🍽️ Vos plats sauvegardés', pt: '🍽️ Os seus pratos guardados', ru: '🍽️ Сохранённые блюда', zh: '🍽️ 已保存的菜肴', ja: '🍽️ 保存した料理', ar: '🍽️ أطباقك المحفوظة' },
  clearList:   { it: 'Svuota il promemoria', en: 'Clear the list', de: 'Liste leeren', es: 'Vaciar la lista', fr: 'Vider la liste', pt: 'Limpar a lista', ru: 'Очистить список', zh: '清空清单', ja: 'リストを空にする', ar: 'إفراغ القائمة' },
  savedEmpty:  { it: 'Nessun piatto salvato', en: 'No saved dishes', de: 'Keine Gerichte gemerkt', es: 'Ningún plato guardado', fr: 'Aucun plat sauvegardé', pt: 'Nenhum prato guardado', ru: 'Нет сохранённых блюд', zh: '没有保存的菜肴', ja: '保存した料理はありません', ar: 'لا توجد أطباق محفوظة' },
  savedNote:   { it: '⚠️ Il personale prenderà il tuo ordine al tavolo', en: '⚠️ Staff will take your order at the table', de: '⚠️ Das Personal nimmt Ihre Bestellung am Tisch auf', es: '⚠️ El personal tomará su pedido en la mesa', fr: '⚠️ Le personnel prendra votre commande à table', pt: '⚠️ O pessoal tomará o seu pedido na mesa', ru: '⚠️ Персонал примет ваш заказ за столом', zh: '⚠️ 服务员将在桌边为您点餐', ja: '⚠️ スタッフがテーブルでご注文を承ります', ar: '⚠️ سيأخذ الموظفون طلبك على الطاولة' },
  total:       { it: 'Totale stimato', en: 'Estimated total', de: 'Geschätztes Gesamt', es: 'Total estimado', fr: 'Total estimé', pt: 'Total estimado', ru: 'Примерная сумма', zh: '预计总计', ja: '合計（目安）', ar: 'المجموع التقديري' },
  sharedTable: { it: 'Sessione tavolo condivisa', en: 'Shared table', de: 'Gemeinsamer Tisch', es: 'Mesa compartida', fr: 'Table partagée', pt: 'Mesa compartilhada', ru: 'Общий стол', zh: '共享桌台', ja: 'テーブル共有', ar: 'طاولة مشتركة' },
  alreadyOrd:  { it: 'Già ordinato', en: 'Already ordered', de: 'Bereits bestellt', es: 'Ya pedido', fr: 'Déjà commandé', pt: 'Já pedido', ru: 'Уже заказано', zh: '已点', ja: '注文済み', ar: 'تم الطلب' },
  myDishes:    { it: 'Promemoria', en: 'My list', de: 'Meine Liste', es: 'Mi lista', fr: 'Ma liste', pt: 'A minha lista', ru: 'Мой список', zh: '我的清单', ja: '私のリスト', ar: 'قائمتي' },
  remove:      { it: 'Rimuovi', en: 'Remove', de: 'Entfernen', es: 'Eliminar', fr: 'Supprimer', pt: 'Remover', ru: 'Удалить', zh: '删除', ja: '削除', ar: 'إزالة' },
  savedDish:   { it: '✓ Salvato', en: '✓ Saved', de: '✓ Gespeichert', es: '✓ Guardado', fr: '✓ Sauvegardé', pt: '✓ Guardado', ru: '✓ Сохранено', zh: '✓ 已保存', ja: '✓ 保存済み', ar: '✓ محفوظ' },
  homeMenu:    { it: '🍽️ Menu', en: '🍽️ Menu', de: '🍽️ Speisekarte', es: '🍽️ Carta', fr: '🍽️ Menu', pt: '🍽️ Menu', ru: '🍽️ Меню', zh: '🍽️ 菜单', ja: '🍽️ メニュー', ar: '🍽️ قائمة' },
  homeAllergy: { it: '⚠️ Allergie o Intolleranze', en: '⚠️ Allergies & Intolerances', de: '⚠️ Allergien & Unverträglichkeiten', es: '⚠️ Alergias e Intolerancias', fr: '⚠️ Allergies & Intolérances', pt: '⚠️ Alergias & Intolerâncias', ru: '⚠️ Аллергии и непереносимость', zh: '⚠️ 过敏与不耐受', ja: '⚠️ アレルギーと不耐性', ar: '⚠️ الحساسية وعدم التحمل' },
  homeAI:      { it: '💬 Assistente AI', en: '💬 AI Assistant', de: '💬 KI-Assistent', es: '💬 Asistente IA', fr: '💬 Assistant IA', pt: '💬 Assistente IA', ru: '💬 ИИ-Ассистент', zh: '💬 AI助手', ja: '💬 AIアシスタント', ar: '💬 المساعد الذكي' },
  allergyMsg:  { it: 'Ho un\'allergia o intolleranza alimentare, puoi aiutarmi?', en: 'I have a food allergy or intolerance, can you help me?', de: 'Ich habe eine Lebensmittelallergie, können Sie mir helfen?', es: 'Tengo una alergia alimentaria, ¿puedes ayudarme?', fr: 'J\'ai une allergie alimentaire, pouvez-vous m\'aider?', pt: 'Tenho uma alergia alimentar, pode ajudar-me?', ru: 'У меня пищевая аллергия, можете помочь?', zh: '我有食物过敏，能帮助我吗？', ja: '食物アレルギーがあります、助けてもらえますか？', ar: 'لدي حساسية غذائية، هل يمكنك مساعدتي؟' },
  igTitle:     { it: 'Ti è piaciuto? Seguici su Instagram per foto e novità 📸', en: 'Enjoying it? Follow us on Instagram for photos & news 📸', de: 'Gefällt es dir? Folge uns auf Instagram für Fotos & News 📸', es: '¿Te gusta? Síguenos en Instagram para fotos y novedades 📸', fr: 'Ça vous plaît ? Suivez-nous sur Instagram pour photos et actus 📸', pt: 'Está a gostar? Siga-nos no Instagram para fotos e novidades 📸', ru: 'Нравится? Подпишитесь на нас в Instagram — фото и новости 📸', zh: '喜欢吗？在 Instagram 关注我们，看照片和最新消息 📸', ja: '気に入りましたか？写真や最新情報はInstagramで 📸', ar: 'أعجبك المكان؟ تابعنا على إنستغرام للصور والأخبار 📸', ko: '마음에 드셨나요? 인스타그램에서 사진과 소식을 확인하세요 📸', id: 'Suka? Ikuti kami di Instagram untuk foto & kabar terbaru 📸', hi: 'पसंद आया? फ़ोटो और अपडेट के लिए हमें Instagram पर फ़ॉलो करें 📸' },
  igBtn:       { it: 'Segui su Instagram', en: 'Follow on Instagram', de: 'Auf Instagram folgen', es: 'Seguir en Instagram', fr: 'Suivre sur Instagram', pt: 'Seguir no Instagram', ru: 'Подписаться в Instagram', zh: '在 Instagram 关注', ja: 'Instagramでフォロー', ar: 'تابع على إنستغرام', ko: '인스타그램 팔로우', id: 'Ikuti di Instagram', hi: 'Instagram पर फ़ॉलो करें' },
  igLater:     { it: 'Più tardi', en: 'Maybe later', de: 'Später', es: 'Más tarde', fr: 'Plus tard', pt: 'Mais tarde', ru: 'Позже', zh: '以后再说', ja: '後で', ar: 'لاحقاً', ko: '나중에', id: 'Nanti saja', hi: 'बाद में' },
};
// Ripiego in inglese, non in italiano: un turista coreano che trova una
// parola non tradotta capisce l'inglese, l'italiano quasi mai.
function t(key: string, lang: string) { return UI[key]?.[lang] ?? UI[key]?.['en'] ?? UI[key]?.['it'] ?? key; }

// Il glifo fotocamera di Instagram, in monocromatico (colore ereditato).
function IgGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Apre il profilo Instagram: prima prova l'app installata (deep link),
// se non c'e' ripiega sul sito. Su desktop va dritto al sito.
function apriInstagram(url: string) {
  const handle = url.split('/').filter(Boolean).pop() || '';
  const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent || '');
  if (!mobile || !handle) { window.open(url, '_blank', 'noopener'); return; }
  const iniziato = Date.now();
  const web = setTimeout(() => {
    // se l'app si e' aperta la pagina va in background e questo timer slitta:
    // in quel caso non apriamo il sito.
    if (Date.now() - iniziato < 1500) window.open(url, '_blank', 'noopener');
  }, 900);
  const onHide = () => { clearTimeout(web); document.removeEventListener('visibilitychange', onHide); };
  document.addEventListener('visibilitychange', onHide);
  window.location.href = `instagram://user?username=${handle}`;
}

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
function catLabel(cat: string, lang: string) { return CAT_LABELS[cat]?.[lang] ?? CAT_LABELS[cat]?.['en'] ?? abbelliscoCategoria(cat); }
// Le categorie scritte a mano dal ristorante ("Charcoal Grill") non stanno in
// CAT_LABELS: la loro traduzione arriva dal database insieme ai piatti.
function etichetteDaiPiatti(piatti: { category: string; category_label?: string }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const p of piatti) {
    const c = (p.category ?? '').trim();
    if (c && p.category_label && p.category_label !== c) m[c] = p.category_label;
  }
  return m;
}
const CAT_ICONS: Record<string, string> = {
  antipasti: '🥗', pizze: '🍕', primi: '🍝', secondi: '🥩',
  dolci: '🍮', cocktails: '🍹', spirits: '🥃', birre: '🍺', vini: '🍷', soft_drinks: '🥤',
};
const CAT_ORDER = ['antipasti','pizze','primi','secondi','dolci','cocktails','spirits','birre','vini','soft_drinks'];

// I ristoranti veri non usano le categorie di Gusto ("antipasti", "vini"):
// scrivono "STARTERS", "Charcoal Grill", "To Share". Prima il menu filtrava
// sulla lista fissa qui sopra, percio' per quei locali non compariva nessuna
// categoria e - di conseguenza - NESSUN PIATTO. Ora le categorie si leggono
// dai piatti: quelle conosciute restano nel loro ordine, le altre seguono
// nell'ordine in cui arrivano dal database.
function categorieDeiPiatti(piatti: { category: string }[]): string[] {
  const presenti: string[] = [];
  for (const p of piatti) {
    const c = (p.category ?? '').trim();
    if (c && !presenti.includes(c)) presenti.push(c);
  }
  const conosciute = CAT_ORDER.filter(c => presenti.includes(c));
  const altre = presenti.filter(c => !CAT_ORDER.includes(c));
  return [...conosciute, ...altre];
}

// "MAIN COURSES" -> "Main Courses", "wood_fired" -> "Wood Fired".
// Se il ristorante ha gia' scritto bene ("To Share") non tocchiamo niente.
function abbelliscoCategoria(cat: string): string {
  const pulita = String(cat ?? '').replace(/[_-]+/g, ' ').trim();
  if (!pulita) return '';
  const tuttoMaiuscolo = pulita === pulita.toUpperCase();
  const tuttoMinuscolo = pulita === pulita.toLowerCase();
  if (!tuttoMaiuscolo && !tuttoMinuscolo) return pulita;
  return pulita.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Icona: prima le categorie di Gusto, poi le parole che ricorrono nei menu
// veri, infine un piatto generico. Meglio un'icona neutra che il vuoto.
const ICONE_PAROLA: [RegExp, string][] = [
  [/pizza/i, '\u{1F355}'], [/pasta|risotto|noodle/i, '\u{1F35D}'],
  [/dessert|sweet|dolc|cake|gelat/i, '\u{1F36E}'], [/cocktail/i, '\u{1F379}'],
  [/wine|vino|vini/i, '\u{1F377}'], [/beer|birr/i, '\u{1F37A}'],
  [/spirit|whisk|liqueur|\bgin\b|vodka/i, '\u{1F943}'], [/coffee|tea\b|caff/i, '\u2615'],
  [/soft|juice|drink|beverage|bevand/i, '\u{1F964}'], [/salad|veget|vegan/i, '\u{1F957}'],
  [/soup|zupp|broth/i, '\u{1F372}'], [/burger/i, '\u{1F354}'], [/rice|biryani/i, '\u{1F35A}'],
  [/fish|seafood|prawn|oyster|pesce/i, '\u{1F41F}'],
  [/grill|bbq|charcoal|steak|meat|lamb|beef|chicken|kebab/i, '\u{1F969}'],
  [/bread|dip|mezze|share|starter|antipast|appetiz|entr|snack/i, '\u{1F959}'],
  [/kids|child|bambin/i, '\u{1F9D2}'], [/side/i, '\u{1F35F}'],
  [/breakfast|brunch|egg/i, '\u{1F373}'],
];
function iconaCategoria(cat: string): string {
  if (CAT_ICONS[cat]) return CAT_ICONS[cat];
  for (const [re, icona] of ICONE_PAROLA) if (re.test(cat)) return icona;
  return '\u{1F37D}\uFE0F';
}

// Il prezzo era scritto a mano con il simbolo dell'euro: a Sydney i piatti
// costano in dollari australiani e un menu in euro toglie ogni credibilita'.
const SIMBOLI_VALUTA: Record<string, string> = {
  EUR: '\u20AC', AUD: 'A$', USD: '$', GBP: '\u00A3', CAD: 'C$', NZD: 'NZ$',
  CHF: 'CHF ', JPY: '\u00A5', CNY: '\u00A5', AED: 'AED ', THB: '\u0E3F',
};
function simboloValuta(codice: string): string {
  if (!codice) return '\u20AC';
  const c = String(codice).toUpperCase();
  return SIMBOLI_VALUTA[c] ?? (c.length <= 2 ? codice : c + ' ');
}


/**
 * Dal colore di sfondo scelto dal titolare ricava tutti gli altri colori.
 * Sfondo scuro -> testi chiari; sfondo chiaro -> testi scuri. Cosi' il titolare
 * sceglie una cosa sola e il menu resta sempre leggibile.
 */
const CARATTERI: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  Inter: "'Inter', system-ui, sans-serif",
  Poppins: "'Poppins', system-ui, sans-serif",
  Montserrat: "'Montserrat', system-ui, sans-serif",
  Lora: "'Lora', Georgia, serif",
  'Playfair Display': "'Playfair Display', Georgia, serif",
  Caveat: "'Caveat', 'Segoe Script', cursive",
};

/** Carica il carattere da Google Fonts solo se serve davvero. */
function applicaCarattere(nome?: string | null) {
  const scelto = nome && CARATTERI[nome] ? nome : 'system';
  document.documentElement.style.setProperty('--font', CARATTERI[scelto]);
  if (scelto === 'system') return;
  const id = 'font-ristorante';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(scelto).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function applicaTema(sfondo?: string | null, principale?: string | null) {
  const root = document.documentElement.style;
  if (principale) root.setProperty('--brand', principale);
  if (!sfondo || !/^#[0-9a-fA-F]{6}$/.test(sfondo)) return;

  const r = parseInt(sfondo.slice(1, 3), 16);
  const g = parseInt(sfondo.slice(3, 5), 16);
  const b = parseInt(sfondo.slice(5, 7), 16);
  // luminosita' percepita: il verde pesa piu' del blu
  const luce = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const chiaro = luce > 0.5;

  const misto = (percentuale: number) => {
    const verso = chiaro ? 0 : 255;                        // scurisce o schiarisce
    const m = (c: number) => Math.round(c + (verso - c) * percentuale);
    return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
  };

  root.setProperty('--bg', sfondo);
  root.setProperty('--surface', misto(0.07));              // schede e barre
  root.setProperty('--surface-2', misto(0.12));            // fumetti, secondari
  root.setProperty('--accent', misto(0.18));
  root.setProperty('--border', misto(0.22));
  root.setProperty('--text', chiaro ? '#1b1b22' : '#f2f2f5');
  root.setProperty('--text-soft', chiaro ? '#5c5c68' : '#a8a8b3');

  // Alone del logo e fondi trasparenti: derivati dal colore del locale.
  // Su sfondo chiaro un alone colorato sembra una macchia, quindi diventa
  // un'ombra neutra appena accennata.
  const p = (principale && /^#[0-9a-fA-F]{6}$/.test(principale)) ? principale : 'var(--brand)';
  const pr = parseInt(p.slice(1, 3), 16), pg = parseInt(p.slice(3, 5), 16), pb = parseInt(p.slice(5, 7), 16);
  root.setProperty('--brand-soft', `rgba(${pr}, ${pg}, ${pb}, 0.15)`);
  root.setProperty('--logo-glow', chiaro
    ? 'drop-shadow(0 6px 18px rgba(0,0,0,0.12))'
    : `drop-shadow(0 0 40px rgba(${pr}, ${pg}, ${pb}, 0.30))`);

  document.body.style.background = sfondo;
}

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
  // vuota finche' il menu non arriva: la prima categoria la decidono i piatti
  const [selectedCat, setSelectedCat] = useState<string>('');
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
  const [translatedDishes, setTranslatedDishes] = useState<Record<string, string>>({}); // dish.id -> translated desc
  const [translatingCat, setTranslatingCat] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lastDiscussedDish, setLastDiscussedDish] = useState<Dish | null>(null);
  const [groupSize, setGroupSize] = useState<number>(2);
  const [alreadyOrdered, setAlreadyOrdered] = useState('');
  const [joinedExisting, setJoinedExisting] = useState(false);
  const [listening, setListening] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMsgRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Logo del ristorante: se il titolare ne ha caricato uno si usa quello,
  // altrimenti resta quello predefinito nella cartella del progetto.
  // Se il locale non ha caricato un logo NON mostriamo quello predefinito:
  // e' il marchio di un altro ristorante, e in una demo fa pessima figura.
  // Al suo posto scriviamo il nome del locale.
  const [logoSrc, setLogoSrc] = useState<string>('');
  const [nomeLocale, setNomeLocale] = useState<string>('');
  const [aiName, setAiName] = useState<string>('Marco');
  const [valuta, setValuta] = useState<string>('\u20AC');
  const [instagramUrl, setInstagramUrl] = useState<string>('');
  const [showIg, setShowIg] = useState(false);

  // Lingue offerte da QUESTO ristorante. Finche' non arrivano dal server
  // non mostriamo niente, cosi' nessuno sceglie una lingua non tradotta.
  const [lingueLocale, setLingueLocale] = useState<string[] | null>(null);
  const lingueDaMostrare = lingueLocale
    ? LANG_OPTIONS.filter(o => lingueLocale.includes(o.code))
    : [];

  // Carica preferenze salvate al primo render
  useEffect(() => {
    const prefs = loadPrefs(params.restaurant);
    if (prefs?.groupSize) setGroupSize(prefs.groupSize);
  }, []);

  // Dati del ristorante (logo, colore) al primo render
  useEffect(() => {
    let annullato = false;
    fetch(`${API}/api/menu/${params.restaurant}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (annullato || !data?.restaurant) return;
        const r = data.restaurant;
        if (r.logo_url) setLogoSrc(r.logo_url.startsWith('http') ? r.logo_url : `${API}${r.logo_url}`);
        if (r.instagram_url) setInstagramUrl(r.instagram_url);
        if (r.name) setNomeLocale(r.name);
        // Se il ristorante non dichiara le lingue restiamo sull'inglese:
        // meglio una scelta sola che funziona di dieci che non traducono.
        const l = Array.isArray(r.languages) && r.languages.length ? r.languages : ['en'];
        setLingueLocale(l);
        applicaTema(r.background_color, r.primary_color);
        applicaCarattere(r.font_family);
        if (r.ai_name) setAiName(r.ai_name);
        if (r.currency) setValuta(simboloValuta(String(r.currency)));
      })
      .catch(() => { setLingueLocale(['en']); });
    return () => { annullato = true; };
  }, []);

  // Invito a seguire il ristorante su Instagram.
  // - compare dopo 1 minuto e mezzo
  // - "Piu' tardi" (o tocco fuori) lo richiude e lo rimostra dopo altri 90s
  // - "Segui" apre Instagram e non lo fa piu' vedere per questa visita
  // - niente memoria fra visite: ogni scansione del QR ricomincia da capo
  const IG_ATTESA_MS = 90 * 1000;
  const igTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const igStopRef = useRef(false);
  const igContatoRef = useRef(false);

  const pianificaIg = () => {
    if (igStopRef.current || !instagramUrl) return;
    clearTimeout(igTimerRef.current);
    igTimerRef.current = setTimeout(() => setShowIg(true), IG_ATTESA_MS);
  };

  useEffect(() => {
    pianificaIg();
    return () => clearTimeout(igTimerRef.current);
  }, [instagramUrl]);

  const registraIgEvento = (event: 'shown' | 'click') => {
    fetch(`${API}/api/menu/${params.restaurant}/ig-event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }), keepalive: true,
    }).catch(() => {});
  };

  // Conta "mostrato" una volta sola per visita, alla prima apparizione.
  useEffect(() => {
    if (showIg && !igContatoRef.current) {
      igContatoRef.current = true;
      registraIgEvento('shown');
    }
  }, [showIg]);

  const igPiuTardi = () => { setShowIg(false); pianificaIg(); };
  const igSegui = () => {
    igStopRef.current = true;
    clearTimeout(igTimerRef.current);
    setShowIg(false);
    registraIgEvento('click');
    apriInstagram(instagramUrl);
  };

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

  // Le traduzioni ora arrivano gia' pronte dal database (tabella dish_translations),
  // quindi non si chiede piu' niente all'IA mentre il cliente naviga: menu istantaneo
  // e costo zero. Il blocco sotto resta solo come rete di sicurezza ed e' disattivato.
  useEffect(() => {
    return;
    // eslint-disable-next-line no-unreachable
    if (lang === 'it' || screen !== 'main') return;
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

    // Si riprende la conversazione solo se e' ancora lo stesso pasto
    if (saved && saved.lang === selectedLang && !returning) {
      if (stessaVisita(saved.savedAt)) {
        try {
          const menuRes = await fetch(`${API}/api/menu/${params.restaurant}/dishes/translated?lang=${selectedLang}`);
          if (menuRes.ok) {
            const menuData: Dish[] = await menuRes.json();
            const available = (Array.isArray(menuData) ? menuData : []).filter(d => d.available);
            setDishes(available);
            const firstCat = categorieDeiPiatti(available)[0] ?? '';
            setSelectedCat(firstCat);
            setSessionId(saved.sessionId);
            // Rimuove eventuale testo "già ordinato" dai messaggi salvati
            const cleanedMessages = saved.messages.map(m =>
              m.role === 'assistant'
                ? { ...m, content: m.content.replace(/\n\n_[^_]*già[^_]*_$/i, '').replace(/\n\n_[^_]*already[^_]*_$/i, '').replace(/\n\n_[^_]*bereits[^_]*_$/i, '').trim() }
                : m
            );
            setMessages(cleanedMessages);
            setAlreadyOrdered('');
            setJoinedExisting(false);
            setScreen('home');
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

      const available = (Array.isArray(menuData) ? menuData : []).filter(d => d.available);
      setDishes(available);
      const firstCat = categorieDeiPiatti(available)[0] ?? '';
      setSelectedCat(firstCat);
      setSessionId(sessionData.session_id);
      setMessages([{ role: 'assistant', content: sessionData.welcome_message ?? '', timestamp: new Date().toISOString() }]);

      setSuggestions(sessionData.suggestions ?? []);
      setJoinedExisting(sessionData.joined_existing ?? false);
      setAlreadyOrdered(sessionData.already_ordered ?? '');
      setScreen('home');
    } catch (err) {
      setStartError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const sendMessage = useCallback(async (text?: string, keepDish?: boolean) => {
    const msg = text ?? input.trim();
    if (!msg || !sessionId || loading) return;
    setInput('');
    setSuggestions([]);
    if (!keepDish) setLastDiscussedDish(null);
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }]);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/chat/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, language: lang }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message ?? '', timestamp: new Date().toISOString() }]);
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Errore di rete. Riprova.', timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  }, [input, sessionId, loading, lang]);

  async function openDish(dish: Dish) {
    setSelectedDish(dish);
    setTranslatedDesc(null);
    // La descrizione arriva gia' tradotta dal database: nessuna chiamata all'IA.
    return;
    // eslint-disable-next-line no-unreachable
    if (lang === 'it' || !dish.description) return;
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
    setLastDiscussedDish(dish);
    const isDrink = ['cocktails', 'spirits', 'birre', 'vini', 'soft_drinks'].includes(dish.category)
      || /drink|beverage|cocktail|wine|beer|spirit|liqueur|juice|coffee|tea\b|bevand/i.test(dish.category ?? '');
    const drinkP: Record<string, string> = { it: `Parlami di "${dish.name}": com'è, come si serve e con quali piatti si abbina.`, en: `Tell me about "${dish.name}": taste, serving and food pairing.`, de: `Erkläre mir "${dish.name}": Geschmack, Servierung und passende Speisen.`, es: `Cuéntame sobre "${dish.name}": sabor, servicio y maridaje.`, fr: `Parle-moi de "${dish.name}": goût, service et accord mets.`, pt: `Fala-me de "${dish.name}": sabor, serviço e harmonização.`, ru: `Расскажи о "${dish.name}": вкус, подача и сочетание с едой.`, zh: `告诉我"${dish.name}"的口感、上菜方式和搭配食物。`, ja: `"${dish.name}"の味、提供方法、相性の良い料理を教えてください。`, ar: `أخبرني عن "${dish.name}": المذاق والتقديم والأطباق المناسبة.` };
    const dishP: Record<string, string> = { it: `Parlami di "${dish.name}": ingredienti, sapore e cosa consigli da bere.`, en: `Tell me about "${dish.name}": ingredients, flavor and drink pairing.`, de: `Erkläre mir "${dish.name}": Zutaten, Geschmack und Getränkeempfehlung.`, es: `Cuéntame sobre "${dish.name}": ingredientes, sabor y bebida recomendada.`, fr: `Parle-moi de "${dish.name}": ingrédients, saveur et boisson conseillée.`, pt: `Fala-me de "${dish.name}": ingredientes, sabor e bebida.`, ru: `Расскажи о "${dish.name}": ингредиенты, вкус и напиток.`, zh: `告诉我"${dish.name}"的食材、口味和推荐饮品。`, ja: `"${dish.name}"の食材、風味、おすすめ飲み物を教えてください。`, ar: `أخبرني عن "${dish.name}": المكونات والمذاق والمشروب الموصى به.` };
    const prompt = isDrink ? (drinkP[lang] ?? drinkP['it']) : (dishP[lang] ?? dishP['it']);
    sendMessage(prompt, true);
  }

  // ─── Lingua / Loading / Errore ────────────────────────────
  if (screen === 'lang') {
    return (
      <div style={S.langScreen}>
        {logoSrc
          ? <img src={logoSrc} alt="" style={S.coverLogo} onError={() => setLogoSrc('')} />
          : <div style={S.nomeCopertina}>{nomeLocale}</div>}

        {startError && (
          <div style={S.errorBox}>
            ⚠️ Connessione lenta. Riprova.
            <br /><span style={{ fontSize: 11, opacity: 0.6 }}>{startError}</span>
          </div>
        )}

        {loading ? (
          <div style={S.loadingChef}>👨‍🍳</div>
        ) : (
          <>
            {/* Selettore numero di persone rimosso: si va diretti alla scelta della lingua.
                groupSize resta nel codice con il valore predefinito, cosi' l'API non cambia. */}
            <div style={S.langGrid}>
              {lingueDaMostrare.map(opt => (
                <button key={opt.code} style={S.langBtn} onClick={() => startSession(opt.code)}>{opt.label}</button>
              ))}
            </div>
          </>
        )}

      </div>
    );
  }

  // ─── Home / Benvenuto ─────────────────────────────────────
  if (screen === 'home') {
    return (
      <div style={S.homeScreen}>
        {/* Logo grande centrato come sfondo visivo */}
        <div style={S.homeLogoWrap}>
          {logoSrc
            ? <img src={logoSrc} alt="" style={S.homeLogo} onError={() => setLogoSrc('')} />
            : <div style={S.nomeHome}>{nomeLocale}</div>}
        </div>
        {/* Tasti principali */}
        <div style={S.homeButtons}>
          <button style={S.homeBtn} onClick={() => { setScreen('main'); setTab('menu'); }}>
            {t('homeMenu', lang)}
          </button>
          <button style={S.homeBtn} onClick={() => {
            setScreen('main');
            setTab('chat');
            setTimeout(() => sendMessage(t('allergyMsg', lang), true), 100);
          }}>
            {t('homeAllergy', lang)}
          </button>
          <button style={{ ...S.homeBtn, ...S.homeBtnAI }} onClick={() => { setScreen('main'); setTab('chat'); }}>
            {t('homeAI', lang)}
          </button>
        </div>
        {/* Cambio lingua */}
        <button style={S.homeLangBtn} onClick={() => { setScreen('lang'); }}>
          {LANG_OPTIONS.find(o => o.code === lang)?.label ?? '🌐'} ▾
        </button>
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
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#f59e0b' }}>
          {t('savedNote', lang)}
        </div>
        {savedDishes.length === 0 ? (
          <p style={{ color: 'var(--text-soft)', textAlign: 'center', marginTop: 32 }}>{t('savedEmpty', lang)}</p>
        ) : (
          <div style={S.orderItems}>
            {savedDishes.map((item, i) => (
              <div key={i} style={{ ...S.orderItem, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', flex: 1 }}>{item.dish.name}</span>
                  <button
                    style={S.deleteBtn}
                    onClick={() => setSavedDishes(prev => prev.filter(x => x.dish.id !== item.dish.id))}
                    title={t('remove', lang)}
                  >✕</button>
                </div>
                {(translatedDishes[item.dish.id] ?? item.dish.description) && (
                  <span style={{ fontSize: 13, color: 'var(--text-soft)', lineHeight: 1.4 }}>{translatedDishes[item.dish.id] ?? item.dish.description}</span>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button style={S.qtyBtn} onClick={() => setSavedDishes(prev => {
                      const updated = prev.map(x => x.dish.id === item.dish.id ? { ...x, qty: x.qty - 1 } : x);
                      return updated.filter(x => x.qty > 0);
                    })}>−</button>
                    <span style={{ color: 'var(--text)', minWidth: 20, textAlign: 'center', fontWeight: 600 }}>{item.qty}</span>
                    <button style={S.qtyBtn} onClick={() => setSavedDishes(prev =>
                      prev.map(x => x.dish.id === item.dish.id ? { ...x, qty: x.qty + 1 } : x)
                    )}>+</button>
                  </div>
                  <span style={{ color: 'var(--brand)', fontWeight: 700, fontSize: 16 }}>{valuta}{(parseFloat(String(item.dish.price)) * item.qty).toFixed(2)}</span>
                </div>
              </div>
            ))}
            <div style={S.orderTotal}>
              <strong>{t('total', lang)}</strong>
              <strong style={{ color: 'var(--brand)' }}>{valuta}{total.toFixed(2)}</strong>
            </div>
          </div>
        )}
        {savedDishes.length > 0 && (
          <button
            style={{ ...S.btnCancel, marginTop: 16 }}
            onClick={() => setSavedDishes([])}
          >{t('clearList', lang)}</button>
        )}
        <button style={{ ...S.btnConfirm, marginTop: 12 }} onClick={() => setScreen('main')}>← {t('menu', lang)}</button>
      </div>
    );
  }

  // ─── Dettaglio piatto (modal) ──────────────────────────────
  const cats = categorieDeiPiatti(dishes);
  const etichetteCat = etichetteDaiPiatti(dishes);
  const visibleDishes = dishes.filter(d => d.category === selectedCat);

  return (
    <div style={S.appWrap}>
      {/* Header */}
      <header style={S.header}>
        <button style={S.backBtn} onClick={() => setShowLangPicker(true)} title="Cambia lingua">
          {LANG_OPTIONS.find(o => o.code === lang)?.label.split(' ')[0] ?? '🌐'}
        </button>
        {logoSrc
          ? <img src={logoSrc} alt="" style={S.headerLogo} onError={() => setLogoSrc('')} />
          : <div style={S.nomeHeader}>{nomeLocale}</div>}
        <button style={S.myDishesBtn} onClick={() => setScreen('saved_dishes')}>
          📋 {t('myDishes', lang)}
          {savedDishes.length > 0 && (
            <span style={S.savedBadgeCount}>{savedDishes.reduce((s, i) => s + i.qty, 0)}</span>
          )}
        </button>
      </header>

      {/* Language picker overlay */}
      {showLangPicker && (
        <div style={S.langPickerOverlay} onClick={() => setShowLangPicker(false)}>
          <div style={S.langPickerBox} onClick={e => e.stopPropagation()}>
            <div style={S.langPickerGrid}>
              {lingueDaMostrare.map(opt => (
                <button
                  key={opt.code}
                  style={lang === opt.code ? S.langPickerBtnActive : S.langPickerBtn}
                  onClick={async () => {
                    if (opt.code === lang) { setShowLangPicker(false); return; }
                    // Cambia lingua restando nella stessa pagina: ricarica solo il
                    // menu gia' tradotto dal database, senza ripartire da capo.
                    setShowLangPicker(false);
                    setLang(opt.code);
                    setTranslatedDishes({});
                    try {
                      const res = await fetch(`${API}/api/menu/${params.restaurant}/dishes/translated?lang=${opt.code}`);
                      if (res.ok) {
                        const data: Dish[] = await res.json();
                        setDishes(data.filter(d => d.available));
                      }
                    } catch { /* resta la lingua precedente */ }
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
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
                {iconaCategoria(c)} {etichetteCat[c] ?? catLabel(c, lang)}{translatingCat === c ? ' ↻' : ''}
              </button>
            ))}
          </div>

          {/* Dish cards */}
          <div style={S.dishGrid}>
            {visibleDishes.map(dish => (
              <button key={dish.id} style={S.dishCard} onClick={() => openDish(dish)}>
                <div style={S.dishInfo}>
                  <div style={S.dishName}>{dish.name}</div>
                  <div style={S.dishDesc}>{translatedDishes[dish.id] ?? dish.description}</div>
                </div>
                <div style={S.dishPrice}>{valuta}{parseFloat(String(dish.price ?? 0)).toFixed(2)}</div>
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
                  {msg.role === 'assistant' ? renderMarkdown(msg.content, dishes, openDish) : msg.content}
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
          {lastDiscussedDish && !loading && (
            <div style={S.saveDishBar}>
              <button
                style={S.saveDishBtn}
                onClick={() => {
                  setSavedDishes(prev => {
                    const existing = prev.find(i => i.dish.id === lastDiscussedDish!.id);
                    if (existing) return prev.map(i => i.dish.id === lastDiscussedDish!.id ? { ...i, qty: i.qty + 1 } : i);
                    return [...prev, { dish: lastDiscussedDish!, qty: 1 }];
                  });
                  setLastDiscussedDish(null);
                }}
              >
                {t('addOrder', lang)}: {lastDiscussedDish.name}
              </button>
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
              : <div style={S.modalIcon}>{iconaCategoria(selectedDish.category)}</div>
            }
            <h2 style={S.modalTitle}>{selectedDish.name}</h2>
            <div style={S.modalPrice}>{valuta}{parseFloat(String(selectedDish.price ?? 0)).toFixed(2)}</div>
            {(translatedDesc ?? translatedDishes[selectedDish.id] ?? selectedDish.description) && (
              <p style={S.modalDesc}>{translatedDesc ?? translatedDishes[selectedDish.id] ?? selectedDish.description}</p>
            )}
            <button style={S.modalAskBtn} onClick={() => askAboutDish(selectedDish)}>
              💬 {t('askMarco', lang).replace('{n}', aiName)}
            </button>
            <button style={S.modalOrderBtn} onClick={() => {
              setSavedDishes(prev => {
                const esistente = prev.find(i => i.dish.id === selectedDish.id);
                if (esistente) return prev.map(i => i.dish.id === selectedDish.id ? { ...i, qty: i.qty + 1 } : i);
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

      {/* ── INVITO INSTAGRAM (dopo 90 secondi) ── */}
      {showIg && instagramUrl && (
        <div style={S.modalOverlay} onClick={igPiuTardi}>
          <div style={S.igBox} onClick={e => e.stopPropagation()}>
            <div style={S.igStripe} />
            <div style={S.igRing}>
              {logoSrc
                ? <img src={logoSrc} alt="" style={S.igLogo} />
                : <div style={S.igGlyphBox}><IgGlyph size={30} /></div>}
            </div>
            <p style={S.igText}>{t('igTitle', lang)}</p>
            <button style={S.igBtn} onClick={igSegui}>
              <IgGlyph size={18} /> {t('igBtn', lang)}
            </button>
            <button style={S.igLater} onClick={igPiuTardi}>{t('igLater', lang)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  appWrap: { fontFamily: 'var(--font, system-ui)', display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg)', overflow: 'hidden' },

  // Home screen
  homeScreen: { fontFamily: 'var(--font, system-ui)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', minHeight: '100dvh', background: 'var(--bg, #000)', padding: '0 0 40px', position: 'relative' as const, overflow: 'hidden' },
  homeLogoWrap: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', position: 'relative' as const },
  nomeCopertina: { fontSize: 26, fontWeight: 800, letterSpacing: '0.02em', textAlign: 'center' as const,
    color: 'var(--text)', padding: '0 18px', lineHeight: 1.25 },
  nomeHome: { fontSize: 30, fontWeight: 800, letterSpacing: '0.02em', textAlign: 'center' as const,
    color: 'var(--text)', padding: '0 20px', lineHeight: 1.2, maxWidth: 340 },
  nomeHeader: { fontSize: 15, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' as const,
    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 },
  homeLogo: { width: '62%', maxWidth: 240, objectFit: 'contain' as const, opacity: 0.94, filter: 'var(--logo-glow)' },
  homeButtons: { display: 'flex', flexDirection: 'column' as const, gap: 14, width: '100%', padding: '0 28px', marginBottom: 8 },
  homeBtn: { width: '100%', padding: '18px 20px', borderRadius: 16, fontSize: 17, fontWeight: 700, background: 'var(--surface)', color: 'var(--text)', border: '1.5px solid var(--border)', cursor: 'pointer', backdropFilter: 'blur(8px)', textAlign: 'center' as const, letterSpacing: 0.3 },
  homeBtnAI: { background: 'var(--brand-soft)', border: '1.5px solid var(--brand)', color: '#fff' },
  homeLangBtn: { marginTop: 18, background: 'none', border: 'none', color: 'var(--text-soft)', fontSize: 15, cursor: 'pointer', padding: '8px 16px' },
  loadingScreen: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 16, background: 'var(--bg)' },
  spinner: { width: 48, height: 48, border: '4px solid var(--border)', borderTop: '4px solid var(--brand)', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  loadingText: { fontSize: 18, fontWeight: 600, color: 'var(--text)' },
  loadingSubText: { fontSize: 13, color: 'var(--text-soft)', textAlign: 'center', padding: '0 32px' },
  errorBox: { background: 'var(--surface-2)', border: '1px solid var(--brand)', color: 'var(--brand)', borderRadius: 10, padding: '12px 16px', fontSize: 14, textAlign: 'center', maxWidth: 320, width: '100%' },

  langScreen: { fontFamily: 'var(--font, system-ui)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: 40, padding: 32, background: 'var(--bg, #000)' },
  coverLogo: { width: 220, objectFit: 'contain' as const },
  loadingChef: { fontSize: 64, animation: 'chef-pulse 1.4s ease-in-out infinite' },
  langGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', maxWidth: 340 },
  langBtn: { padding: '16px 12px', borderRadius: 12, fontSize: 16, fontWeight: 600, background: 'var(--surface)', color: 'var(--text)', border: '1.5px solid var(--border)', cursor: 'pointer' },
  tableTag: { color: 'var(--text-soft)', fontSize: 13 },

  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  backBtn: { background: 'none', color: 'var(--text-soft)', fontSize: 20, padding: 4, border: 'none', cursor: 'pointer', flexShrink: 0 },
  headerLogo: { height: 48, maxWidth: '60%', objectFit: 'contain' as const, flex: 1 },
  headerSub2: { fontSize: 12, color: 'var(--text-soft)', flexShrink: 0 },
  headerSub: { fontSize: 12, color: 'var(--text-soft)' },
  orderBadge: { background: '#22c55e22', color: '#22c55e', padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, flexShrink: 0 },

  tabBar: { display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  tabActive: { flex: 1, padding: '12px', fontSize: 14, fontWeight: 700, color: 'var(--brand)', background: 'none', border: 'none', borderBottom: '2px solid var(--brand)', cursor: 'pointer', position: 'relative' },
  tabInactive: { flex: 1, padding: '12px', fontSize: 14, fontWeight: 500, color: 'var(--text-soft)', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', position: 'relative' },
  chatDot: { position: 'absolute', top: 8, right: 'calc(50% - 20px)', width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)' },

  // Menu tab
  menuWrap: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  catScroll: { display: 'flex', gap: 8, padding: '12px 12px 8px', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' },
  catPill: { flexShrink: 0, padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, background: 'var(--surface)', color: 'var(--text-soft)', border: '1.5px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap' },
  catPillActive: { flexShrink: 0, padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: 'var(--brand)', color: '#fff', border: '1.5px solid var(--brand)', cursor: 'pointer', whiteSpace: 'nowrap' },
  dishGrid: { flex: 1, overflowY: 'auto', padding: '8px 12px 24px', display: 'flex', flexDirection: 'column', gap: 10 },
  dishCard: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
    background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
    cursor: 'pointer', textAlign: 'left', width: '100%',
    transition: 'border-color 0.2s',
  },
  dishIcon: { fontSize: 28, flexShrink: 0 },
  dishInfo: { flex: 1, minWidth: 0 },
  dishName: { fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 3 },
  dishDesc: { fontSize: 12, color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dishPrice: { fontWeight: 700, fontSize: 16, color: 'var(--brand)', flexShrink: 0 },

  // Chat tab
  messages: { flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 12 },
  bubbleUser: { display: 'flex', justifyContent: 'flex-end' },
  bubbleAI: { display: 'flex', justifyContent: 'flex-start' },
  bubbleUserInner: { maxWidth: '78%', background: 'var(--accent)', color: 'var(--text)', borderRadius: '18px 18px 4px 18px', padding: '10px 14px', fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  bubbleAIInner: { maxWidth: '82%', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: '18px 18px 18px 4px', padding: '10px 14px', fontSize: 15, lineHeight: 1.5, border: '1px solid var(--border)', whiteSpace: 'pre-wrap' },
  typingDots: { display: 'inline-flex', gap: 4, alignItems: 'center' },
  dot1: { color: 'var(--brand)', fontSize: 10, animation: 'bounce 1.2s infinite', animationDelay: '0s' },
  dot2: { color: 'var(--brand)', fontSize: 10, animation: 'bounce 1.2s infinite', animationDelay: '0.2s' },
  dot3: { color: 'var(--brand)', fontSize: 10, animation: 'bounce 1.2s infinite', animationDelay: '0.4s' },
  inputArea: { display: 'flex', gap: 8, padding: '12px 12px 16px', background: 'var(--surface)', borderTop: '1px solid var(--border)', flexShrink: 0 },
  input: { flex: 1, background: 'var(--bg)', color: 'var(--text)', border: '1.5px solid var(--border)', borderRadius: 24, padding: '10px 16px', fontSize: 15, outline: 'none' },
  sendBtn: { background: 'var(--brand)', color: 'white', borderRadius: '50%', width: 44, height: 44, fontSize: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 100 },
  modalBox: { background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: '28px 24px 40px', width: '100%', position: 'relative', border: '1px solid var(--border)' },
  modalIcon: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text)', textAlign: 'center', marginBottom: 6 },
  modalPrice: { fontSize: 24, fontWeight: 800, color: 'var(--brand)', textAlign: 'center', marginBottom: 14 },
  modalDesc: { fontSize: 14, color: 'var(--text-soft)', lineHeight: 1.6, textAlign: 'center', marginBottom: 24 },
  // Shared session banner
  sharedBanner: { background: 'var(--accent)', borderBottom: '1px solid var(--border)', padding: '8px 14px', fontSize: 12, color: 'var(--text-soft)', flexShrink: 0, display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  sharedOrdered: { color: '#22c55e', fontWeight: 600 },

  // Group size selector
  groupSelector: { display: 'flex', alignItems: 'center', gap: 8 },
  groupLabel: { fontSize: 20 },
  groupBtn: { width: 40, height: 40, borderRadius: '50%', fontSize: 15, fontWeight: 600, background: 'var(--surface)', color: 'var(--text-soft)', border: '1.5px solid var(--border)', cursor: 'pointer' },
  groupBtnActive: { width: 40, height: 40, borderRadius: '50%', fontSize: 15, fontWeight: 700, background: 'var(--brand)', color: '#fff', border: '1.5px solid var(--brand)', cursor: 'pointer' },

  // Voice input
  micBtn: { background: 'var(--surface)', color: 'var(--text-soft)', border: '1.5px solid var(--border)', borderRadius: '50%', width: 44, height: 44, fontSize: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  micBtnActive: { background: 'var(--brand)', color: '#fff', border: '1.5px solid var(--brand)', borderRadius: '50%', width: 44, height: 44, fontSize: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', animation: 'spin 1.5s linear infinite' },

  // Suggestions
  suggestionsRow: { display: 'flex', gap: 8, padding: '8px 12px', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' as const, position: 'relative', zIndex: 10 },
  suggestionChip: { flexShrink: 0, padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: 'var(--text)', border: '1.5px solid var(--brand)', cursor: 'pointer', whiteSpace: 'nowrap' as const },

  // Modal
  modalImg: { width: '100%', height: 180, objectFit: 'cover' as const, borderRadius: 14, marginBottom: 12 },
  modalAskBtn: { display: 'block', width: '100%', padding: '14px', borderRadius: 14, fontSize: 15, fontWeight: 700, background: 'var(--brand)', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 10 },
  modalOrderBtn: { display: 'block', width: '100%', padding: '14px', borderRadius: 14, fontSize: 15, fontWeight: 700, background: 'var(--surface)', color: 'var(--text)', border: '1.5px solid var(--border)', cursor: 'pointer', marginBottom: 12 },
  modalClose: { position: 'absolute', top: 16, right: 16, background: 'var(--border)', color: 'var(--text-soft)', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 14, cursor: 'pointer' },

  // Invito Instagram
  igBox: { background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: '30px 24px 30px', width: '100%', position: 'relative', border: '1px solid var(--border)', textAlign: 'center' as const, overflow: 'hidden' },
  igStripe: { position: 'absolute' as const, top: 0, left: 0, right: 0, height: 6, background: 'linear-gradient(90deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)' },
  igRing: { width: 76, height: 76, borderRadius: '50%', margin: '4px auto 14px', padding: 3, boxSizing: 'border-box' as const, background: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', display: 'flex' },
  igLogo: { width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' as const, border: '3px solid var(--surface)', background: 'var(--bg)', boxSizing: 'border-box' as const },
  igGlyphBox: { width: '100%', height: '100%', borderRadius: '50%', border: '3px solid var(--surface)', background: 'var(--bg)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' as const },
  igText: { fontSize: 15, lineHeight: 1.45, color: 'var(--text)', margin: '0 0 18px', fontWeight: 600 },
  igBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', borderRadius: 14, fontSize: 15, fontWeight: 700, background: 'linear-gradient(90deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: 8, boxSizing: 'border-box' as const },
  igLater: { display: 'block', width: '100%', padding: '10px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'transparent', color: 'var(--text-soft)', border: 'none', cursor: 'pointer' },

  // Lang picker
  langPickerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 200 },
  langPickerBox: { background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: '20px 16px 32px', width: '100%', border: '1px solid var(--border)' },
  langPickerGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  langPickerBtn: { padding: '12px 10px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: 'var(--bg)', color: 'var(--text-soft)', border: '1.5px solid var(--border)', cursor: 'pointer' },
  langPickerBtnActive: { padding: '12px 10px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: 'var(--brand)', color: '#fff', border: '1.5px solid var(--brand)', cursor: 'pointer' },

  // Confirm
  confirmScreen: { padding: 24, display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100dvh', background: 'var(--bg)' },
  confirmTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text)' },
  orderItems: { background: 'var(--surface)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' },
  orderItem: { display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 15 },
  orderTotal: { display: 'flex', justifyContent: 'space-between', padding: '14px 16px', color: 'var(--brand)', fontSize: 17 },
  confirmBtns: { display: 'flex', gap: 12 },
  btnCancel: { flex: 1, padding: '14px', borderRadius: 12, fontSize: 16, background: 'var(--surface-2)', color: 'var(--text-soft)', border: '1.5px solid var(--border)', cursor: 'pointer' },
  btnConfirm: { flex: 2, padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 700, background: 'var(--brand)', color: 'white', border: 'none', cursor: 'pointer' },
  savedBadgeBtn: { background: 'var(--brand)', border: 'none', borderRadius: 20, padding: '6px 12px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  savedBadgeCount: { background: 'var(--brand)', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, marginLeft: 4 },
  myDishesBtn: { background: 'none', border: '1.5px solid var(--brand)', borderRadius: 20, padding: '5px 12px', color: 'var(--brand)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap' as const },
  deleteBtn: { background: 'none', border: 'none', color: 'var(--brand)', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0 },
  saveDishBar: { padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', flexShrink: 0 },
  saveDishBtn: { width: '100%', padding: '12px', borderRadius: 12, fontSize: 15, fontWeight: 700, background: 'var(--surface)', color: 'var(--text)', border: '1.5px solid var(--brand)', cursor: 'pointer' },
  qtyBtn: { background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
