import type { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend the Express Request type so req.requestId is available throughout
// the application without casting.
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Attaches a request ID to every incoming request.
 * Uses the X-Request-ID header value when present; otherwise generates a UUID v4.
 * Echoes the final value back in the X-Request-ID response header.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const id = (req.headers['x-request-id'] as string | undefined) || uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};
