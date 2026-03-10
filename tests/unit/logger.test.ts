import express from 'express';
import request from 'supertest';
import { logRejection, logger, type RejectionLogEntry } from '../../src/logger';
import { requestIdMiddleware } from '../../src/middleware/requestId';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const makeRejectionEntry = (
  overrides: Partial<RejectionLogEntry> = {},
): RejectionLogEntry => ({
  event: 'rate_limit_rejected',
  tenant_id: 'tenant-abc',
  result: 'rejected',
  tokens_remaining: 0,
  limit: 100,
  burst: 100,
  request_id: 'req-123',
  timestamp: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// logRejection — PRD §9.2 schema
// ---------------------------------------------------------------------------

describe('logRejection', () => {
  let warnSpy: jest.SpyInstance;
  let capturedArg: unknown;

  beforeEach(() => {
    capturedArg = undefined;
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation((msg) => {
      capturedArg = msg;
      return logger;
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('outputs a log object containing all PRD §9.2 fields', () => {
    const entry = makeRejectionEntry();

    logRejection(entry);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    const logged = capturedArg as Record<string, unknown>;
    expect(logged).toMatchObject({
      event: 'rate_limit_rejected',
      tenant_id: entry.tenant_id,
      result: 'rejected',
      tokens_remaining: entry.tokens_remaining,
      limit: entry.limit,
      burst: entry.burst,
      request_id: entry.request_id,
      timestamp: entry.timestamp,
    });
  });

  it('includes the "event" field set to "rate_limit_rejected"', () => {
    logRejection(makeRejectionEntry());

    const logged = capturedArg as Record<string, unknown>;
    expect(logged.event).toBe('rate_limit_rejected');
  });

  it('includes the "result" field set to "rejected"', () => {
    logRejection(makeRejectionEntry());

    const logged = capturedArg as Record<string, unknown>;
    expect(logged.result).toBe('rejected');
  });

  it('includes a numeric "tokens_remaining" field', () => {
    logRejection(makeRejectionEntry({ tokens_remaining: 7 }));

    const logged = capturedArg as Record<string, unknown>;
    expect(typeof logged.tokens_remaining).toBe('number');
    expect(logged.tokens_remaining).toBe(7);
  });

  it('includes "limit" and "burst" fields', () => {
    logRejection(makeRejectionEntry({ limit: 200, burst: 200 }));

    const logged = capturedArg as Record<string, unknown>;
    expect(logged.limit).toBe(200);
    expect(logged.burst).toBe(200);
  });

  it('includes the "request_id" field', () => {
    logRejection(makeRejectionEntry({ request_id: 'abc-xyz' }));

    const logged = capturedArg as Record<string, unknown>;
    expect(logged.request_id).toBe('abc-xyz');
  });

  it('includes a "timestamp" field in ISO 8601 format', () => {
    const ts = new Date().toISOString();
    logRejection(makeRejectionEntry({ timestamp: ts }));

    const logged = capturedArg as Record<string, unknown>;
    expect(logged.timestamp).toBe(ts);
    expect(() => new Date(logged.timestamp as string)).not.toThrow();
  });

  it('output is valid JSON when serialised', () => {
    logRejection(makeRejectionEntry());

    const logged = capturedArg as Record<string, unknown>;
    expect(() => JSON.parse(JSON.stringify(logged))).not.toThrow();

    const parsed = JSON.parse(JSON.stringify(logged)) as Record<string, unknown>;
    expect(parsed.event).toBe('rate_limit_rejected');
  });
});

// ---------------------------------------------------------------------------
// requestIdMiddleware
// ---------------------------------------------------------------------------

describe('requestIdMiddleware', () => {
  /** Minimal Express app that mounts the middleware and echoes req.requestId. */
  function buildApp(): express.Application {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/test', (req, res) => {
      res.json({ requestId: req.requestId });
    });
    return app;
  }

  it('sets req.requestId to the X-Request-ID header value when present', async () => {
    const incomingId = 'my-custom-request-id';

    const res = await request(buildApp())
      .get('/test')
      .set('X-Request-ID', incomingId);

    expect(res.body.requestId).toBe(incomingId);
  });

  it('generates a UUID v4 for req.requestId when X-Request-ID header is absent', async () => {
    const res = await request(buildApp()).get('/test');

    expect(res.body.requestId).toBeDefined();
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });

  it('sets X-Request-ID on the response with the same value as req.requestId', async () => {
    const res = await request(buildApp()).get('/test');

    const responseHeader = res.headers['x-request-id'];
    expect(responseHeader).toBeDefined();
    expect(responseHeader).toBe(res.body.requestId);
  });

  it('echoes the incoming X-Request-ID back in the response header', async () => {
    const incomingId = 'echo-this-id';

    const res = await request(buildApp())
      .get('/test')
      .set('X-Request-ID', incomingId);

    expect(res.headers['x-request-id']).toBe(incomingId);
  });

  it('generated request ID matches UUID v4 format regex', async () => {
    const res = await request(buildApp()).get('/test');

    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
});
