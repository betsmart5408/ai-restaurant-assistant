import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_FROM ?? '+14155238886'}`;

export async function sendWhatsApp(to: string, message: string): Promise<boolean> {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log('[WhatsApp MOCK]', to, '→', message);
    return true;
  }
  try {
    await client.messages.create({
      from: FROM,
      to: `whatsapp:${to}`,
      body: message,
    });
    return true;
  } catch (err) {
    console.error('WhatsApp send failed:', err);
    return false;
  }
}

// ── Messaggi predefiniti ─────────────────────────────────────

export function msgStockCritical(name: string, qty: number, unit: string, hoursLeft?: number) {
  const eta = hoursLeft ? ` Stima esaurimento: ~${hoursLeft}h.` : '';
  return `🔴 *STOCK CRITICO — Da Mario*\n\n*${name}* quasi esaurito!\nRimangono solo *${qty}${unit}*.${eta}\n\nRiordina subito o disattiva i piatti che lo usano.`;
}

export function msgStockWarning(name: string, qty: number, unit: string) {
  return `🟡 *Attenzione Magazzino — Da Mario*\n\n*${name}*: rimangono *${qty}${unit}* (sotto soglia minima).\n\nValuta di riordinare presto.`;
}

export function msgExpiryAlert(name: string, qty: number, unit: string, daysLeft: number) {
  return `⚠️ *Scadenza imminente — Da Mario*\n\n*${name}* scade tra *${daysLeft} giorno/i*.\nQuantità: ${qty}${unit}.\n\nSuggerimento: attiva una promozione sui piatti che lo usano per evitare sprechi.`;
}

export function msgDailySummary(data: {
  revenue: number;
  orders: number;
  avgOrder: number;
  avgOrderDelta: number;
  topDish: string;
  criticalIngredients: number;
}) {
  const trend = data.avgOrderDelta >= 0
    ? `📈 +€${data.avgOrderDelta.toFixed(2)} vs ieri`
    : `📉 -€${Math.abs(data.avgOrderDelta).toFixed(2)} vs ieri`;

  const alerts = data.criticalIngredients > 0
    ? `\n⚠️ ${data.criticalIngredients} ingrediente/i critico/i — controlla il magazzino!`
    : '\n✅ Magazzino OK';

  return `🍽️ *Riepilogo serale — Da Mario*\n\n💶 Ricavo: *€${data.revenue.toFixed(2)}*\n👥 Ordini: *${data.orders}*\n🧾 Scontrino medio: *€${data.avgOrder.toFixed(2)}* (${trend})\n🏆 Piatto top: *${data.topDish}*${alerts}`;
}
