import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const RESTAURANT_ID = import.meta.env.VITE_RESTAURANT_ID ?? '11111111-1111-1111-1111-111111111111';

type Tab = 'today' | 'weekly' | 'inventory' | 'margins' | 'forecast';

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

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [today, setToday] = useState<{ today: TodayData; last_week_avg_order: number; active_orders: number; top_dishes: TopDish[]; stock_alerts: { critical: string; warning: string } } | null>(null);
  const [weekly, setWeekly] = useState<WeekDay[]>([]);
  const [inventory, setInventory] = useState<StockAlert[]>([]);
  const [margins, setMargins] = useState<MarginDish[]>([]);
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [portions, setPortions] = useState<PortionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTab(tab);
  }, [tab]);

  async function loadTab(t: Tab) {
    setLoading(true);
    try {
      if (t === 'today') {
        const res = await fetch(`${API}/api/dashboard/${RESTAURANT_ID}/today`);
        setToday(await res.json());
      } else if (t === 'weekly') {
        const res = await fetch(`${API}/api/dashboard/${RESTAURANT_ID}/weekly`);
        setWeekly(await res.json());
      } else if (t === 'inventory') {
        const res = await fetch(`${API}/api/inventory/${RESTAURANT_ID}/alerts`);
        setInventory(await res.json());
      } else if (t === 'margins') {
        const res = await fetch(`${API}/api/dashboard/${RESTAURANT_ID}/margins`);
        setMargins(await res.json());
      } else if (t === 'forecast') {
        const [f, p] = await Promise.all([
          fetch(`${API}/api/forecast/${RESTAURANT_ID}`).then(r => r.json()),
          fetch(`${API}/api/forecast/${RESTAURANT_ID}/portions`).then(r => r.json()),
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
        <nav style={S.nav}>
          {([
            ['today', '📊 Oggi'],
            ['weekly', '📈 Settimana'],
            ['inventory', '🥩 Magazzino'],
            ['margins', '💰 Margini'],
          ['forecast', '🔮 Forecast'],
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
                href={`${API}/api/forecast/${RESTAURANT_ID}/report`}
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
};
