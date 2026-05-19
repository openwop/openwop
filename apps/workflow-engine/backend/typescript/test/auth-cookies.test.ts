/**
 * Coverage for the P0.2 cookie-mode auth path:
 *   - First request without a cookie mints an anonymous session.
 *   - Subsequent requests carrying the cookie hit the same tenant.
 *   - Tampered signatures reject with 401 → cookie reissued.
 *   - Tenant id derives from the cookie, not from request body, so
 *     body.tenantId = "someone-elses-tenant" can't impersonate.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18185;
const BASE = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = ''; // cookie mode ON
  process.env.OPENWOP_SESSION_SECRET = ''; // dev fallback kicks in
  delete process.env.OPENWOP_SESSION_SECRET;
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test-cookie',
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

function extractCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // "__session=value; Path=/; Max-Age=..." — extract just `key=value`.
  const head = setCookieHeader.split(';')[0]!;
  return head.trim();
}

describe('cookie-mode auth (P0.2)', () => {
  it('mints a session cookie on first request', async () => {
    // Hit a route that requires auth. /v1/host/sample/workflows is a
    // GET that 200s with an empty list once authed.
    const res = await fetch(`${BASE}/v1/host/sample/workflows`);
    expect(res.status).toBe(200);
    const cookie = extractCookie(res.headers.get('set-cookie'));
    expect(cookie).toMatch(/^__session=/);
  });

  it('preserves the session across requests + derives tenantId from cookie', async () => {
    const first = await fetch(`${BASE}/v1/host/sample/workflows`);
    const cookie = extractCookie(first.headers.get('set-cookie'))!;
    // Register a workflow (POST) carrying the cookie; the run should
    // inherit the cookie-derived tenant.
    const reg = await fetch(`${BASE}/v1/host/sample/workflows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        workflowId: 'cookie-test',
        nodes: [{ nodeId: 'shout', typeId: 'local.sample.demo.uppercase' }],
      }),
    });
    expect(reg.status).toBe(201);

    // Create a run WITHOUT passing tenantId in the body. The cookie's
    // tenant should be used.
    const runRes = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ workflowId: 'cookie-test', inputs: { text: 'hello' } }),
    });
    expect(runRes.status).toBe(201);
    const run = (await runRes.json()) as { runId: string };

    // Fetch run snapshot to confirm the run was authed to the cookie's
    // tenant. (The snapshot projection doesn't echo tenantId; the
    // success of the create + fetch is the assertion.)
    const snap = await fetch(`${BASE}/v1/runs/${run.runId}`, {
      headers: { cookie },
    });
    expect(snap.status).toBe(200);
    const snapBody = (await snap.json()) as { runId: string; workflowId: string };
    expect(snapBody.runId).toBe(run.runId);
    expect(snapBody.workflowId).toBe('cookie-test');
  });

  it('rejects a body.tenantId that doesn\'t match the cookie\'s tenant', async () => {
    const first = await fetch(`${BASE}/v1/host/sample/workflows`);
    const cookie = extractCookie(first.headers.get('set-cookie'))!;
    await fetch(`${BASE}/v1/host/sample/workflows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        workflowId: 'cookie-impersonation-test',
        nodes: [{ nodeId: 'shout', typeId: 'local.sample.demo.uppercase' }],
      }),
    });
    const runRes = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        workflowId: 'cookie-impersonation-test',
        tenantId: 'someone-elses-tenant',
        inputs: {},
      }),
    });
    // Principal's tenants is [cookie.tenantId]; authorizer rejects.
    expect(runRes.status).toBe(403);
    const body = (await runRes.json()) as { error: string };
    expect(body.error).toMatch(/forbidden/);
  });

  it('rejects a tampered signature → new cookie minted', async () => {
    // Forge a payload + bad sig
    const forged = '__session=eyJzaWQiOiJYIiwidGVuYW50SWQiOiJhbm9uOlgiLCJ0aWVyIjoiYW5vbiIsImlhdCI6MSwiZXhwIjoyMDAwMDAwMDAwfQ.BADSIG';
    const res = await fetch(`${BASE}/v1/host/sample/workflows`, {
      headers: { cookie: forged },
    });
    expect(res.status).toBe(200); // a fresh cookie is minted
    const reissued = extractCookie(res.headers.get('set-cookie'));
    expect(reissued).toBeTruthy();
    expect(reissued).not.toBe(forged);
  });
});
