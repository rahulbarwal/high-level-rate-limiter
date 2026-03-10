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

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

/**
 * Emits a structured JSON log entry for a rate-limit rejection (PRD §9.2).
 */
export function logRejection(fields: RejectionLogEntry): void {
  logger.warn(fields);
}
