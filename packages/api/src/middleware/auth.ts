import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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
