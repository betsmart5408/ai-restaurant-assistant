/**
 * L'endpoint che Make.com (o chiunque altro) chiama per farsi scrivere la
 * risposta a una recensione Google.
 *
 *   POST /api/recensioni/rispondi
 *   X-Api-Key: <RECENSIONI_API_KEY>
 *   { "slug": "al-aseel", "stelle": 2, "testo": "...", "autore": "Marco" }
 *
 *   -> { "risposta": "...", "pubblicabile": false, "motivo": "..." }
 *
 * "pubblicabile" e' il campo che conta: su Make ci si mette un filtro. Se e'
 * true la risposta va su Google da sola; se e' false parte un messaggio
 * WhatsApp al ristoratore, che approva o corregge.
 *
 * La chiave serve perche' questo endpoint spende soldi di IA a ogni chiamata:
 * senza, chiunque conosca l'indirizzo puo' prosciugare la quota.
 */
import { Router, Request, Response } from 'express';
import { generaRispostaRecensione, STELLE_SICURE } from '../services/recensioni';

const router = Router();

function chiaveValida(req: Request): boolean {
  const attesa = (process.env.RECENSIONI_API_KEY || '').trim();
  if (!attesa) return false;   // finche' non e' configurata, l'endpoint e' chiuso
  const data = String(req.header('x-api-key') || '').trim();
  return data.length > 0 && data === attesa;
}

router.post('/rispondi', async (req: Request, res: Response) => {
  try {
    if (!chiaveValida(req)) {
      res.status(401).json({ error: 'Chiave mancante o errata' });
      return;
    }

    const slug = String(req.body?.slug || '').trim();
    const testo = String(req.body?.testo || '').trim();
    const stelle = Number(req.body?.stelle);
    const autore = req.body?.autore ? String(req.body.autore) : undefined;

    if (!slug || !testo) {
      res.status(400).json({ error: 'Servono "slug" e "testo"' });
      return;
    }
    if (!Number.isFinite(stelle) || stelle < 1 || stelle > 5) {
      res.status(400).json({ error: '"stelle" deve essere un numero da 1 a 5' });
      return;
    }

    const esito = await generaRispostaRecensione({ slug, testo, stelle, autore });
    if (!esito) {
      res.status(503).json({ error: 'Non sono riuscito a scrivere la risposta. Riprova.' });
      return;
    }

    res.json(esito);
  } catch (err) {
    console.error('recensioni/rispondi:', err);
    res.status(500).json({ error: 'Errore nel generare la risposta' });
  }
});

/** Per controllare da Make che l'endpoint sia vivo e con che soglia lavora. */
router.get('/stato', (req: Request, res: Response) => {
  res.json({
    attivo: !!(process.env.RECENSIONI_API_KEY || '').trim(),
    stelle_pubblicazione_automatica: STELLE_SICURE,
  });
});

export default router;
