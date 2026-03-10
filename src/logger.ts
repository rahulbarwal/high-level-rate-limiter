import { createLogger, transports, format } from 'winston';

/**
 * PRD §9.2 schema for a rate-limit rejection log entry.
 * Every 429 decision must be logged with exactly these fields.
 */
export interface RejectionLogEntry {
  event: 'rate_limit_rejected';
  tenant_id: string;
  result: 'rejected';
  tokens_remaining: number;
  limit: number;
  burst: number;
  request_id: string;
  timestamp: string;
}

/**
 * Centralised winston logger for structured JSON output.
 * Stub: methods are present but the transport is not yet configured for production.
 */
export const logger = createLogger({
  format: format.json(),
  transports: [new transports.Console()],
});

/**
 * Emits a structured JSON log entry for a rate-limit rejection.
 * Stub: throws 'not implemented' until wired in Phase D.
 */
export function logRejection(_fields: RejectionLogEntry): void {
  throw new Error('not implemented');
}
