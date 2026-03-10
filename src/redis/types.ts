export interface TokenBucketResult {
  allowed: boolean;
  tokensRemaining: number;
  burstSize: number;
  resetAtMs: number;
}

export class RedisUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
