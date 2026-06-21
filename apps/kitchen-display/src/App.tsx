import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const RESTAURANT_ID = import.meta.env.VITE_RESTAURANT_ID ?? '11111111-1111-1111-1111-111111111111';
const POLL_MS = 5000;

interface KitchenOrder {
  id: string;
  table_number: number;
  status: 'CONFIRMED' | 'IN_KITCHEN';
  created_at: string;
  language: string;
  items: Array<{ name: string; qty: number; note: string | null }>;
}

function elapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return mins < 1 ? '<1 min' : `${mins} min`;
}

function statusColor(status: string, mins: number) {
  if (status === 'IN_KITCHEN') return mins > 15 ? '#ef4444' : '#f59e0b';
  return '#3b82f6';
}

export default function App() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [now, setNow] = useState(Date.now());
  const [lastUpdate, setLastUpdate] = useState('');

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/orders/kitchen/${RESTAURANT_ID}`);
      const data = await res.json();
      setOrders(data);
      setLastUpdate(new Date().toLocaleTimeString('it-IT'));
    } catch {
      // polling — non interrompere se network error
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const poll = setInterval(fetchOrders, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [fetchOrders]);

  async function updateStatus(orderId: string, status: string) {
    await fetch(`${API}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    fetchOrders();
  }

  return (
    <div style={S.root}>
      <header style={S.header}>
        <span style={S.title}>🍳 Kitchen Display</span>
        <span style={S.subtitle}>{orders.length} ordini attivi</span>
        <span style={S.time}>Aggiornato: {lastUpdate}</span>
      </header>

      {orders.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 22, color: '#6b7280' }}>Nessun ordine in attesa</div>
        </div>
      ) : (
        <div style={S.grid}>
          {orders.map(order => {
            const mins = Math.floor((now - new Date(order.created_at).getTime()) / 60000);
            const color = statusColor(order.status, mins);
            return (
              <div key={order.id} style={{ ...S.card, borderTopColor: color }}>
                <div style={S.cardHeader}>
                  <span style={{ ...S.tableNum, color }}>Tavolo {order.table_number}</span>
                  <span style={{ ...S.badge, background: color + '22', color }}>
                    {elapsed(order.created_at)}
                  </span>
                </div>

                <div style={S.items}>
                  {order.items.map((item, i) => (
                    <div key={i} style={S.item}>
                      <span style={S.itemQty}>{item.qty}×</span>
                      <div>
                        <div style={S.itemName}>{item.name}</div>
                        {item.note && <div style={S.itemNote}>💬 {item.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={S.actions}>
                  {order.status === 'CONFIRMED' && (
                    <button style={{ ...S.btn, background: '#f59e0b' }}
                      onClick={() => updateStatus(order.id, 'IN_KITCHEN')}>
                      🔥 In preparazione
                    </button>
                  )}
                  {order.status === 'IN_KITCHEN' && (
                    <button style={{ ...S.btn, background: '#22c55e' }}
                      onClick={() => updateStatus(order.id, 'READY')}>
                      ✅ Pronto
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px',
    background: '#1f1f1f', borderBottom: '1px solid #333',
  },
  title: { fontSize: 22, fontWeight: 700, color: '#f0f0f0' },
  subtitle: { fontSize: 15, color: '#f59e0b', marginLeft: 8 },
  time: { marginLeft: 'auto', fontSize: 13, color: '#6b7280' },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 16, padding: 20,
  },
  card: {
    background: '#1f1f1f', borderRadius: 12,
    borderTop: '4px solid #3b82f6',
    padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  tableNum: { fontSize: 22, fontWeight: 700 },
  badge: {
    padding: '4px 10px', borderRadius: 20,
    fontSize: 13, fontWeight: 600,
  },
  items: { display: 'flex', flexDirection: 'column', gap: 8 },
  item: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  itemQty: { fontSize: 20, fontWeight: 700, color: '#f59e0b', minWidth: 32 },
  itemName: { fontSize: 16, fontWeight: 600, color: '#f0f0f0' },
  itemNote: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  actions: { marginTop: 4 },
  btn: {
    width: '100%', padding: '12px', borderRadius: 8,
    fontSize: 15, fontWeight: 700, color: '#111', border: 'none', cursor: 'pointer',
  },
};
