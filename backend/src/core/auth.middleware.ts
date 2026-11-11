import { Request, Response, NextFunction } from 'express';
import { JwtService } from './jwt.js';

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Enforces authentication. Requests must present a valid Bearer JWT.
 * Rejects unauthenticated requests with HTTP 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Please provide a valid Bearer token.',
    });
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = JwtService.verify(token);
    req.user = {
      id: payload.userId,
      email: payload.email,
    };
    next();
  } catch (err: any) {
    return res.status(401).json({
      error: `Invalid or expired session: ${err.message}`,
    });
  }
}

/**
 * Optional authentication: attaches user if a valid token is present,
 * but allows unauthenticated requests to proceed.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const payload = JwtService.verify(token);
      req.user = {
        id: payload.userId,
        email: payload.email,
      };
    } catch {
      // Ignore invalid token on optional auth
    }
  }
  next();
}

