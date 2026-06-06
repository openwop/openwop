/**
 * Always-on demo: once the read-only `__showcase__` tenant is seeded (at server
 * startup via seedShowcaseWorkforces — architect Option B), the workforce
 * dashboards fall back to it for any caller with no runs of their own. So a
 * brand-new tenant with zero runs sees populated telemetry, with no per-visitor
 * seed.
 *
 * Covers host/workforceService.ts §seedShowcaseWorkforces + routes/workforces.ts
 * §dashboardRuns. (The boot-seed lives in index.ts `main()`, which tests don't
 * run, so we seed the showcase directly here.)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import type { Storage } from '../src/storage/storage.js';
import { seedShowcaseWorkforces } from '../src/host/workforceService.js';

let server: http.Server;
const PORT = 18642;
const BASE = `http://127.0.0.1:${PORT}`;
const HERO = 'workforce.finance.invoice-exception';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  // Cookies ENABLED so a no-auth request mints a fresh anon tenant (the "visitor"
  // with zero runs of its own).
  delete process.env.OPENWOP_AUTH_DISABLE_COOKIES;
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  // Stand in for the server-only boot seed (index.ts `main()`).
  await seedShowcaseWorkforces(app.locals.storage as Storage, 1_750_000_000_000);
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

describe('workforce dashboards — showcase fallback (always-on demo)', () => {
  it('a fresh tenant with zero runs sees the seeded __showcase__ via the fallback', async () => {
    // A fresh anon visitor (no auth → minted empty tenant) has zero runs of its
    // own, so it must fall back to __showcase__ — totalRuns is the showcase's, not 0.
    const visitor = await fetch(`${BASE}/v1/host/sample/workforces/${HERO}/metrics`);
    expect(visitor.status).toBe(200);
    const body = (await visitor.json()) as { totalRuns: number };
    expect(body.totalRuns).toBe(300); // fallback populated it (would be 0 without the showcase)
  });
});
