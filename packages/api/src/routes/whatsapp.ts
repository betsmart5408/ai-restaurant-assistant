/**
 * Webhook WhatsApp (Twilio) — assistente commerciale.
 *
 * Il ristoratore tocca "Attiva questo menu" nella demo: WhatsApp si apre con un
 * messaggio precompilato che contiene "[demo:<slug>]". Lui preme solo invio.
 * Da lì il bot guida tutto con un menu a numeri: attiva, prezzo, come funziona,
 * parla con una persona. Il numero della demo resta in memoria (whatsapp_leads),
 * quindi quando risponde "1" gli mandiamo subito il link giusto.
 *
 * Su Twilio: numero WhatsApp → "When a message comes in" →
 *   POST https://<api>/api/whatsapp/inbound
 */
import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import twilio from 'twilio';
import { db } from '../db/client';

const router = Router();

const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://app.lingofork.com').replace(/\/+$/, '');
const PREZZO_MESE = process.env.SALES_PRICE || 'A$30/mese';
const GIORNI_PROVA = Number(process.env.SALES_TRIAL_DAYS) || 7;

function twiml(testo: string): string {
  const safe = testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

function firmaValida(req: Request): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) { console.warn('[whatsapp] TWILIO_AUTH_TOKEN assente: firma non verificata'); return true; }
  const sig = req.header('X-Twilio-Signature') || '';
  // Dietro il proxy di Railway l'host/schema visti da Express possono non
  // combaciare con l'URL che Twilio ha firmato: proviamo piu' varianti.
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const senzaQuery = req.originalUrl.split('?')[0];
  const candidati = [
    `https://${host}${req.originalUrl}`,
    `https://${host}${senzaQuery}`,
  ];
  const ok = candidati.some((u) => {
    try { return twilio.validateRequest(token, sig, u, req.body || {}); } catch { return false; }
  });
  if (ok) return true;
  // Sandbox: se la firma non torna, logghiamo e proseguiamo lo stesso, cosi'
  // il bot risponde. Per il numero di produzione: TWILIO_VALIDATE_STRICT=1.
  console.warn('[whatsapp] firma Twilio non valida (', candidati[0], ') - proseguo. Per bloccare: TWILIO_VALIDATE_STRICT=1');
  return process.env.TWILIO_VALIDATE_STRICT !== '1';
}

// Il messaggio precompilato dal tasto della demo finisce con "#<slug>".
// Le versioni vecchie usavano "[demo:<slug>]": lo accettiamo ancora.
const RE_MARKER = /\[demo:([a-z0-9][a-z0-9-]{1,60})\]|(?:^|\s)#([a-z0-9][a-z0-9-]{1,60})\b/i;

function trovaSlug(testo: string): string | null {
  const marker = testo.match(RE_MARKER);
  if (marker) return (marker[1] || marker[2]).toLowerCase();
  const paren = testo.match(/\(([a-z0-9][a-z0-9-]{1,60})\)/i);
  if (paren) return paren[1].toLowerCase();
  const url = testo.match(/[?&]restaurant=([a-z0-9][a-z0-9-]{1,60})/i) || testo.match(/attiva=([a-z0-9][a-z0-9-]{1,60})/i);
  if (url) return url[1].toLowerCase();
  return null;
}

// Che cosa vuole il ristoratore: numero del menu o parole chiave.
function intento(testo: string): 'attiva' | 'prezzo' | 'come' | 'persona' | 'menu' {
  const t = testo.toLowerCase().trim();
  if (/^1\b/.test(t) || /\battiv/i.test(t) || /\bprova\b/.test(t)) return 'attiva';
  if (/^2\b/.test(t) || /prezz|cost|quant|paga|abbon|tarif|mensil/i.test(t)) return 'prezzo';
  if (/^3\b/.test(t) || /come funzion|come va|cos.?è|cosa fa|a cosa serve|spieg|info/i.test(t)) return 'come';
  if (/^4\b/.test(t) || /person|operator|umano|chiama|parlare|telefon/i.test(t)) return 'persona';
  return 'menu';
}

async function datiRistorante(slug: string) {
  const r = await db.query(
    'SELECT id, name, is_demo, demo_claim_token FROM restaurants WHERE slug = $1',
    [slug]
  );
  return r.rows[0] || null;
}

async function linkAttivazione(row: { id: string; demo_claim_token: string | null }, slug: string): Promise<string> {
  let token = row.demo_claim_token;
  if (!token) {
    token = randomBytes(18).toString('base64url');
    await db.query('UPDATE restaurants SET demo_claim_token = $1 WHERE id = $2', [token, row.id]);
  }
  return `${DASHBOARD_URL}/attiva?attiva=${encodeURIComponent(slug)}&token=${token}`;
}

