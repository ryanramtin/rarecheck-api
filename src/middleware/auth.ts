import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JWTPayload {
  userId: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET!;

// Strict auth — rejects unauthenticated requests
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth — attaches userId if present but doesn't block
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
      req.userId = payload.userId;
    } catch {
      // Ignore invalid tokens in optional mode
    }
  }
  next();
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}
