/**
 * /readiness — managed-provider deploy-time signal.
 *
 * Boots the app WITHOUT MINIMAX_API_KEY (the dropped/unmounted-secret
 * case) and asserts /readiness reports `degraded` + HTTP 503 with a
 * per-provider `checks` block, instead of silently looking healthy
 * until a user runs a workflow. /health stays a pure liveness probe.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18199;
const BASE = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  // The free-tier key is deliberately absent so the managed provider
  // stays unconfigured for this boot.
  delete process.env.MINIMAX_API_KEY;
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'readiness-test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

interface ReadinessBody {
  status: string;
  checks?: { managedProviders: Array<{ providerId: string; ready: boolean; detail: string }> };
}

describe('GET /health', () => {
  it('is a pure liveness probe — always ok', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /readiness', () => {
  it('reports 503 degraded when an advertised managed tier has no key seeded', async () => {
    const res = await fetch(`${BASE}/readiness`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as ReadinessBody;
    expect(body.status).toBe('degraded');
    const free = body.checks?.managedProviders.find((p) => p.providerId === 'openwop-free');
    expect(free).toBeTruthy();
    expect(free!.ready).toBe(false);
    expect(free!.detail).toContain('MINIMAX_API_KEY');
  });
});
