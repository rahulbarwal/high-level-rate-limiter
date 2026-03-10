import type { RequestHandler } from 'express';

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
 *
 * Behaviour (to be implemented):
 *   - If the X-Request-ID header is present, use its value.
 *   - Otherwise, generate a UUID v4.
 *   - Store the value on req.requestId.
 *   - Echo the value back in the X-Request-ID response header.
 *
 * Stub: calls next() without setting req.requestId or the response header.
 */
export const requestIdMiddleware: RequestHandler = (_req, _res, next) => {
  next();
};
