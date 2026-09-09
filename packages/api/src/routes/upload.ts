/**
 * Caricamento del logo del ristorante.
 *
 * Il file NON viene scritto su disco: online il disco del server e' di sola
 * lettura e sparisce a ogni richiesta. Il logo va nel database e viene servito
 * da un indirizzo dedicato, con cache del browser.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

const TIPI_AMMESSI = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },   // 2 MB: un logo non pesa di piu'
  fileFilter: (_req, file, cb) => {
    if (TIPI_AMMESSI.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo immagini JPG, PNG, WebP o SVG'));
  },
});

// POST /api/upload/logo
router.post('/logo', requireAuth, (req: Request, res: Response) => {
  upload.single('logo')(req, res, async (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : 'Caricamento non riuscito';
      return res.status(400).json({ error: msg.includes('File too large') ? 'Immagine troppo grande (massimo 2 MB)' : msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

    try {
      const restaurantId = req.auth!.restaurantId;
      await db.query(
        `INSERT INTO restaurant_logos (restaurant_id, mime, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (restaurant_id) DO UPDATE
           SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = NOW()`,
        [restaurantId, req.file.mimetype, req.file.buffer]
      );

      // La versione nell'indirizzo costringe il browser a ricaricare il logo nuovo
      const logoUrl = `/api/upload/logo/${restaurantId}?v=${Date.now()}`;
      await db.query('UPDATE restaurants SET logo_url = $1 WHERE id = $2', [logoUrl, restaurantId]);

      res.json({ logo_url: logoUrl });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Salvataggio del logo non riuscito' });
    }
  });
});

// GET /api/upload/logo/:restaurantId — serve il logo (pubblico)
router.get('/logo/:restaurantId', async (req: Request, res: Response) => {
  try {
    const r = await db.query(
      'SELECT mime, data FROM restaurant_logos WHERE restaurant_id = $1',
      [req.params.restaurantId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Logo non impostato' });

    res.setHeader('Content-Type', r.rows[0].mime);
    // un'ora nel browser, un giorno nella cache di rete: l'indirizzo cambia
    // a ogni nuovo caricamento, quindi non si rischia di vedere il vecchio
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.send(r.rows[0].data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Lettura del logo non riuscita' });
  }
});

// DELETE /api/upload/logo — torna al logo predefinito
router.delete('/logo', requireAuth, async (req: Request, res: Response) => {
  try {
    await db.query('DELETE FROM restaurant_logos WHERE restaurant_id = $1', [req.auth!.restaurantId]);
    await db.query('UPDATE restaurants SET logo_url = NULL WHERE id = $1', [req.auth!.restaurantId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Rimozione non riuscita' });
  }
});

export default router;
