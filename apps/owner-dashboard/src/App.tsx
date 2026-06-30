import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

type Tab = 'today' | 'weekly' | 'inventory' | 'margins' | 'forecast' | 'menu' | 'settings';
interface Restaurant { id: string; name: string; slug: string; }

interface TodayData {
  orders_count: string;
  tables_served: string;
  revenue: string;
  avg_order: string;
}

interface WeekDay { date: string; revenue: string; orders: string; avg_order: string; }
interface TopDish { dish_name: string; qty_sold: string; revenue: string; }
interface StockAlert { ingredient_id: string; name: string; current_qty: number; unit: string; level: string; min_threshold: number; }
interface MarginDish { id: string; name: string; price: number; cost: number; margin_pct: number; sold_last_30d: number; profit_last_30d: number; category: string; }
interface ForecastItem { ingredient_id: string; name: string; unit: string; current_qty: number; avg_daily_consumption: number; days_until_empty: number | null; suggested_reorder_qty: number; risk_level: string; expiry_date: string | null; }
interface PortionItem { dish_id: string; dish_name: string; category: string; limiting_ingredient: string; max_portions_possible: number; }
interface Dish { id: string; name: string; description: string; price: number; category: string; available: boolean; }

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [today, setToday] = useState<{ today: TodayData; last_week_avg_order: number; active_orders: number; top_dishes: TopDish[]; stock_alerts: { critical: string; warning: string } } | null>(null);
  const [weekly, setWeekly] = useState<WeekDay[]>([]);
  const [inventory, setInventory] = useState<StockAlert[]>([]);
  const [margins, setMargins] = useState<MarginDish[]>([]);
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [portions, setPortions] = useState<PortionItem[]>([]);
  const [menu, setMenu] = useState<Dish[]>([]);
  const [menuForm, setMenuForm] = useState<Partial<Dish> | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);
  const [settingsKey, setSettingsKey] = useState('');
  const [settingsStatus, setSettingsStatus] = useState<{ has_key: boolean; groq_api_key: string | null } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRest, setSelectedRest] = useState<Restaurant | null>(null);

  useEffect(() => {
    fetch(`${API}/api/auth/restaurants`)
      .then(r => r.json())
      .then((data: Restaurant[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setRestaurants(data);
          const defaultId = import.meta.env.VITE_RESTAURANT_ID;
          const def = defaultId ? data.find(x => x.id === defaultId) : null;
          setSelectedRest(def ?? data[0]);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedRest) loadTab(tab);
  }, [tab, selectedRest]);

  async function loadTab(t: Tab) {
    setLoading(true);
    try {
      if (t === 'today') {
        const res = await fetch(`${API}/api/dashboard/${selectedRest?.id}/today`);
        setToday(await res.json());
      } else if (t === 'weekly') {
        const res = await fetch(`${API}/api/dashboard/${selectedRest?.id}/weekly`);
        setWeekly(await res.json());
      } else if (t === 'inventory') {
        const res = await fetch(`${API}/api/inventory/${selectedRest?.id}/alerts`);
        setInventory(await res.json());
      } else if (t === 'margins') {
        const res = await fetch(`${API}/api/dashboard/${selectedRest?.id}/margins`);
        setMargins(await res.json());
      } else if (t === 'menu') {
        const res = await fetch(`${API}/api/menu/${selectedRest?.slug}/dishes`);
        setMenu(await res.json());
      } else if (t === 'settings') {
        const res = await fetch(`${API}/api/dashboard/${selectedRest?.id}/settings`);
        setSettingsStatus(await res.json());
      } else if (t === 'forecast') {
        const [f, p] = await Promise.all([
          fetch(`${API}/api/forecast/${selectedRest?.id}`).then(r => r.json()),
          fetch(`${API}/api/forecast/${selectedRest?.id}/portions`).then(r => r.json()),
        ]);
        setForecast(f);
        setPortions(p);
      }
    } catch {
      // gestito con dati vuoti
    } finally {
      setLoading(false);
    }
  }

  const avgDelta = today
    ? parseFloat(today.today.avg_order) - today.last_week_avg_order
    : 0;

  return (
    <div style={S.root}>
      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.logo}>🍽️ Dashboard</div>
        {restaurants.length > 1 && (
          <select
            style={{ ...S.formInput, marginBottom: 16, background: '#334155', color: '#f8fafc', border: '1px solid #475569' }}
            value={selectedRest?.id ?? ''}
            onChange={e => {
              const r = restaurants.find(x => x.id === e.target.value);
              if (r) setSelectedRest(r);
            }}
          >
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <nav style={S.nav}>
          {([
            ['today', '📊 Oggi'],
            ['weekly', '📈 Settimana'],
            ['inventory', '🥩 Magazzino'],
            ['margins', '💰 Margini'],
          ['forecast', '🔮 Forecast'],
          ['menu', '📋 Menu'],
          ['settings', '⚙️ Impostazioni'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              style={{ ...S.navBtn, ...(tab === key ? S.navBtnActive : {}) }}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main style={S.main}>
        {loading && <div style={S.loader}>Caricamento...</div>}

        {/* ── OGGI ─────────────────────────────────────────── */}
        {tab === 'today' && today && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>Riepilogo di oggi</h1>

            <div style={S.kpiGrid}>
              <KPI label="Ricavo" value={`€${parseFloat(today.today.revenue).toFixed(2)}`} color="#6366f1" />
              <KPI label="Ordini" value={today.today.orders_count} color="#0ea5e9" />
              <KPI label="Scontrino medio" value={`€${parseFloat(today.today.avg_order).toFixed(2)}`}
                color={avgDelta >= 0 ? '#22c55e' : '#ef4444'}
                sub={`${avgDelta >= 0 ? '▲' : '▼'} €${Math.abs(avgDelta).toFixed(2)} vs settimana scorsa`}
              />
              <KPI label="Ordini attivi" value={String(today.active_orders)} color="#f59e0b" />
            </div>

            {/* Alert magazzino */}
            {(parseInt(today.stock_alerts.critical) > 0 || parseInt(today.stock_alerts.warning) > 0) && (
              <div style={S.alertBox}>
                <strong>⚠️ Magazzino:</strong>
                {parseInt(today.stock_alerts.critical) > 0 && (
                  <span style={{ color: '#ef4444', marginLeft: 8 }}>
                    {today.stock_alerts.critical} ingrediente/i CRITICO/I
                  </span>
                )}
                {parseInt(today.stock_alerts.warning) > 0 && (
                  <span style={{ color: '#f59e0b', marginLeft: 8 }}>
                    {today.stock_alerts.warning} in ATTENZIONE
                  </span>
                )}
                <button style={S.alertLink} onClick={() => setTab('inventory')}>Vai al magazzino →</button>
              </div>
            )}

            {/* Top piatti */}
            <h2 style={S.sectionTitle}>Top piatti oggi</h2>
            <div style={S.table}>
              <div style={S.tableHeader}>
                <span>Piatto</span><span>Vendite</span><span>Ricavo</span>
              </div>
              {today.top_dishes.map((d, i) => (
                <div key={i} style={S.tableRow}>
                  <span>{d.dish_name}</span>
                  <span>{d.qty_sold} pz</span>
                  <span>€{parseFloat(d.revenue).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SETTIMANA ─────────────────────────────────────── */}
        {tab === 'weekly' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>Andamento settimanale</h1>
            <div style={S.chartCard}>
              <h3 style={{ marginBottom: 12, color: '#64748b' }}>Ricavo giornaliero (€)</h3>
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
            <div style={S.table}>
              <div style={S.tableHeader}>
                <span>Data</span><span>Ordini</span><span>Ricavo</span><span>Medio</span>
              </div>
              {weekly.map((d, i) => (
                <div key={i} style={S.tableRow}>
                  <span>{d.date}</span>
                  <span>{d.orders}</span>
                  <span>€{parseFloat(d.revenue).toFixed(2)}</span>
                  <span>€{parseFloat(d.avg_order).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MAGAZZINO ─────────────────────────────────────── */}
        {tab === 'inventory' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>Magazzino</h1>
            <div style={S.table}>
              <div style={S.tableHeader}>
                <span>Ingrediente</span><span>Quantità</span><span>Soglia min.</span><span>Stato</span>
              </div>
              {inventory.map((item) => (
                <div key={item.ingredient_id} style={S.tableRow}>
                  <span style={{ fontWeight: 600 }}>{item.name}</span>
                  <span>{item.current_qty} {item.unit}</span>
                  <span>{item.min_threshold} {item.unit}</span>
                  <span style={{
                    color: item.level === 'critical' ? '#ef4444' : item.level === 'warning' ? '#f59e0b' : '#22c55e',
                    fontWeight: 700,
                  }}>
                    {item.level === 'critical' ? '🔴 CRITICO' : item.level === 'warning' ? '🟡 ATTENZIONE' : '🟢 OK'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── FORECAST ─────────────────────────────────────── */}
        {tab === 'forecast' && (
          <div style={S.content}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h1 style={S.pageTitle}>Forecast scorte</h1>
              <a
                href={`${API}/api/forecast/${selectedRest?.id}/report`}
                target="_blank"
                rel="noreferrer"
                style={{ background: '#6366f1', color: 'white', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
              >
                📄 Scarica Report PDF
              </a>
            </div>

            <h2 style={S.sectionTitle}>Porzioni ancora realizzabili per piatto</h2>
            <div style={S.table}>
              <div style={{ ...S.tableHeader, gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                <span>Piatto</span><span>Porzioni max</span><span>Ingrediente limite</span><span>Rischio</span>
              </div>
              {portions.map((p) => {
                const risk = p.max_portions_possible <= 3 ? '#ef4444' : p.max_portions_possible <= 10 ? '#f59e0b' : '#22c55e';
                return (
                  <div key={p.dish_id} style={{ ...S.tableRow, gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                    <span style={{ fontWeight: 600 }}>{p.dish_name}</span>
                    <span style={{ color: risk, fontWeight: 700 }}>{p.max_portions_possible} pz</span>
                    <span style={{ color: '#64748b', fontSize: 12 }}>{p.limiting_ingredient || '—'}</span>
                    <span style={{ color: risk }}>
                      {p.max_portions_possible <= 3 ? '🔴 Critico' : p.max_portions_possible <= 10 ? '🟡 Attenzione' : '🟢 OK'}
                    </span>
                  </div>
                );
              })}
            </div>

            <h2 style={S.sectionTitle}>Previsione giorni rimasti per ingrediente</h2>
            <div style={S.table}>
              <div style={{ ...S.tableHeader, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                <span>Ingrediente</span><span>Scorta</span><span>Cons./giorno</span><span>Giorni rimasti</span><span>Riordino consigliato</span>
              </div>
              {forecast.map((f) => {
                const riskColor = f.risk_level === 'critical' ? '#ef4444' : f.risk_level === 'order_soon' ? '#f97316' : f.risk_level === 'watch' ? '#f59e0b' : '#22c55e';
                const emoji = f.risk_level === 'critical' ? '🔴' : f.risk_level === 'order_soon' ? '🟠' : f.risk_level === 'watch' ? '🟡' : '🟢';
                return (
                  <div key={f.ingredient_id} style={{ ...S.tableRow, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                    <span style={{ fontWeight: 600 }}>{emoji} {f.name}</span>
                    <span>{f.current_qty}{f.unit}</span>
                    <span style={{ color: '#64748b' }}>{f.avg_daily_consumption > 0 ? `${f.avg_daily_consumption}${f.unit}` : '—'}</span>
                    <span style={{ color: riskColor, fontWeight: 700 }}>
                      {f.days_until_empty !== null ? `${f.days_until_empty} gg` : '—'}
                    </span>
                    <span style={{ color: '#6366f1', fontWeight: 600 }}>
                      {f.suggested_reorder_qty > 0 ? `${f.suggested_reorder_qty}${f.unit}` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MENU ─────────────────────────────────────────── */}
        {tab === 'menu' && (
          <div style={S.content}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h1 style={S.pageTitle}>Gestione Menu</h1>
              <button style={S.btnPrimary} onClick={() => setMenuForm({ name: '', description: '', price: 0, category: 'primi', available: true })}>
                + Aggiungi piatto
              </button>
            </div>

            {menuForm !== null && (
              <div style={S.formCard}>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                  {menuForm.id ? 'Modifica piatto' : 'Nuovo piatto'}
                </h2>
                <div style={S.formGrid}>
                  <label style={S.formLabel}>Nome
                    <input style={S.formInput} value={menuForm.name ?? ''} onChange={e => setMenuForm(f => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label style={S.formLabel}>Categoria
                    <select style={S.formInput} value={menuForm.category ?? 'primi'} onChange={e => setMenuForm(f => ({ ...f, category: e.target.value }))}>
                      {['antipasti','pizze','primi','secondi','contorni','dolci','cocktails','spirits','birre','vini','soft_drinks'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label style={S.formLabel}>Prezzo (€)
                    <input style={S.formInput} type="number" step="0.5" value={menuForm.price ?? 0} onChange={e => setMenuForm(f => ({ ...f, price: parseFloat(e.target.value) }))} />
                  </label>
                  <label style={S.formLabel}>Disponibile
                    <select style={S.formInput} value={menuForm.available ? 'si' : 'no'} onChange={e => setMenuForm(f => ({ ...f, available: e.target.value === 'si' }))}>
                      <option value="si">Sì</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </div>
                <label style={{ ...S.formLabel, marginTop: 8 }}>Descrizione
                  <textarea style={{ ...S.formInput, minHeight: 64, resize: 'vertical' }} value={menuForm.description ?? ''} onChange={e => setMenuForm(f => ({ ...f, description: e.target.value }))} />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button style={S.btnPrimary} disabled={menuSaving} onClick={async () => {
                    setMenuSaving(true);
                    try {
                      const method = menuForm.id ? 'PATCH' : 'POST';
                      const url = menuForm.id
                        ? `${API}/api/menu/da-mario/dishes/${menuForm.id}`
                        : `${API}/api/menu/${selectedRest?.slug}/dishes`;
                      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menuForm) });
                      setMenuForm(null);
                      const res = await fetch(`${API}/api/menu/${selectedRest?.slug}/dishes`);
                      setMenu(await res.json());
                    } finally {
                      setMenuSaving(false);
                    }
                  }}>
                    {menuSaving ? 'Salvataggio...' : 'Salva'}
                  </button>
                  <button style={S.btnSecondary} onClick={() => setMenuForm(null)}>Annulla</button>
                </div>
              </div>
            )}

            {['antipasti','pizze','primi','secondi','contorni','dolci','cocktails','spirits','birre','vini','soft_drinks'].map(cat => {
              const dishes = menu.filter(d => d.category === cat);
              if (dishes.length === 0) return null;
              return (
                <div key={cat}>
                  <h2 style={{ ...S.sectionTitle, textTransform: 'capitalize' }}>{cat}</h2>
                  <div style={S.table}>
                    <div style={{ ...S.tableHeader, gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr' }}>
                      <span>Nome</span><span>Descrizione</span><span>Prezzo</span><span>Stato</span><span></span>
                    </div>
                    {dishes.map(d => (
                      <div key={d.id} style={{ ...S.tableRow, gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr' }}>
                        <span style={{ fontWeight: 600 }}>{d.name}</span>
                        <span style={{ color: '#64748b', fontSize: 13 }}>{d.description}</span>
                        <span>€{parseFloat(String(d.price)).toFixed(2)}</span>
                        <span style={{ color: d.available ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                          {d.available ? '✓ Attivo' : '✗ Nascosto'}
                        </span>
                        <button style={S.btnEdit} onClick={() => setMenuForm({ ...d })}>Modifica</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── IMPOSTAZIONI ─────────────────────────────────── */}
        {tab === 'settings' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>Impostazioni</h1>
            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🤖 Chiave API Groq (AI gratuita)</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
                Crea un account gratuito su <strong>console.groq.com</strong>, genera una API key e incollala qui.
                In questo modo l'AI del tuo ristorante usa il tuo piano gratuito Groq — senza costi aggiuntivi.
              </p>
              {settingsStatus?.has_key && (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#166534' }}>
                  ✅ Chiave attiva: <code>{settingsStatus.groq_api_key}</code>
                </div>
              )}
              <label style={S.formLabel}>
                Nuova chiave API (inizia con <code>gsk_</code>)
                <input
                  style={S.formInput}
                  type="password"
                  placeholder="gsk_..."
                  value={settingsKey}
                  onChange={e => { setSettingsKey(e.target.value); setSettingsMsg(''); }}
                />
              </label>
              {settingsMsg && (
                <div style={{ marginTop: 8, fontSize: 14, color: settingsMsg.startsWith('✅') ? '#166534' : '#ef4444' }}>
                  {settingsMsg}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button style={S.btnPrimary} disabled={settingsSaving || !settingsKey} onClick={async () => {
                  setSettingsSaving(true);
                  setSettingsMsg('');
                  try {
                    const res = await fetch(`${API}/api/dashboard/${selectedRest?.id}/settings`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ groq_api_key: settingsKey }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setSettingsMsg('✅ Chiave salvata con successo!');
                      setSettingsKey('');
                      const updated = await fetch(`${API}/api/dashboard/${selectedRest?.id}/settings`);
                      setSettingsStatus(await updated.json());
                    } else {
                      setSettingsMsg(`❌ ${data.error}`);
                    }
                  } catch {
                    setSettingsMsg('❌ Errore di rete, riprova.');
                  } finally {
                    setSettingsSaving(false);
                  }
                }}>
                  {settingsSaving ? 'Salvataggio...' : 'Salva chiave'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MARGINI ──────────────────────────────────────── */}
        {tab === 'margins' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>Margini per piatto (ultimi 30 gg)</h1>
            <div style={S.table}>
              <div style={S.tableHeader}>
                <span>Piatto</span><span>Prezzo</span><span>Costo</span><span>Margine %</span><span>Profitto</span>
              </div>
              {margins.map((d) => (
                <div key={d.id} style={S.tableRow}>
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                  <span>€{d.price?.toFixed(2)}</span>
                  <span>€{d.cost?.toFixed(2)}</span>
                  <span style={{ color: d.margin_pct > 60 ? '#22c55e' : d.margin_pct > 40 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>
                    {d.margin_pct}%
                  </span>
                  <span>€{parseFloat(String(d.profit_last_30d)).toFixed(2)}</span>
                </div>
              ))}
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
  root: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 220, background: '#1e293b', color: '#f8fafc',
    display: 'flex', flexDirection: 'column', padding: 24, gap: 8, flexShrink: 0,
  },
  logo: { fontSize: 20, fontWeight: 700, marginBottom: 24 },
  nav: { display: 'flex', flexDirection: 'column', gap: 4 },
  navBtn: {
    background: 'none', color: '#94a3b8', border: 'none',
    padding: '10px 14px', borderRadius: 8, fontSize: 14,
    textAlign: 'left', cursor: 'pointer',
  },
  navBtnActive: { background: '#334155', color: '#f8fafc', fontWeight: 600 },
  main: { flex: 1, overflowY: 'auto' },
  loader: { padding: 40, color: '#64748b', fontSize: 16 },
  content: { padding: 32, display: 'flex', flexDirection: 'column', gap: 24 },
  pageTitle: { fontSize: 26, fontWeight: 700, color: '#1e293b' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 },
  kpiCard: {
    background: '#fff', borderRadius: 12, padding: '18px 20px',
    borderTop: '4px solid #6366f1', boxShadow: '0 1px 3px #0001',
  },
  kpiLabel: { fontSize: 13, color: '#64748b', marginBottom: 6 },
  kpiValue: { fontSize: 28, fontWeight: 700 },
  kpiSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  alertBox: {
    background: '#fef3c7', borderRadius: 10, padding: '12px 16px',
    border: '1px solid #fbbf24', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
  },
  alertLink: { background: 'none', border: 'none', color: '#6366f1', fontWeight: 600, marginLeft: 'auto', cursor: 'pointer' },
  sectionTitle: { fontSize: 17, fontWeight: 600, color: '#1e293b' },
  chartCard: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px #0001' },
  table: { background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px #0001' },
  tableHeader: {
    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
    padding: '10px 16px', background: '#f1f5f9',
    fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
  },
  tableRow: {
    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
    padding: '12px 16px', borderTop: '1px solid #e2e8f0',
    fontSize: 14, color: '#1e293b', alignItems: 'center',
  },
  btnPrimary: {
    background: '#6366f1', color: '#fff', border: 'none',
    padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  btnSecondary: {
    background: '#f1f5f9', color: '#1e293b', border: '1px solid #e2e8f0',
    padding: '9px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
  },
  btnEdit: {
    background: 'none', color: '#6366f1', border: '1px solid #6366f1',
    padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  },
  formCard: {
    background: '#fff', borderRadius: 12, padding: 24,
    boxShadow: '0 1px 3px #0001', border: '1px solid #e2e8f0',
  },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  formLabel: { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 13, fontWeight: 600, color: '#475569' },
  formInput: {
    marginTop: 2, padding: '8px 10px', borderRadius: 6,
    border: '1px solid #e2e8f0', fontSize: 14, color: '#1e293b',
    fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const,
  },
};
