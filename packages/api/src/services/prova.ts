/**
 * Fine della prova gratuita.
 *
 *  - 2 giorni prima della scadenza: promemoria
 *  - alla scadenza: "la prova e' finita", il menu funziona ancora per GIORNI_TOLLERANZA
 *  - dopo la tolleranza: il menu dei clienti va in pausa finche' non paga
 *
 * Ogni avviso parte una volta sola (tabella avvisi_prova), per email e su
 * WhatsApp. Il WhatsApp usa un modello approvato se c'e' (TWILIO_TPL_<TIPO>_<LINGUA>,
 * es. TWILIO_TPL_SCADUTA_EN): senza modello WhatsApp consegna solo a chi ci ha
 * scritto nelle ultime 24 ore.
 */
import { db } from '../db/client';
import { mandaEmail, emailConPulsante, escapeHtml } from './email';
import { sendWhatsApp, sendWhatsAppModello } from './whatsapp';

export const GIORNI_TOLLERANZA = Number(process.env.GIORNI_TOLLERANZA_PROVA) || 3;
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://app.lingofork.com').replace(/\/+$/, '');
const LINK_PAGA = `${DASHBOARD_URL}/?vai=abbonamento`;
const PREZZO = process.env.SALES_PRICE_EN || 'A$30/month';
const PREZZO_IT = process.env.SALES_PRICE || 'A$30/mese';

// Condizione SQL (alias r = restaurants) per "menu in pausa". Stessa regola
// ovunque: menu pubblico, chat e dashboard.
export const SQL_IN_PAUSA = `(r.is_demo IS NOT TRUE AND (
  r.subscription_status = 'cancelled'
  OR (r.subscription_status = 'trialing' AND r.trial_ends_at < NOW() - make_interval(days => ${GIORNI_TOLLERANZA}))
))`;

export async function menuInPausa(slug: string): Promise<boolean> {
  const r = await db.query(`SELECT ${SQL_IN_PAUSA} AS pausa FROM restaurants r WHERE r.slug = $1`, [slug]);
  return r.rows[0]?.pausa === true;
}

type Tipo = 'scade_presto' | 'scaduta' | 'in_pausa';
type Lingua = 'it' | 'en';

const TESTI: Record<Tipo, Record<Lingua, (nome: string, fine: string) => { oggetto: string; titolo: string; righe: string[]; pulsante: string; wa: string }>> = {
  scade_presto: {
    it: (nome, fine) => ({
      oggetto: `La prova di LingoFork finisce ${fine}`,
      titolo: 'La tua prova sta per finire',
      righe: [
        `La prova gratuita di <strong>${nome}</strong> finisce <strong>${fine}</strong>.`,
        `Per continuare a usare il menu tradotto e l'assistente attiva l'abbonamento: ${PREZZO_IT}, disdici quando vuoi.`,
      ],
      pulsante: "Attiva l'abbonamento",
      wa: `Ciao! La prova gratuita di *${nome}* su LingoFork finisce ${fine}. Per continuare attiva l'abbonamento (${PREZZO_IT}, disdici quando vuoi): ${LINK_PAGA}`,
    }),
    en: (nome, fine) => ({
      oggetto: `Your LingoFork trial ends ${fine}`,
      titolo: 'Your trial is ending soon',
      righe: [
        `The free trial for <strong>${nome}</strong> ends <strong>${fine}</strong>.`,
        `To keep your translated menu and assistant, start your subscription: ${PREZZO}, cancel anytime.`,
      ],
      pulsante: 'Start subscription',
      wa: `Hi! The free LingoFork trial for *${nome}* ends ${fine}. To keep it running, start your subscription (${PREZZO}, cancel anytime): ${LINK_PAGA}`,
    }),
  },
  scaduta: {
    it: (nome) => ({
      oggetto: 'La prova di LingoFork è finita',
      titolo: 'La prova gratuita è finita',
      righe: [
        `La prova di <strong>${nome}</strong> è terminata. Il menu resta online ancora per <strong>${GIORNI_TOLLERANZA} giorni</strong>, poi i clienti non potranno più aprirlo.`,
        `Attiva l'abbonamento per non interrompere il servizio: ${PREZZO_IT}.`,
      ],
      pulsante: "Attiva l'abbonamento",
      wa: `La prova di *${nome}* su LingoFork è finita. Il menu resta online ancora ${GIORNI_TOLLERANZA} giorni, poi va in pausa. Attiva l'abbonamento qui: ${LINK_PAGA}`,
    }),
    en: (nome) => ({
      oggetto: 'Your LingoFork trial has ended',
      titolo: 'Your free trial has ended',
      righe: [
        `The trial for <strong>${nome}</strong> has ended. Your menu stays online for another <strong>${GIORNI_TOLLERANZA} days</strong>, then guests won't be able to open it.`,
        `Start your subscription to keep it running: ${PREZZO}.`,
      ],
      pulsante: 'Start subscription',
      wa: `The LingoFork trial for *${nome}* has ended. Your menu stays online for ${GIORNI_TOLLERANZA} more days, then it will be paused. Start your subscription here: ${LINK_PAGA}`,
    }),
  },
  in_pausa: {
    it: (nome) => ({
      oggetto: 'Il menu di LingoFork è in pausa',
      titolo: 'Il tuo menu è in pausa',
      righe: [
        `I clienti di <strong>${nome}</strong> non vedono più il menu tradotto. Menu, traduzioni e QR code sono salvati: non perdi niente.`,
        `Attiva l'abbonamento e il menu torna online subito, con gli stessi QR code.`,
      ],
      pulsante: 'Riattiva il menu',
      wa: `Il menu di *${nome}* su LingoFork è in pausa: i clienti non lo vedono più. Non hai perso niente: attiva l'abbonamento e torna online subito, con gli stessi QR code. ${LINK_PAGA}`,
    }),
    en: (nome) => ({
      oggetto: 'Your LingoFork menu is paused',
      titolo: 'Your menu is paused',
      righe: [
        `Guests at <strong>${nome}</strong> can no longer see the translated menu. Your menu, translations and QR codes are all saved: nothing is lost.`,
        'Start your subscription and the menu is back online right away, with the same QR codes.',
      ],
      pulsante: 'Reactivate menu',
      wa: `The LingoFork menu for *${nome}* is paused: guests can't see it anymore. Nothing is lost: start your subscription and it's back online right away, with the same QR codes. ${LINK_PAGA}`,
    }),
  },
};

