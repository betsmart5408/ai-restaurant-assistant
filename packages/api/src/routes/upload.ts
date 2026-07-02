import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'logos');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop() ?? 'png';
    cb(null, `${req.auth!.restaurantId}-${Date.now()}.${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo immagini JPG, PNG, WebP, SVG'));
  },
});

// POST /api/upload/logo
router.post('/logo', requireAuth, upload.single('logo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

  const publicUrl = `/uploads/logos/${req.file.filename}`;
  await db.query('UPDATE restaurants SET logo_url = $1 WHERE id = $2', [publicUrl, req.auth!.restaurantId]);
  res.json({ logo_url: publicUrl });
});

// GET /api/upload/logos/:filename — serve il file
router.get('/logos/:filename', (req: Request, res: Response) => {
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File non trovato' });
  res.sendFile(filePath);
});

export default router;
