import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// ─── Types ─────────────────────────────────────────────────
interface AuthData { token: string; restaurant?: { id: string; name: string; slug: string }; role: string; }
interface AdminRestaurant {
  id: string; name: string; slug: string; owner_email: string; logo_url?: string;
  plan: string; subscription_status: string; trial_ends_at: string; monthly_price: number;
  suspended_at: string | null; dish_count: number; sessions_30d: number; created_at: string;
}
interface AdminStats {
  total_restaurants: number; active_subscriptions: number; trialing: number;
  suspended: number; mrr: string; sessions_30d: number; new_30d: number;
}
interface Restaurant { id: string; name: string; slug: string; logo_url?: string; }
interface Dish { id: string; name: string; description: string; price: number; category: string; available: boolean; }
interface BillingStatus { plan: string; subscription_status: string; trial_ends_at: string; monthly_price: number; suspended_at: string | null; }
type Tab = 'today' | 'weekly' | 'menu' | 'logo' | 'qr' | 'billing' | 'settings';

// ─── Auth helpers ───────────────────────────────────────────
function saveAuth(data: AuthData) { localStorage.setItem('owner_auth', JSON.stringify(data)); }
function loadAuth(): AuthData | null {
  try { return JSON.parse(localStorage.getItem('owner_auth') ?? 'null'); } catch { return null; }
}
function clearAuth() { localStorage.removeItem('owner_auth'); }

// ─── API helper ─────────────────────────────────────────────
async function apiFetch(path: string, token: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ─── Login Screen ───────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (data: AuthData) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'owner' | 'admin'>('owner');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const url = mode === 'admin' ? `${API}/api/admin/login` : `${API}/api/auth/login`;
      const data = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).then(r => r.json());
      if (data.error) { setError(data.error); return; }
      saveAuth(data);
      onLogin(data);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.loginLogo}>{mode === 'admin' ? '🛡️' : '🍽️'}</div>
        <h1 style={S.loginTitle}>{mode === 'admin' ? 'Super Admin' : 'Dashboard Ristorante'}</h1>
        <p style={S.loginSub}>{mode === 'admin' ? 'Pannello di amministrazione piattaforma' : 'Accedi per gestire il tuo ristorante'}</p>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={S.formLabel}>Email<input style={S.formInput} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
          <label style={S.formLabel}>Password<input style={S.formInput} type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          {error && <div style={S.errorBox}>{error}</div>}
          <button style={S.btnPrimary} type="submit" disabled={loading}>{loading ? 'Accesso...' : 'Accedi →'}</button>
        </form>
        <button style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', marginTop: 20, textDecoration: 'underline' }}
          onClick={() => { setMode(m => m === 'owner' ? 'admin' : 'owner'); setError(''); }}>
          {mode === 'owner' ? 'Accesso Super Admin →' : '← Accesso Ristorante'}
        </button>
      </div>
    </div>
  );
}

