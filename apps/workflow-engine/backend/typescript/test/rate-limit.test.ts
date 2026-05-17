/**
 * Coverage for the P0.4 rate-limit middleware:
 *   - Per-IP request bucket returns 429 once the threshold is hit.
 *   - Run-quota middleware enforces per-session minute window.
 *   - 429 carries the canonical {error, message, details, Retry-After}
 *     envelope.
 *   - OPENWOP_RATELIMIT_DISABLED=true bypasses all checks.
 */

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { ipRateLimitMiddleware, runQuotaMiddleware, _resetRateLimitState } from '../src/middleware/rateLimit.js';

let server: http.Server;
let port: number;

async function startApp(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  // Synthetic session header for tests (real app derives from cookie).
  app.use((req, _res, next) => {
    const t = req.header('x-test-tenant');
    if (t) req.tenantId = t;
    next();
  });
  app.use(ipRateLimitMiddleware());
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  app.post('/v1/runs', runQuotaMiddleware(), (_req, res) => res.status(202).json({ ok: true }));
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

let closeFn: () => Promise<void>;

describe('P0.4 rate limit', () => {
  beforeEach(async () => {
    _resetRateLimitState();
    process.env.OPENWOP_RATELIMIT_DISABLED = '';
    process.env.OPENWOP_RATELIMIT_IP_REQS_PER_MIN = '5';
    process.env.OPENWOP_RATELIMIT_SESSION_RUNS_PER_MIN = '3';
    process.env.OPENWOP_RATELIMIT_SESSION_RUNS_PER_DAY = '100';
    process.env.OPENWOP_RATELIMIT_SESSION_CONCURRENT = '100';
    process.env.OPENWOP_RATELIMIT_IP_RUNS_PER_DAY = '100';
    if (server) await new Promise<void>((r) => server.close(() => r()));
    const started = await startApp();
    closeFn = started.close;
  });

  afterAll(async () => {
    if (closeFn) await closeFn();
  });

  it('per-IP request limit returns 429 with retry-after', async () => {
    // 5 reqs/min: first 5 succeed, 6th rejects.
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/ping`);
      expect(r.status).toBe(200);
    }
    const r = await fetch(`http://127.0.0.1:${port}/ping`);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    const body = (await r.json()) as { error: string; details: { scope: string } };
    expect(body.error).toBe('rate_limited');
    expect(body.details.scope).toBe('ip_request_rate');
  });

  it('per-session run quota: 3 runs/min then 429', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-tenant': 'anon:alice' },
        body: '{}',
      });
      expect(r.status).toBe(202);
    }
    const blocked = await fetch(`http://127.0.0.1:${port}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-tenant': 'anon:alice' },
      body: '{}',
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { details: { scope: string } };
    expect(body.details.scope).toBe('session_runs_per_min');
  });

  it('per-session quota is isolated between sessions', async () => {
    for (let i = 0; i < 3; i++) {
      await fetch(`http://127.0.0.1:${port}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-tenant': 'anon:alice' },
        body: '{}',
      });
    }
    // Alice exhausted; Bob still has full quota.
    const bob = await fetch(`http://127.0.0.1:${port}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-tenant': 'anon:bob' },
      body: '{}',
    });
    expect(bob.status).toBe(202);
  });

  it('OPENWOP_RATELIMIT_DISABLED bypasses all checks', async () => {
    process.env.OPENWOP_RATELIMIT_DISABLED = 'true';
    _resetRateLimitState();
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/ping`);
      expect(r.status).toBe(200);
    }
  });
});
