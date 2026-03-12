export interface AbuseDetector {
  record(tenantId: string, statusCode: number, context?: unknown): void;
}
