/**
 * Assistente AI per il RISTORATORE (non per i suoi clienti): risponde a
 * "come faccio a...", spiega le sezioni del pannello, il prezzo, la prova
 * gratis. Vive nella dashboard, non nel menu pubblico.
 *
 * Usa la chiave Groq della PIATTAFORMA (non quella del ristorante, che serve
 * solo all'assistente rivolto ai clienti in menu.ts/ai-chat.ts), con
 * fallback su Claude se Groq non risponde — stessa logica robusta di
 * services/translate.ts.
 */
import { Router, Request, Response } from 'express';
import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth';
import { db } from '../db/client';
import { modelliDisponibili } from '../services/groq-model';

const router = Router();

const MODELLO_CLAUDE = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

function promptSistema(
  nome: string,
  piano: string,
  statoAbbonamento: string,
  giorniTrial: number | null,
): string {
  const rigaTrial = giorniTrial !== null ? `, ${giorniTrial} giorni di prova rimasti` : '';
  return `Sei l'assistente di supporto di LingoFork, dentro il pannello di gestione di "${nome}".
Aiuti il TITOLARE del ristorante a usare la piattaforma. Non sei l'assistente che parla con i clienti del ristorante (quello si chiama diversamente ed è nel menu pubblico).
Rispondi SEMPRE nella lingua in cui ti scrive il titolare. Messaggi brevi e concreti (max 6-8 righe), un passo alla volta, tono incoraggiante mai robotico.

COS'È LINGOFORK:
Menu digitale con QR al tavolo + assistente AI multilingua (10 lingue) per i clienti turisti che leggono il menu nella loro lingua.
Il ristoratore non riceve ordini dall'app: il cameriere prende l'ordine al tavolo come sempre.
Prezzo: A$30/mese tutto incluso, 7 giorni di prova gratis senza carta, nessun vincolo (si disdice quando si vuole dal pannello).
Stato di questo account: piano "${piano}", abbonamento "${statoAbbonamento}"${rigaTrial}.

SEZIONI DEL PANNELLO E COSA SI FA IN OGNUNA:
- Menu: aggiungere/modificare/nascondere piatti, categorie, prezzi, foto, allergeni. Le traduzioni nelle altre lingue si generano da sole quando si salva un piatto.
- Traduzioni: vedere e correggere a mano le traduzioni in ogni lingua. Una correzione fatta a mano non viene MAI sovrascritta da una traduzione automatica successiva.
- Aspetto: colore principale, colore di sfondo, carattere del menu, logo del locale.
- QR Code: scaricare il codice QR da stampare e mettere sui tavoli.
- Impostazioni IA: nome dell'assistente che parla con i clienti, chiave Groq personale (facoltativa, non obbligatoria).
- Abbonamento: stato prova/pagamento, prezzo, attivare l'abbonamento o gestire il metodo di pagamento.
- Impostazioni: nome del locale, città, tipo di cucina, descrizione, Instagram, lingue attive per i clienti.

REGOLE:
- Se non sei sicuro di una risposta, dillo onestamente e indica in quale sezione del pannello guardare.
- Non inventare funzioni o pulsanti che non esistono in questo elenco.
- Non dare consigli fiscali o legali: per quelli rimanda a un commercialista.
- Se chiedono di parlare con una persona vera, rispondi che puoi aiutare tu quasi sempre, e che per casi particolari possono scrivere al numero WhatsApp con cui hanno attivato l'account.`;
}

router.post('/chat', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.auth || req.auth.role === 'superadmin') {
      res.status(403).json({ error: 'Assistente disponibile solo per gli account ristorante' });
      return;
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) { res.status(400).json({ error: 'Messaggio mancante' }); return; }

    const r = await db.query(
      'SELECT name, plan, subscription_status, trial_ends_at FROM restaurants WHERE id = $1',
      [req.auth.restaurantId]
    );
    const rist = r.rows[0];
    if (!rist) { res.status(404).json({ error: 'Ristorante non trovato' }); return; }

    let giorniTrial: number | null = null;
    if (rist.trial_ends_at) {
      const ms = new Date(rist.trial_ends_at).getTime() - Date.now();
      giorniTrial = Math.max(0, Math.ceil(ms / 86_400_000));
    }
    const sistema = promptSistema(rist.name, rist.plan || 'trial', rist.subscription_status || 'trialing', giorniTrial);

    const storico: Array<{ role: 'user' | 'assistant'; content: string }> = Array.isArray(req.body?.history)
      ? req.body.history
          .filter((m: unknown): m is { role: string; content: string } =>
            !!m && typeof m === 'object' && typeof (m as any).content === 'string')
          .slice(-8)
          .map((m: { role: string; content: string }) => ({
            role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: m.content.slice(0, 2000),
          }))
      : [];
    const messaggi = [...storico, { role: 'user' as const, content: message.slice(0, 2000) }];

    let risposta = '';

    if (process.env.GROQ_API_KEY) {
      try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const modelli = await modelliDisponibili(groq, process.env.GROQ_API_KEY);
        for (const model of modelli) {
          try {
            const out = await groq.chat.completions.create({
              model,
              max_tokens: 500,
              temperature: 0.5,
              messages: [{ role: 'system', content: sistema }, ...messaggi],
            });
            const testo = out.choices[0]?.message?.content?.trim();
            if (testo) { risposta = testo; break; }
          } catch { /* prova il modello successivo */ }
        }
      } catch { /* passa al fallback Claude */ }
    }

    if (!risposta && process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const out = await anthropic.messages.create({
          model: MODELLO_CLAUDE,
          max_tokens: 500,
          system: sistema,
          messages: messaggi,
        });
        const blocco = out.content[0];
        if (blocco?.type === 'text') risposta = blocco.text.trim();
      } catch { /* nessun fallback disponibile */ }
    }

    if (!risposta) {
      res.status(503).json({ error: 'Assistente non disponibile al momento. Riprova tra poco.' });
      return;
    }

    res.json({ message: risposta });
  } catch (err) {
    console.error('assistente chat error:', err);
    res.status(500).json({ error: 'Errore assistente' });
  }
});

export default router;
