/**
 * MG-6 cutover gate — PATCH /v1/host/sample/workforces/:id status transitions,
 * with the production gate (must graduate to bounded-autonomous first) and
 * always-available rollback.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { seedWorkforceEntities } from '../src/host/workforceService.js';

const HERO = 'workforce.finance.invoice-exception';

describe('workforce cutover gate', () => {
  let server: http.Server;
  const PORT = 18244;
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
    const app = await createApp({
      port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false,
    });
    await new Promise<void>((res) => { server = app.listen(PORT, res); });
    // Seed the entity only (no run history → not graduated → production gated).
    await seedWorkforceEntities();
  });
  afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
  });

  const patch = async (status: string): Promise<{ status: number; body: any }> => {
    const r = await fetch(`${BASE}/v1/host/sample/workforces/${encodeURIComponent(HERO)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sample-token' },
      body: JSON.stringify({ status }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  it('allows ungated forward/rollback transitions (shadow ↔ piloting)', async () => {
    const r = await patch('piloting');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('piloting');
    const back = await patch('shadow'); // rollback always allowed
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('shadow');
  });

  it('gates production on graduation — 409 when the agent has no graduation evidence', async () => {
    const r = await patch('production');
    expect(r.status).toBe(409);
    expect(r.body?.error?.details?.reason ?? r.body?.details?.reason).toBe('cutover_not_eligible');
  });

  it('rejects an unknown status with 400', async () => {
    const r = await patch('live');
    expect(r.status).toBe(400);
  });
});