function menu(nome: string): string {
  return (
    `Ciao! 👋 Sono l'assistente${nome ? ` di ${nome}` : ''}.\n` +
    `Rispondi con un numero:\n\n` +
    `1️⃣  Attiva la demo — ${GIORNI_PROVA} giorni gratis\n` +
    `2️⃣  Quanto costa\n` +
    `3️⃣  Come funziona\n` +
    `4️⃣  Parla con una persona`
  );
}

const TESTO_PREZZO =
  `${PREZZO_MESE}, tutto incluso.\n` +
  `• ${GIORNI_PROVA} giorni di prova gratis, senza carta\n` +
  `• Nessun vincolo: disdici quando vuoi\n\n` +
  `Scrivi 1 per attivare, oppure 3 per sapere come funziona.`;

const TESTO_COME =
  `Come funziona 👇\n` +
  `• I clienti inquadrano un QR al tavolo e vedono il menu nella loro lingua (10 lingue)\n` +
  `• Un assistente AI consiglia piatti, spiega ingredienti, suggerisce vini\n` +
  `• Tu gestisci tutto da un pannello: piatti, prezzi, foto — le traduzioni si aggiornano da sole\n` +
  `• Il menu che hai visto è già il tuo, con i tuoi piatti e i tuoi colori\n\n` +
  `Scrivi 1 per attivarlo (${GIORNI_PROVA} giorni gratis).`;

const TESTO_PERSONA =
  `Perfetto 👍 Una persona ti risponde a breve qui su WhatsApp.\n` +
  `Nel frattempo, se vuoi già provare: scrivi 1 e ti mando il link.`;

router.post('/inbound', async (req: Request, res: Response) => {
  try {
    if (!firmaValida(req)) { res.status(403).type('text/xml').send(twiml('Richiesta non valida.')); return; }

    const phone = String(req.body?.From ?? '').replace(/^whatsapp:/i, '').trim();
    const nomeProfilo = String(req.body?.ProfileName ?? '').trim();
    const testo = String(req.body?.Body ?? '').trim();

    // 1. slug dal messaggio, se c'è, e memoria per numero
    const slugMsg = trovaSlug(testo);
    let lead: { slug: string | null; name: string | null } | null = null;
    if (phone) {
      const r = await db.query('SELECT slug, name FROM whatsapp_leads WHERE phone = $1', [phone]);
      lead = r.rows[0] || null;
      await db.query(
        `INSERT INTO whatsapp_leads (phone, slug, name, last_msg_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (phone) DO UPDATE SET
           slug = COALESCE($2, whatsapp_leads.slug),
           name = COALESCE(NULLIF($3, ''), whatsapp_leads.name),
           last_msg_at = NOW()`,
        [phone, slugMsg, nomeProfilo]
      );
    }
    const slug = slugMsg || lead?.slug || null;
    const rest = slug ? await datiRistorante(slug) : null;
    const nome = rest?.name || lead?.name || '';

    // 2. cosa vuole. Il messaggio del tasto ("[demo:...]") è il primo contatto:
    // lì mostriamo sempre il menu, senza indovinare dall'eventuale "info".
    const primoContatto = RE_MARKER.test(testo);
    const vuole = primoContatto ? 'menu' : intento(testo);
    let risposta: string;
    let stato = 'menu';

    if (!rest && vuole !== 'menu') {
      risposta = `Per aiutarti mi serve sapere quale demo hai visto.\nRimandami il link della demo (o tocca di nuovo il tasto "Attiva questo menu" nella pagina).`;
    } else if (vuole === 'attiva') {
      if (!rest) {
        risposta = `Mandami prima il link della demo che hai visto e ti attivo l'accesso.`;
      } else if (!rest.is_demo) {
        risposta = `${nome} è già attivo ✅\nAccedi qui: ${DASHBOARD_URL}/\nSe hai perso la password scrivimi.`;
        stato = 'attivato';
      } else {
        const link = await linkAttivazione(rest, slug!);
        risposta =
          `Ecco il link per attivare ${nome} — ${GIORNI_PROVA} giorni gratis, senza carta:\n\n${link}\n\n` +
          `Apri il link, scegli email e password, e sei dentro. Il menu è già caricato e tradotto.`;
        stato = 'link_inviato';
      }
    } else if (vuole === 'prezzo') {
      risposta = TESTO_PREZZO;
    } else if (vuole === 'come') {
      risposta = TESTO_COME;
    } else if (vuole === 'persona') {
      risposta = TESTO_PERSONA;
      stato = 'umano';
    } else {
      risposta = menu(nome);
    }

    if (phone) {
      await db.query('UPDATE whatsapp_leads SET stato = $1 WHERE phone = $2', [stato, phone]);
    }

    res.type('text/xml').send(twiml(risposta));
  } catch (err) {
    console.error('whatsapp inbound error:', err);
    res.type('text/xml').send(twiml('Ricevuto! Ti risponde a breve una persona.'));
  }
});

export default router;
