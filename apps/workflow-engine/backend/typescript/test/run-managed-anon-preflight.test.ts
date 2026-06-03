/**
 * Regression coverage for the managed-credentialRef × anon-tenant
 * preflight in POST /v1/runs.
 *
 * The managed dispatch path (`providers/managedProvider.ts`) enforces
 * a per-user daily token cap, which is meaningless for anon tenants —
 * so it rejects them with `sign_in_required` at dispatch time. Before
 * the preflight, an anon caller submitting a workflow that contained a
 * `managed:*` chat node would partially execute (every node up to the
 * first managed chat dispatch) and only fail mid-run, with a
 * misleading "Something went wrong" userMessage.
 *
 * After the preflight, the run is rejected at create-time with a
 * 401 + `sign_in_required` so the FE can prompt for sign-in before
 * any work is done.
 *
 * Three checks:
 *   1. Anon caller + managed workflow → 401 sign_in_required, NO run row created.
 *   2. Anon caller + non-managed workflow → run still creates (no false positive).
 *   3. Signed-in (`user:*`) caller + managed workflow → run creates (gate is anon-only).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18193;
const BASE = `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = '';
  process.env.OPENWOP_SESSION_SECRET = 'b'.repeat(48);
  process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED = 'true';
  // A user-tier bearer that the bearer allow-list accepts as a wildcard
  // principal — used to assert the gate is anon-only (signed-in user
  // would normally come in via OIDC, but the wildcard bearer is a
  // proxy: same code path past the auth boundary, just with an
  // explicitly-set body.tenantId).
  process.env.OPENWOP_API_KEYS = 'preflight-test-admin';
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test-preflight',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((res) => server.close(() => res()));
  delete process.env.OPENWOP_AUTH_DISABLE_COOKIES;
  delete process.env.OPENWOP_SESSION_SECRET;
  delete process.env.OPENWOP_API_KEYS;
  delete process.env.OPENWOP_MANAGED_ANON_SIGNIN_REQUIRED;
});

function extractCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const head = setCookieHeader.split(';')[0]!;
  return head.trim();
}

async function mintAnonCookie(): Promise<string> {
  const res = await fetch(`${BASE}/v1/host/sample/workflows`);
  expect(res.status).toBe(200);
  const cookie = extractCookie(res.headers.get('set-cookie'));
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function registerWorkflow(workflowId: string, nodes: object[], cookie?: string): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  else headers.authorization = 'Bearer preflight-test-admin';
  const res = await fetch(`${BASE}/v1/host/sample/workflows`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workflowId, nodes }),
  });
  expect(res.status).toBe(201);
}

describe('POST /v1/runs — managed-credentialRef × anon-tenant preflight', () => {
  it('rejects anon caller with 401 sign_in_required when workflow uses managed:* credentialRef', async () => {
    const cookie = await mintAnonCookie();
    await registerWorkflow(
      'wf-managed-preflight',
      [
        {
          nodeId: 'chat',
          typeId: 'core.chat',
          config: { credentialRef: 'managed:openwop-free' },
        },
      ],
      cookie,
    );

    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ workflowId: 'wf-managed-preflight', inputs: { text: 'hi' } }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('sign_in_required');
    expect(body.message).toMatch(/sign in/i);
  });

  it('does not affect anon caller when workflow has no managed credentialRef', async () => {
    const cookie = await mintAnonCookie();
    await registerWorkflow(
      'wf-non-managed',
      [{ nodeId: 'shout', typeId: 'local.sample.demo.uppercase' }],
      cookie,
    );

    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ workflowId: 'wf-non-managed', inputs: { text: 'hello' } }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects anon caller when chat-responder typeId implicitly defaults to managed (no explicit credentialRef)', async () => {
    // Regression for the code-review gap: the chat-responder node
    // (typeId `vendor.openwop-sample.chat-responder`) defaults to
    // `managed:openwop-free` when neither `config.credentialRef` nor
    // `inputs.credentialRef` is set — see the precedence chain in
    // bootstrap/nodes.ts. The host's own `sample.chat.turn` workflow
    // is exactly this shape (no config at all). Before this fix, an
    // anon caller submitting it slipped past the preflight and only
    // failed mid-execution at the chat-node dispatch boundary with
    // `sign_in_required`. The preflight MUST now flag the implicit
    // default the same way it flags an explicit `managed:*` ref.
    const cookie = await mintAnonCookie();
    await registerWorkflow(
      'wf-chat-implicit-managed',
      [{ nodeId: 'respond', typeId: 'vendor.openwop-sample.chat-responder' }],
      cookie,
    );

    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        workflowId: 'wf-chat-implicit-managed',
        inputs: { messages: [{ role: 'user', content: 'hi' }] },
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('sign_in_required');
    expect(body.message).toMatch(/sign in/i);
  });

  it('does NOT reject anon caller when chat-responder has an explicit BYOK credentialRef', async () => {
    // Defense-in-depth: the explicit-BYOK case is the workflow author
    // opting OUT of managed. The preflight must respect that opt-out
    // even though the typeId would otherwise default to managed.
    const cookie = await mintAnonCookie();
    await registerWorkflow(
      'wf-chat-explicit-byok',
      [{
        nodeId: 'respond',
        typeId: 'vendor.openwop-sample.chat-responder',
        config: { credentialRef: 'anthropic:byok-anon' },
      }],
      cookie,
    );

    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        workflowId: 'wf-chat-explicit-byok',
        inputs: { messages: [{ role: 'user', content: 'hi' }] },
      }),
    });
    // Run creation succeeds; the BYOK secret resolution may or may not
    // succeed downstream, but THAT failure is the workflow author's
    // configuration problem, not a preflight concern.
    expect(res.status).toBe(201);
  });

  it('signed-in user (non-anon tenant) bypasses the preflight', async () => {
    // The wildcard bearer accepts any body.tenantId. Set one that
    // doesn't start with anon: — exercises the "tenantId !== anon:*"
    // branch of the preflight.
    await registerWorkflow('wf-managed-user', [
      {
        nodeId: 'chat',
        typeId: 'core.chat',
        config: { credentialRef: 'managed:openwop-free' },
      },
    ]);

    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer preflight-test-admin',
      },
      body: JSON.stringify({
        workflowId: 'wf-managed-user',
        tenantId: 'user:deadbeef',
        inputs: { text: 'hi' },
      }),
    });
    // Run is accepted at the preflight boundary. (Whether the eventual
    // managed-dispatch call succeeds depends on MINIMAX_API_KEY etc.;
    // that's a downstream concern — the preflight itself MUST NOT
    // block a user:* caller.)
    expect(res.status).toBe(201);
  });
});
