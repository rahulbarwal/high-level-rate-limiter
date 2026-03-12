import type { RequestHandler } from 'express';
import { logger } from '../logger';

/**
 * Logs each incoming request and the corresponding response.
 * Must run after requestIdMiddleware so req.requestId is available.
 */
export const requestLoggerMiddleware: RequestHandler = (req, res, next) => {
  logger.info({
    event: 'request',
    request_id: req.requestId,
    method: req.method,
    path: req.path,
    url: req.originalUrl,
  });

  res.on('finish', () => {
    logger.info({
      event: 'response',
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      status_code: res.statusCode,
    });
  });

  next();
};
