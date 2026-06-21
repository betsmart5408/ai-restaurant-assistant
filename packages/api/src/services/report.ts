import PDFDocument from 'pdfkit';
import { db } from '../db/client';
import { getForecast } from './forecast';

interface WeeklyStats {
  date: string;
  revenue: number;
  orders: number;
  avg_order: number;
}

interface DishMargin {
  name: string;
  category: string;
  price: number;
  cost: number;
  margin_pct: number;
  sold_last_7d: number;
  profit_last_7d: number;
}

async function getWeeklyData(restaurantId: string) {
  const weekly = await db.query<WeeklyStats>(
    `SELECT DATE(created_at) as date,
            COALESCE(SUM(total), 0)::float as revenue,
            COUNT(*)::int as orders,
            COALESCE(AVG(total), 0)::float as avg_order
     FROM orders
     WHERE restaurant_id = $1
       AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       AND status != 'PENDING'
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [restaurantId]
  );

  const topDishes = await db.query<DishMargin>(
    `SELECT d.name, d.category, d.price::float, d.cost::float,
            CASE WHEN d.price > 0 THEN ROUND((1 - d.cost/d.price) * 100, 1) ELSE 0 END::float as margin_pct,
            COALESCE(SUM(oi.qty), 0)::int as sold_last_7d,
            COALESCE(SUM(oi.qty * (oi.unit_price - d.cost)), 0)::float as profit_last_7d
     FROM dishes d
     LEFT JOIN order_items oi ON oi.dish_id = d.id
     LEFT JOIN orders o ON o.id = oi.order_id
       AND o.created_at >= CURRENT_DATE - INTERVAL '7 days'
       AND o.status != 'PENDING'
     WHERE d.restaurant_id = $1
     GROUP BY d.id
     ORDER BY profit_last_7d DESC`,
    [restaurantId]
  );

  const totals = weekly.rows.reduce(
    (acc, d) => ({ revenue: acc.revenue + d.revenue, orders: acc.orders + d.orders }),
    { revenue: 0, orders: 0 }
  );

  const avgOrder = totals.orders > 0 ? totals.revenue / totals.orders : 0;

  return { weekly: weekly.rows, topDishes: topDishes.rows, totals, avgOrder };
}

function drawLine(doc: PDFKit.PDFDocument, y: number, color = '#e2e8f0') {
  doc.moveTo(40, y).lineTo(555, y).strokeColor(color).lineWidth(0.5).stroke();
}

function euro(n: number) {
  return `€${n.toFixed(2)}`;
}

function riskEmoji(level: string) {
  return level === 'critical' ? '🔴' : level === 'order_soon' ? '🟠' : level === 'watch' ? '🟡' : '🟢';
}

export async function generateWeeklyReport(restaurantId: string): Promise<Buffer> {
  const restaurant = await db.query(
    'SELECT name, whatsapp FROM restaurants WHERE id = $1',
    [restaurantId]
  );
  const restaurantName = restaurant.rows[0]?.name ?? 'Ristorante';

  const { weekly, topDishes, totals, avgOrder } = await getWeeklyData(restaurantId);
  const forecast = await getForecast(restaurantId);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const dateStr = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const weekStart = new Date(Date.now() - 7 * 86400000).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  const weekEnd = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });

  // ── HEADER ────────────────────────────────────────────────
  doc.rect(0, 0, 595, 90).fill('#1e293b');
  doc.fontSize(22).fillColor('white').font('Helvetica-Bold')
    .text('🍽️  AI Restaurant Assistant', 40, 22);
  doc.fontSize(12).font('Helvetica').fillColor('#94a3b8')
    .text(`Report settimanale — ${restaurantName}`, 40, 52);
  doc.text(`${weekStart} – ${weekEnd} · Generato il ${dateStr}`, 40, 68);

  let y = 110;

  // ── KPI BOXES ─────────────────────────────────────────────
  const kpis = [
    { label: 'Ricavo totale', value: euro(totals.revenue), color: '#6366f1' },
    { label: 'Ordini', value: String(totals.orders), color: '#0ea5e9' },
    { label: 'Scontrino medio', value: euro(avgOrder), color: '#22c55e' },
    { label: 'Giorni attivi', value: String(weekly.length), color: '#f59e0b' },
  ];

  const boxW = 120, boxH = 60, gap = 10;
  kpis.forEach((kpi, i) => {
    const x = 40 + i * (boxW + gap);
    doc.rect(x, y, boxW, boxH).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.rect(x, y, 4, boxH).fill(kpi.color);
    doc.fontSize(9).fillColor('#64748b').font('Helvetica').text(kpi.label, x + 10, y + 10);
    doc.fontSize(18).fillColor(kpi.color).font('Helvetica-Bold').text(kpi.value, x + 10, y + 26);
  });

  y += boxH + 24;

  // ── ANDAMENTO GIORNALIERO ──────────────────────────────────
  doc.fontSize(13).fillColor('#1e293b').font('Helvetica-Bold').text('Andamento settimanale', 40, y);
  y += 18;
  drawLine(doc, y);
  y += 8;

  // Intestazione tabella
  doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold');
  doc.text('DATA', 40, y);
  doc.text('ORDINI', 160, y);
  doc.text('RICAVO', 260, y);
  doc.text('SCONTRINO MEDIO', 360, y);
  y += 14;
  drawLine(doc, y, '#cbd5e1');
  y += 6;

  if (weekly.length === 0) {
    doc.fontSize(10).fillColor('#94a3b8').font('Helvetica').text('Nessun dato disponibile per questa settimana', 40, y);
    y += 20;
  } else {
    for (const day of weekly) {
      const dateLabel = new Date(day.date).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
      doc.fontSize(10).fillColor('#1e293b').font('Helvetica');
      doc.text(dateLabel, 40, y);
      doc.text(String(day.orders), 160, y);
      doc.text(euro(day.revenue), 260, y);
      doc.text(euro(day.avg_order), 360, y);
      y += 18;
    }
  }

  y += 12;

  // ── TOP PIATTI PER MARGINE ────────────────────────────────
  doc.fontSize(13).fillColor('#1e293b').font('Helvetica-Bold').text('Analisi margini per piatto', 40, y);
  y += 18;
  drawLine(doc, y);
  y += 8;

  doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold');
  doc.text('PIATTO', 40, y);
  doc.text('PREZZO', 200, y);
  doc.text('MARGINE %', 270, y);
  doc.text('VENDITE (7gg)', 350, y);
  doc.text('PROFITTO', 450, y);
  y += 14;
  drawLine(doc, y, '#cbd5e1');
  y += 6;

  for (const dish of topDishes) {
    const color = dish.margin_pct >= 65 ? '#22c55e' : dish.margin_pct >= 45 ? '#f59e0b' : '#ef4444';
    doc.fontSize(10).fillColor('#1e293b').font('Helvetica').text(dish.name, 40, y, { width: 155 });
    doc.text(euro(dish.price), 200, y);
    doc.fillColor(color).font('Helvetica-Bold').text(`${dish.margin_pct}%`, 270, y);
    doc.fillColor('#1e293b').font('Helvetica').text(String(dish.sold_last_7d), 350, y);
    doc.text(euro(dish.profit_last_7d), 450, y);
    y += 18;
    if (y > 680) { doc.addPage(); y = 40; }
  }

  y += 12;
  if (y > 620) { doc.addPage(); y = 40; }

  // ── FORECAST MAGAZZINO ────────────────────────────────────
  doc.fontSize(13).fillColor('#1e293b').font('Helvetica-Bold').text('Previsione scorte (prossimi 7 giorni)', 40, y);
  y += 18;
  drawLine(doc, y);
  y += 8;

  doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold');
  doc.text('INGREDIENTE', 40, y);
  doc.text('SCORTA', 190, y);
  doc.text('CONS./GIORNO', 265, y);
  doc.text('GIORNI RIMASTI', 355, y);
  doc.text('RIORDINO', 455, y);
  y += 14;
  drawLine(doc, y, '#cbd5e1');
  y += 6;

  for (const ing of forecast) {
    const emoji = riskEmoji(ing.risk_level);
    const daysText = ing.days_until_empty !== null ? `${ing.days_until_empty}gg` : '—';
    const reorderText = ing.suggested_reorder_qty > 0 ? `${ing.suggested_reorder_qty}${ing.unit}` : '—';
    const consumText = ing.avg_daily_consumption > 0 ? `${ing.avg_daily_consumption}${ing.unit}` : '—';

    doc.fontSize(10).fillColor('#1e293b').font('Helvetica')
      .text(`${emoji} ${ing.name}`, 40, y, { width: 145 });
    doc.text(`${ing.current_qty}${ing.unit}`, 190, y);
    doc.text(consumText, 265, y);

    const riskColor = ing.risk_level === 'critical' ? '#ef4444'
      : ing.risk_level === 'order_soon' ? '#f97316'
      : ing.risk_level === 'watch' ? '#f59e0b'
      : '#22c55e';
    doc.fillColor(riskColor).font('Helvetica-Bold').text(daysText, 355, y);
    doc.fillColor('#6366f1').font('Helvetica').text(reorderText, 455, y);

    y += 18;
    if (y > 750) { doc.addPage(); y = 40; }
  }

  // ── FOOTER ────────────────────────────────────────────────
  y = Math.max(y + 20, 760);
  if (y > 780) { doc.addPage(); y = 730; }
  drawLine(doc, y - 10);
  doc.fontSize(8).fillColor('#94a3b8').font('Helvetica')
    .text('Generato da AI Restaurant Assistant · report automatico settimanale', 40, y, { align: 'center', width: 515 });

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