// ─── Super Admin Panel ──────────────────────────────────────
function SuperAdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [tab, setTab] = useState<'dashboard' | 'restaurants' | 'new'>('dashboard');
  const [loading, setLoading] = useState(false);
  const [newForm, setNewForm] = useState({ restaurant_name: '', owner_email: '', owner_password: '', monthly_price: '49' });
  const [newMsg, setNewMsg] = useState('');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [s, r] = await Promise.all([
        fetch(`${API}/api/admin/stats`, { headers }).then(x => x.json()),
        fetch(`${API}/api/admin/restaurants`, { headers }).then(x => x.json()),
      ]);
      setStats(s);
      setRestaurants(Array.isArray(r) ? r : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function createRestaurant() {
    setNewMsg('');
    try {
      const res = await fetch(`${API}/api/admin/restaurants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, monthly_price: parseFloat(newForm.monthly_price) }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewMsg(`✅ Ristorante creato! Slug: ${data.slug} | QR: ${data.qr_base_url}`);
        setNewForm({ restaurant_name: '', owner_email: '', owner_password: '', monthly_price: '49' });
        load();
      } else setNewMsg(`❌ ${data.error}`);
    } catch { setNewMsg('❌ Errore di rete'); }
  }

  async function patchRestaurant(id: string, action: string, extra?: object) {
    await fetch(`${API}/api/admin/restaurants/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    load();
  }

  const filtered = restaurants.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.owner_email?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = (s: string) => s === 'active' ? '#22c55e' : s === 'trialing' ? '#f59e0b' : s === 'past_due' ? '#f97316' : '#ef4444';
  const statusLabel = (s: string) => s === 'active' ? '✅ Attivo' : s === 'trialing' ? '🟡 Trial' : s === 'past_due' ? '🟠 In ritardo' : s === 'suspended' ? '🔴 Sospeso' : s === 'cancelled' ? '❌ Cancellato' : s;

  return (
    <div style={S.root}>
      <aside style={{ ...S.sidebar, background: '#0f172a' }}>
        <div style={{ ...S.sidebarHeader, marginBottom: 28 }}>
          <div style={{ fontSize: 28 }}>🛡️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>Super Admin</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Piattaforma</div>
          </div>
        </div>
        <nav style={S.nav}>
          {([['dashboard', '📊 Dashboard'], ['restaurants', '🍽️ Ristoranti'], ['new', '➕ Nuovo ristorante']] as const).map(([key, label]) => (
            <button key={key} style={{ ...S.navBtn, ...(tab === key ? S.navBtnActive : {}) }} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        <button style={S.logoutBtn} onClick={onLogout}>← Esci</button>
      </aside>

      <main style={S.main}>
        {loading && <div style={S.loader}>Caricamento...</div>}

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && stats && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>📊 Panoramica Piattaforma</h1>
            <div style={S.kpiGrid}>
              <KPI label="Ristoranti totali" value={String(stats.total_restaurants)} color="#6366f1" />
              <KPI label="Abbonamenti attivi" value={String(stats.active_subscriptions)} color="#22c55e" />
              <KPI label="In trial" value={String(stats.trialing)} color="#f59e0b" />
              <KPI label="Sospesi" value={String(stats.suspended)} color="#ef4444" />
              <KPI label="MRR" value={`€${parseFloat(stats.mrr || '0').toFixed(0)}`} color="#6366f1" sub="Ricavo mensile ricorrente" />
              <KPI label="Sessioni (30gg)" value={String(stats.sessions_30d)} color="#0ea5e9" />
              <KPI label="Nuovi (30gg)" value={String(stats.new_30d)} color="#8b5cf6" />
            </div>
          </div>
        )}

        {/* ── RISTORANTI ── */}
        {tab === 'restaurants' && (
          <div style={S.content}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 style={S.pageTitle}>🍽️ Tutti i ristoranti</h1>
              <input style={{ ...S.formInput, width: 240, margin: 0 }} placeholder="🔍 Cerca..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map(r => (
                <div key={r.id} style={{ ...S.formCard, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 17, color: '#1e293b' }}>{r.name}</div>
                      <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                        👤 {r.owner_email} &nbsp;|&nbsp; 🔗 /{r.slug} &nbsp;|&nbsp; 📋 {r.dish_count} piatti &nbsp;|&nbsp; 💬 {r.sessions_30d} sessioni/30gg
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Creato: {new Date(r.created_at).toLocaleDateString('it-IT')}
                        {r.trial_ends_at && ` · Trial fino: ${new Date(r.trial_ends_at).toLocaleDateString('it-IT')}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: statusColor(r.subscription_status) }}>{statusLabel(r.subscription_status)}</div>
                        <div style={{ fontSize: 13, color: '#64748b' }}>€{(r.monthly_price ?? 49).toFixed(0)}/mese</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.suspended_at
                          ? <button style={{ ...S.btnEdit, color: '#22c55e', borderColor: '#22c55e' }} onClick={() => patchRestaurant(r.id, 'activate')}>✅ Riattiva</button>
                          : <button style={{ ...S.btnEdit, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => { if (confirm(`Sospendere ${r.name}?`)) patchRestaurant(r.id, 'suspend'); }}>🔴 Sospendi</button>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── NUOVO RISTORANTE ── */}
        {tab === 'new' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>➕ Nuovo ristorante</h1>
            <div style={S.formCard}>
              <div style={S.formGrid}>
                <label style={S.formLabel}>Nome ristorante<input style={S.formInput} value={newForm.restaurant_name} onChange={e => setNewForm(f => ({ ...f, restaurant_name: e.target.value }))} placeholder="Es. Ristorante Da Mario" /></label>
                <label style={S.formLabel}>Email owner<input style={S.formInput} type="email" value={newForm.owner_email} onChange={e => setNewForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="mario@ristorante.it" /></label>
                <label style={S.formLabel}>Password owner<input style={S.formInput} type="password" value={newForm.owner_password} onChange={e => setNewForm(f => ({ ...f, owner_password: e.target.value }))} placeholder="Min 8 caratteri" /></label>
                <label style={S.formLabel}>Prezzo mensile (€)<input style={S.formInput} type="number" value={newForm.monthly_price} onChange={e => setNewForm(f => ({ ...f, monthly_price: e.target.value }))} /></label>
              </div>
              {newMsg && <div style={{ marginTop: 12, fontSize: 14, padding: '10px 14px', borderRadius: 8, background: newMsg.startsWith('✅') ? '#f0fdf4' : '#fef2f2', color: newMsg.startsWith('✅') ? '#166534' : '#991b1b', border: `1px solid ${newMsg.startsWith('✅') ? '#86efac' : '#fca5a5'}` }}>{newMsg}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button style={S.btnPrimary} onClick={createRestaurant} disabled={!newForm.restaurant_name || !newForm.owner_email || !newForm.owner_password}>
                  ➕ Crea ristorante
                </button>
                <button style={S.btnSecondary} onClick={() => { setNewForm({ restaurant_name: '', owner_email: '', owner_password: '', monthly_price: '49' }); setNewMsg(''); }}>Reset</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState<AuthData | null>(() => loadAuth());
  const [tab, setTab] = useState<Tab>('today');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [today, setToday] = useState<any>(null);
  const [weekly, setWeekly] = useState<any[]>([]);
  const [menu, setMenu] = useState<Dish[]>([]);
  const [menuForm, setMenuForm] = useState<Partial<Dish> | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');
  const [settingsKey, setSettingsKey] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!auth) return;
    apiFetch('/api/auth/me', auth.token)
      .then((me: any) => setRestaurant({ id: me.restaurant_id, name: me.restaurant_name, slug: me.slug }))
      .catch(() => { clearAuth(); setAuth(null); });
  }, [auth]);

  useEffect(() => {
    if (!auth || !restaurant) return;
    loadTab(tab);
  }, [tab, restaurant]);

  async function loadTab(t: Tab) {
    if (!auth || !restaurant) return;
    setLoading(true);
    try {
      if (t === 'today') {
        const data = await apiFetch(`/api/dashboard/${restaurant.id}/today`, auth.token);
        setToday(data);
      } else if (t === 'weekly') {
        const data = await apiFetch(`/api/dashboard/${restaurant.id}/weekly`, auth.token);
        setWeekly(data);
      } else if (t === 'menu') {
        const data = await apiFetch(`/api/menu/${restaurant.slug}/dishes`, auth.token);
        setMenu(data);
      } else if (t === 'billing') {
        const data = await apiFetch('/api/billing/status', auth.token);
        setBilling(data);
      } else if (t === 'logo') {
        const me = await apiFetch('/api/auth/me', auth.token);
        const restFull = await apiFetch(`/api/menu/${me.slug}/info`, auth.token).catch(() => null);
        if (restFull?.logo_url) setRestaurant(r => r ? { ...r, logo_url: restFull.logo_url } : r);
      }
    } catch { /* ignora */ } finally { setLoading(false); }
  }

  async function uploadLogo(file: File) {
    if (!auth) return;
    setLogoUploading(true); setLogoMsg('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch(`${API}/api/upload/logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.logo_url) {
        setRestaurant(r => r ? { ...r, logo_url: `${API}${data.logo_url}` } : r);
        setLogoMsg('✅ Logo aggiornato con successo!');
      } else setLogoMsg(`❌ ${data.error}`);
    } catch { setLogoMsg('❌ Errore upload'); } finally { setLogoUploading(false); }
  }

  async function saveApiKey() {
    if (!auth || !restaurant) return;
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const res = await fetch(`${API}/api/dashboard/${restaurant.id}/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ groq_api_key: settingsKey }),
      });
      const data = await res.json();
      setSettingsMsg(res.ok ? '✅ Chiave salvata!' : `❌ ${data.error}`);
      if (res.ok) setSettingsKey('');
    } catch { setSettingsMsg('❌ Errore di rete'); } finally { setSettingsSaving(false); }
  }

  async function saveDish() {
    if (!auth || !restaurant || !menuForm) return;
    setMenuSaving(true);
    try {
      const method = menuForm.id ? 'PATCH' : 'POST';
      const url = menuForm.id
        ? `${API}/api/menu/${restaurant.slug}/dishes/${menuForm.id}`
        : `${API}/api/menu/${restaurant.slug}/dishes`;
      await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(menuForm),
      });
      setMenuForm(null);
      const data = await apiFetch(`/api/menu/${restaurant.slug}/dishes`, auth.token);
      setMenu(data);
    } finally { setMenuSaving(false); }
  }

  async function deleteDish(id: string) {
    if (!auth || !restaurant || !confirm('Eliminare questo piatto?')) return;
    await fetch(`${API}/api/menu/${restaurant.slug}/dishes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    setMenu(m => m.filter(d => d.id !== id));
  }

  async function startCheckout() {
    if (!auth) return;
    try {
      const data = await apiFetch('/api/billing/checkout', auth.token, { method: 'POST' });
      if (data.url) window.location.href = data.url;
    } catch { alert('Errore checkout Stripe'); }
  }

  async function openPortal() {
    if (!auth) return;
    try {
      const data = await apiFetch('/api/billing/portal', auth.token, { method: 'POST' });
      if (data.url) window.open(data.url, '_blank');
    } catch { alert('Nessun abbonamento attivo'); }
  }

  if (!auth) return <LoginScreen onLogin={d => { saveAuth(d); setAuth(d); }} />;

  if (auth.role === 'superadmin') {
    return <SuperAdminPanel token={auth.token} onLogout={() => { clearAuth(); setAuth(null); }} />;
  }

  const qrUrl = restaurant ? `${window.location.origin.replace('5174', '5173')}/?restaurant=${restaurant.slug}&table=` : '';
  const statusColor = billing?.subscription_status === 'active' ? '#22c55e' : billing?.subscription_status === 'trialing' ? '#f59e0b' : '#ef4444';
  const statusLabel = billing?.subscription_status === 'active' ? '✅ Attivo' : billing?.subscription_status === 'trialing' ? '🟡 Trial' : billing?.subscription_status === 'past_due' ? '🔴 Pagamento in ritardo' : billing?.subscription_status === 'cancelled' ? '❌ Cancellato' : '—';

  const navItems: [Tab, string][] = [
    ['today', '📊 Oggi'],
    ['weekly', '📈 Settimana'],
    ['menu', '📋 Menu'],
    ['logo', '🖼️ Logo'],
    ['qr', '📱 QR Code'],
    ['billing', '💳 Abbonamento'],
    ['settings', '⚙️ Impostazioni'],
  ];

  return (
    <div style={S.root}>
      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          {restaurant?.logo_url
            ? <img src={restaurant.logo_url} alt="logo" style={{ height: 40, objectFit: 'contain', borderRadius: 8 }} />
            : <div style={S.sidebarLogo}>🍽️</div>}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>{restaurant?.name ?? '...'}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Dashboard</div>
          </div>
        </div>
        <nav style={S.nav}>
          {navItems.map(([key, label]) => (
            <button key={key} style={{ ...S.navBtn, ...(tab === key ? S.navBtnActive : {}) }} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <button style={S.logoutBtn} onClick={() => { clearAuth(); setAuth(null); }}>
          ← Esci
        </button>
      </aside>

      {/* Main */}
      <main style={S.main}>
        {loading && <div style={S.loader}>Caricamento...</div>}

        {/* ── OGGI ── */}
        {tab === 'today' && today && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>📊 Riepilogo di oggi</h1>
            <div style={S.kpiGrid}>
              <KPI label="Ricavo" value={`€${parseFloat(today.today?.revenue ?? 0).toFixed(2)}`} color="#6366f1" />
              <KPI label="Ordini" value={String(today.today?.orders_count ?? 0)} color="#0ea5e9" />
              <KPI label="Scontrino medio" value={`€${parseFloat(today.today?.avg_order ?? 0).toFixed(2)}`} color="#22c55e" />
              <KPI label="Ordini attivi" value={String(today.active_orders ?? 0)} color="#f59e0b" />
            </div>
            {today.top_dishes?.length > 0 && (
              <>
                <h2 style={S.sectionTitle}>Top piatti oggi</h2>
                <div style={S.table}>
                  <div style={S.tableHeader}><span>Piatto</span><span>Vendite</span><span>Ricavo</span></div>
                  {today.top_dishes.map((d: any, i: number) => (
                    <div key={i} style={S.tableRow}>
                      <span>{d.dish_name}</span><span>{d.qty_sold} pz</span><span>€{parseFloat(d.revenue).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── SETTIMANA ── */}
        {tab === 'weekly' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>📈 Andamento settimanale</h1>
            <div style={S.chartCard}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={weekly.map(d => ({ ...d, revenue: parseFloat(d.revenue) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
                  <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── MENU ── */}
        {tab === 'menu' && (
          <div style={S.content}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 style={S.pageTitle}>📋 Gestione Menu</h1>
              <button style={S.btnPrimary} onClick={() => setMenuForm({ name: '', description: '', price: 0, category: 'antipasti', available: true })}>
                + Aggiungi piatto
              </button>
            </div>
            {menuForm !== null && (
              <div style={S.formCard}>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{menuForm.id ? 'Modifica' : 'Nuovo piatto'}</h2>
                <div style={S.formGrid}>
                  <label style={S.formLabel}>Nome<input style={S.formInput} value={menuForm.name ?? ''} onChange={e => setMenuForm(f => ({ ...f, name: e.target.value }))} /></label>
                  <label style={S.formLabel}>Categoria
                    <select style={S.formInput} value={menuForm.category ?? 'antipasti'} onChange={e => setMenuForm(f => ({ ...f, category: e.target.value }))}>
                      {['antipasti','pizze','primi','secondi','contorni','dolci','cocktails','spirits','birre','vini','soft_drinks'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label style={S.formLabel}>Prezzo (€)<input style={S.formInput} type="number" step="0.5" value={menuForm.price ?? 0} onChange={e => setMenuForm(f => ({ ...f, price: parseFloat(e.target.value) }))} /></label>
                  <label style={S.formLabel}>Disponibile
                    <select style={S.formInput} value={menuForm.available ? 'si' : 'no'} onChange={e => setMenuForm(f => ({ ...f, available: e.target.value === 'si' }))}>
                      <option value="si">Sì</option><option value="no">No</option>
                    </select>
                  </label>
                </div>
                <label style={{ ...S.formLabel, marginTop: 8 }}>Descrizione<textarea style={{ ...S.formInput, minHeight: 64, resize: 'vertical' }} value={menuForm.description ?? ''} onChange={e => setMenuForm(f => ({ ...f, description: e.target.value }))} /></label>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button style={S.btnPrimary} disabled={menuSaving} onClick={saveDish}>{menuSaving ? 'Salvataggio...' : 'Salva'}</button>
                  <button style={S.btnSecondary} onClick={() => setMenuForm(null)}>Annulla</button>
                </div>
              </div>
            )}
            {['antipasti','pizze','primi','secondi','contorni','dolci','cocktails','spirits','birre','vini','soft_drinks'].map(cat => {
              const dishes = menu.filter(d => d.category === cat);
              if (!dishes.length) return null;
              return (
                <div key={cat}>
                  <h2 style={{ ...S.sectionTitle, textTransform: 'capitalize' }}>{cat}</h2>
                  <div style={S.table}>
                    <div style={{ ...S.tableHeader, gridTemplateColumns: '2fr 2fr 1fr 1fr 80px 60px' }}>
                      <span>Nome</span><span>Descrizione</span><span>Prezzo</span><span>Stato</span><span></span><span></span>
                    </div>
                    {dishes.map(d => (
                      <div key={d.id} style={{ ...S.tableRow, gridTemplateColumns: '2fr 2fr 1fr 1fr 80px 60px' }}>
                        <span style={{ fontWeight: 600 }}>{d.name}</span>
                        <span style={{ color: '#64748b', fontSize: 13 }}>{d.description}</span>
                        <span>€{parseFloat(String(d.price)).toFixed(2)}</span>
                        <span style={{ color: d.available ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{d.available ? '✓ Attivo' : '✗ Nascosto'}</span>
                        <button style={S.btnEdit} onClick={() => setMenuForm({ ...d })}>Modifica</button>
                        <button style={{ ...S.btnEdit, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => deleteDish(d.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── LOGO ── */}
        {tab === 'logo' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>🖼️ Logo Ristorante</h1>
            <div style={S.formCard}>
              <p style={{ color: '#64748b', marginBottom: 20 }}>
                Il logo apparirà nell'app del cliente al posto dell'icona predefinita.<br />
                Formati supportati: PNG, JPG, WebP, SVG. Max 5MB.
              </p>
              {restaurant?.logo_url && (
                <div style={{ marginBottom: 20, textAlign: 'center' }}>
                  <p style={{ color: '#64748b', fontSize: 13, marginBottom: 8 }}>Logo attuale:</p>
                  <img src={restaurant.logo_url} alt="logo" style={{ maxHeight: 120, maxWidth: 280, objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }} />
                </div>
              )}
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} />
              <button style={S.btnPrimary} disabled={logoUploading} onClick={() => logoInputRef.current?.click()}>
                {logoUploading ? '⏳ Caricamento...' : '📤 Carica nuovo logo'}
              </button>
              {logoMsg && <div style={{ marginTop: 12, fontSize: 14, color: logoMsg.startsWith('✅') ? '#166534' : '#ef4444' }}>{logoMsg}</div>}
            </div>
          </div>
        )}

        {/* ── QR CODE ── */}
        {tab === 'qr' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>📱 QR Code per Tavoli</h1>
            <div style={S.formCard}>
              <p style={{ color: '#64748b', marginBottom: 20 }}>
                Stampa il QR code per ogni tavolo e posizionalo sul tavolo. Il cliente lo scansionerà per accedere al menu.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(tableNum => {
                  const url = `${qrUrl}${tableNum}`;
                  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
                  return (
                    <div key={tableNum} style={S.qrCard}>
                      <div style={{ fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>Tavolo {tableNum}</div>
                      <img src={qrApiUrl} alt={`QR Tavolo ${tableNum}`} style={{ width: 150, height: 150, borderRadius: 8 }} />
                      <a href={qrApiUrl} download={`tavolo-${tableNum}.png`} style={{ ...S.btnPrimary, display: 'inline-block', marginTop: 10, textDecoration: 'none', fontSize: 13, padding: '6px 14px' }}>
                        ⬇ Scarica
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── BILLING ── */}
        {tab === 'billing' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>💳 Abbonamento</h1>
            {billing && (
              <div style={S.formCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>Stato abbonamento</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: statusColor }}>{statusLabel}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: '#64748b' }}>Piano</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{billing.plan === 'trial' ? 'Trial gratuito' : billing.plan === 'pro' ? '🚀 Pro' : billing.plan}</div>
                  </div>
                </div>

                {billing.subscription_status === 'trialing' && billing.trial_ends_at && (
                  <div style={S.infoBox}>
                    ⏳ Trial gratuito fino al <strong>{new Date(billing.trial_ends_at).toLocaleDateString('it-IT')}</strong>.
                    Attiva l'abbonamento per continuare dopo la scadenza.
                  </div>
                )}

                {billing.subscription_status === 'past_due' && (
                  <div style={{ ...S.infoBox, background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
                    ⚠️ Pagamento in ritardo. Aggiorna il metodo di pagamento per evitare la sospensione.
                  </div>
                )}

                {billing.suspended_at && (
                  <div style={{ ...S.infoBox, background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
                    🚫 Account sospeso il {new Date(billing.suspended_at).toLocaleDateString('it-IT')}. Contatta il supporto.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
                  <div style={S.kpiCard}>
                    <div style={S.kpiLabel}>Costo mensile</div>
                    <div style={{ ...S.kpiValue, color: '#6366f1', fontSize: 28 }}>€{(billing.monthly_price ?? 49).toFixed(2)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                  {(billing.subscription_status === 'trialing' || billing.subscription_status === 'cancelled') && (
                    <button style={S.btnPrimary} onClick={startCheckout}>
                      💳 Attiva abbonamento Pro
                    </button>
                  )}
                  {billing.subscription_status === 'active' && (
                    <button style={S.btnSecondary} onClick={openPortal}>
                      ⚙️ Gestisci pagamenti
                    </button>
                  )}
                  {billing.subscription_status === 'past_due' && (
                    <button style={S.btnPrimary} onClick={openPortal}>
                      💳 Aggiorna pagamento
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── IMPOSTAZIONI ── */}
        {tab === 'settings' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>⚙️ Impostazioni</h1>
            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🤖 Chiave API AI</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
                Usa la tua chiave API Groq gratuita per alimentare l'assistente Marco.<br />
                Ottieni la tua chiave su <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>console.groq.com</a>
              </p>
              <label style={S.formLabel}>
                Chiave API (inizia con <code>gsk_</code>)
                <input style={S.formInput} type="password" placeholder="gsk_..." value={settingsKey} onChange={e => { setSettingsKey(e.target.value); setSettingsMsg(''); }} />
              </label>
              {settingsMsg && <div style={{ marginTop: 8, fontSize: 14, color: settingsMsg.startsWith('✅') ? '#166534' : '#ef4444' }}>{settingsMsg}</div>}
              <button style={{ ...S.btnPrimary, marginTop: 16 }} disabled={settingsSaving || !settingsKey} onClick={saveApiKey}>
                {settingsSaving ? 'Salvataggio...' : 'Salva chiave'}
              </button>
            </div>

            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🔗 Link QR del tuo ristorante</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 12 }}>Condividi questo link o vai nella sezione QR per i codici stampabili.</p>
              <code style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, fontSize: 13, display: 'block', wordBreak: 'break-all' }}>
                {qrUrl}1
              </code>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function KPI({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ ...S.kpiCard, borderTopColor: color }}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color }}>{value}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  // Login
  loginWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f1f5f9' },
  loginCard: { background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: '0 4px 24px #0001' },
  loginLogo: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  loginTitle: { fontSize: 24, fontWeight: 700, textAlign: 'center', color: '#1e293b', marginBottom: 4 },
  loginSub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 28 },
  errorBox: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: 14 },

  // Layout
  root: { display: 'flex', minHeight: '100vh', background: '#f8fafc' },
  sidebar: { width: 240, background: '#1e293b', color: '#f8fafc', display: 'flex', flexDirection: 'column', padding: '20px 16px', gap: 4, flexShrink: 0 },
  sidebarHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, padding: '0 4px' },
  sidebarLogo: { fontSize: 28 },
  nav: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  navBtn: { background: 'none', color: '#94a3b8', border: 'none', padding: '10px 12px', borderRadius: 8, fontSize: 14, textAlign: 'left', cursor: 'pointer' },
  navBtnActive: { background: '#334155', color: '#f8fafc', fontWeight: 600 },
  logoutBtn: { background: 'none', color: '#64748b', border: 'none', padding: '10px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left', marginTop: 8, borderTop: '1px solid #334155', paddingTop: 16 },
  main: { flex: 1, overflowY: 'auto' },
  loader: { padding: 40, color: '#64748b' },
  content: { padding: 32, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 },
  pageTitle: { fontSize: 26, fontWeight: 700, color: '#1e293b' },

  // KPI
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 },
  kpiCard: { background: '#fff', borderRadius: 12, padding: '18px 20px', borderTop: '4px solid #6366f1', boxShadow: '0 1px 3px #0001' },
  kpiLabel: { fontSize: 13, color: '#64748b', marginBottom: 6 },
  kpiValue: { fontSize: 28, fontWeight: 700 },
  kpiSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: 600, color: '#1e293b' },
  chartCard: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px #0001' },

  // Table
  table: { background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px #0001' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 16px', background: '#f1f5f9', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '12px 16px', borderTop: '1px solid #e2e8f0', fontSize: 14, color: '#1e293b', alignItems: 'center' },

  // Buttons
  btnPrimary: { background: '#6366f1', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { background: '#f1f5f9', color: '#1e293b', border: '1px solid #e2e8f0', padding: '10px 20px', borderRadius: 8, fontSize: 14, cursor: 'pointer' },
  btnEdit: { background: 'none', color: '#6366f1', border: '1px solid #6366f1', padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer' },

  // Forms
  formCard: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px #0001', border: '1px solid #e2e8f0' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  formLabel: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: '#475569' },
  formInput: { marginTop: 2, padding: '8px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 14, color: '#1e293b', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },

  // QR
  qrCard: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' },

  // Billing
  infoBox: { background: '#fefce8', border: '1px solid #fde047', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#713f12', marginBottom: 8 },
};
