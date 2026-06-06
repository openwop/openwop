/**
 * Always-on demo: the workforce dashboards fall back to the read-only
 * `__showcase__` tenant when the caller has no runs of their own, and the
 * reseed button (POST /v1/host/sample/demo/seed {heal:true}) also seeds
 * `__showcase__`. So after an admin reseeds, every visitor — including a brand
 * new tenant with zero runs — sees populated telemetry, with no per-visitor seed.
 *
 * Covers routes/workforces.ts §dashboardRuns + routes/agentOps.ts §demo/seed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18642;
const BASE = `http://127.0.0.1:${PORT}`;
const HERO = 'workforce.finance.invoice-exception';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  // Cookies ENABLED so a no-auth request mints a fresh anon tenant (the "visitor"
  // with zero runs) — distinct from the `sample-token` API-key tenant used to seed.
  delete process.env.OPENWOP_AUTH_DISABLE_COOKIES;
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
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

describe('workforce dashboards — showcase fallback (always-on demo)', () => {
  it('an admin reseed seeds __showcase__, and a fresh tenant sees it via the fallback', async () => {
    // Admin clicks "reseed" (heal). This seeds the admin's own tenant AND the
    // read-only __showcase__ tenant (best-effort, tied to the same button).
    const seed = await fetch(`${BASE}/v1/host/sample/demo/seed`, {
      method: 'POST',
      headers: { authorization: 'Bearer sample-token', 'content-type': 'application/json' },
      body: JSON.stringify({ heal: true }),
    });
    expect(seed.status).toBe(200);
    expect(((await seed.json()) as { workforceRuns: number }).workforceRuns).toBe(300);

    // A fresh anon visitor (no auth → minted empty tenant) has zero runs of its
    // own, so it must fall back to __showcase__ — totalRuns is the showcase's, not 0.
    const visitor = await fetch(`${BASE}/v1/host/sample/workforces/${HERO}/metrics`);
    expect(visitor.status).toBe(200);
    const body = (await visitor.json()) as { totalRuns: number };
    expect(body.totalRuns).toBe(300); // fallback populated it (would be 0 without the showcase)
  });
});
