import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/client';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

export interface AuthPayload {
  userId: string;
  restaurantId: string;
  role: 'owner' | 'staff' | 'superadmin';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    req.auth = jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin only' });
  }
  next();
}

// Middleware che verifica che il restaurantId nei params sia quello del token
export function requireOwnRestaurant(req: Request, res: Response, next: NextFunction) {
  const rid = req.params.restaurantId ?? req.params.restaurantSlug;
  if (req.auth?.role === 'superadmin') return next();
  if (rid && rid !== req.auth?.restaurantId) {
    return res.status(403).json({ error: 'Access denied to this restaurant' });
  }
  next();
}

// Come requireOwnRestaurant ma per le rotte che usano lo "slug" del ristorante
// nell'indirizzo: risolve lo slug nell'id e lo confronta con quello del token.
export function requireOwnSlug(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role === 'superadmin') { next(); return; }
  const slug = req.params.restaurantSlug;
  if (!slug) { res.status(400).json({ error: 'Ristorante non indicato' }); return; }
  db.query('SELECT id FROM restaurants WHERE slug = $1', [slug])
    .then((r) => {
      if (r.rows.length === 0) { res.status(404).json({ error: 'Restaurant not found' }); return; }
      if (r.rows[0].id !== req.auth?.restaurantId) {
        res.status(403).json({ error: 'Access denied to this restaurant' });
        return;
      }
      next();
    })
    .catch(() => { res.status(500).json({ error: 'Internal server error' }); });
}