function dataFine(d: Date, lingua: Lingua): string {
  return d.toLocaleDateString(lingua === 'it' ? 'it-IT' : 'en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

interface Destinatario {
  id: string;
  name: string;
  trial_ends_at: Date;
  email: string | null;
  phone: string | null;
  lingua: string | null;
}

async function avvisa(r: Destinatario, tipo: Tipo): Promise<void> {
  // Prenota l'avviso: se un altro giro l'ha gia' preso, non si ripete
  const preso = await db.query(
    `INSERT INTO avvisi_prova (restaurant_id, tipo) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
    [r.id, tipo]
  );
  if (!preso.rowCount) return;

  const lingua: Lingua = r.lingua === 'it' ? 'it' : 'en';
  const fine = dataFine(new Date(r.trial_ends_at), lingua);
  const t = TESTI[tipo][lingua](escapeHtml(r.name), fine);   // per l'HTML dell'email
  const testoWa = TESTI[tipo][lingua](r.name, fine).wa;      // WhatsApp: testo semplice

  let emailOk = false;
  if (r.email) {
    emailOk = await mandaEmail({
      to: r.email,
      subject: t.oggetto,
      html: emailConPulsante({ titolo: t.titolo, paragrafi: t.righe, pulsante: t.pulsante, link: LINK_PAGA }),
      text: `${t.righe.join('\n\n').replace(/<[^>]+>/g, '')}\n\n${LINK_PAGA}`,
    });
  }

  let waOk = false;
  if (r.phone) {
    const modello = process.env[`TWILIO_TPL_${tipo.toUpperCase()}_${lingua.toUpperCase()}`];
    waOk = modello
      ? await sendWhatsAppModello(r.phone, modello, { '1': r.name, '2': LINK_PAGA })
      : await sendWhatsApp(r.phone, testoWa);
  }

  await db.query(
    `UPDATE avvisi_prova SET email = $3, whatsapp = $4 WHERE restaurant_id = $1 AND tipo = $2`,
    [r.id, tipo, emailOk, waOk]
  );
  console.log(`[prova] ${tipo} → ${r.name}: email ${emailOk ? 'ok' : 'no'}, whatsapp ${waOk ? 'ok' : 'no'}`);
}

export async function controllaProve(): Promise<void> {
  // Email: quella dell'utente (o di fatturazione). Telefono: quello del
  // ristorante o, se manca, l'ultimo numero che ci ha scritto su WhatsApp
  // per questa demo. Lingua: quella usata su WhatsApp, altrimenti inglese.
  const r = await db.query(`
    SELECT r.id, r.name, r.trial_ends_at,
           COALESCE((SELECT u.email FROM users u WHERE u.restaurant_id = r.id ORDER BY u.created_at LIMIT 1), r.billing_email) AS email,
           COALESCE(NULLIF(r.whatsapp, ''), wl.phone) AS phone,
           wl.lingua,
           CASE
             WHEN ${SQL_IN_PAUSA} THEN 'in_pausa'
             WHEN r.trial_ends_at <= NOW() THEN 'scaduta'
             ELSE 'scade_presto'
           END AS tipo
    FROM restaurants r
    LEFT JOIN LATERAL (
      SELECT phone, lingua FROM whatsapp_leads WHERE slug = r.slug ORDER BY last_msg_at DESC LIMIT 1
    ) wl ON TRUE
    WHERE r.is_demo IS NOT TRUE
      AND r.subscription_status = 'trialing'
      AND r.trial_ends_at IS NOT NULL
      AND r.trial_ends_at <= NOW() + INTERVAL '2 days'
  `);
  for (const riga of r.rows) {
    try { await avvisa(riga, riga.tipo as Tipo); }
    catch (err) { console.error(`[prova] avviso non riuscito per ${riga.name}:`, err); }
  }
}
