/**
 * Webhook WhatsApp (Twilio). Quando un ristoratore scrive al numero
 * commerciale — di solito dal tasto "Attiva questo menu" nella demo, che
 * precompila "... (slug) ..." — rispondiamo in automatico con il link di
 * attivazione e due righe su costo e prova.
 *
 * Su Twilio: numero WhatsApp → "When a message comes in" →
 *   POST https://<api>/api/whatsapp/inbound
 */
import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import twilio from 'twilio';
import { db } from '../db/client';

const router = Router();

const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://restaurant-dashboard-two-hazel.vercel.app').replace(/\/+$/, '');
const PREZZO_MESE = process.env.SALES_PRICE || '€49/mese';

function twiml(testo: string): string {
  const safe = testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

// Firma Twilio: se abbiamo l'auth token la verifichiamo, altrimenti (sandbox
// / test) lasciamo passare ma lo segnaliamo nei log.
function firmaValida(req: Request): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) { console.warn('[whatsapp] TWILIO_AUTH_TOKEN assente: firma non verificata'); return true; }
  try {
    const sig = req.header('X-Twilio-Signature') || '';
    const url = `https://${req.headers.host}${req.originalUrl}`;
    return twilio.validateRequest(token, sig, url, req.body || {});
  } catch {
    return false;
  }
}

async function linkAttivazione(slug: string): Promise<{ nome: string; link: string; giaAttiva: boolean } | null> {
  const r = await db.query(
    'SELECT id, name, is_demo, demo_claim_token FROM restaurants WHERE slug = $1',
    [slug]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (!row.is_demo) return { nome: row.name, link: `${DASHBOARD_URL}/`, giaAttiva: true };
  let token = row.demo_claim_token;
  if (!token) {
    token = randomBytes(18).toString('base64url');
    await db.query('UPDATE restaurants SET demo_claim_token = $1 WHERE id = $2', [token, row.id]);
  }
  return {
    nome: row.name,
    link: `${DASHBOARD_URL}/attiva?attiva=${encodeURIComponent(slug)}&token=${token}`,
    giaAttiva: false,
  };
}

function trovaSlug(testo: string): string | null {
  // Il tasto demo precompila "... (slug) ..."; altrimenti proviamo un
  // /attiva?attiva=slug incollato, o l'ultimo token che sembra uno slug.
  const paren = testo.match(/\(([a-z0-9][a-z0-9-]{1,60})\)/i);
  if (paren) return paren[1].toLowerCase();
  const url = testo.match(/[?&]restaurant=([a-z0-9][a-z0-9-]{1,60})/i) || testo.match(/attiva=([a-z0-9][a-z0-9-]{1,60})/i);
  if (url) return url[1].toLowerCase();
  return null;
}

router.post('/inbound', async (req: Request, res: Response) => {
  try {
    if (!firmaValida(req)) { res.status(403).type('text/xml').send(twiml('Richiesta non valida.')); return; }

    const testo = String(req.body?.Body ?? '').trim();
    const slug = trovaSlug(testo);
    const prezzo = /prezz|cost|quanto|paga|abbon/i.test(testo);

    let risposta: string;

    if (slug) {
      const info = await linkAttivazione(slug);
      if (!info) {
        risposta = `Ciao! Non ho trovato quel menu. Rimandami il link della demo che hai visto e ti attivo l'accesso.`;
      } else if (info.giaAttiva) {
        risposta = `Il menu di ${info.nome} è già attivo ✅\nAccedi qui: ${info.link}\nSe hai perso la password scrivimi.`;
      } else {
        risposta =
          `Ciao! 👋 Sono l'assistente di ${info.nome}.\n\n` +
          `Il menu che hai visto è già pronto: tradotto in 10 lingue, con l'assistente AI che consiglia piatti ai tuoi clienti.\n\n` +
          `💶 ${PREZZO_MESE} · 14 giorni di prova gratis, senza carta.\n\n` +
          `Attivalo qui (scegli tu email e password):\n${info.link}\n\n` +
          `Scrivimi pure se hai domande.`;
      }
    } else if (prezzo) {
      risposta = `${PREZZO_MESE}, con 14 giorni di prova gratuiti e nessuna carta richiesta.\n\nMandami il link della demo che hai visto (o il nome del ristorante) e ti mando l'accesso.`;
    } else {
      risposta = `Ciao! 👋 Mandami il link della demo che hai ricevuto — oppure il nome del tuo ristorante — e ti mando subito l'accesso per attivarla.`;
    }

    res.type('text/xml').send(twiml(risposta));
  } catch (err) {
    console.error('whatsapp inbound error:', err);
    res.type('text/xml').send(twiml('Ricevuto! Ti risponde a breve una persona.'));
  }
});

export default router;
