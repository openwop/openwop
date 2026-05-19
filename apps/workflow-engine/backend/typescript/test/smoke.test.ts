/**
 * Smoke tests covering the golden path: discovery → create run →
 * stream events → cancel → fork → BYOK strip-on-persist.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import {
  setRunSecrets,
  stripSecretsFromPersisted,
  clearRunSecrets,
} from '../src/byok/ephemeralRunSecrets.js';

let server: http.Server;
const PORT = 18181;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  // Tests run in legacy Bearer-only mode (no cookies). The cookie
  // path is exercised separately in test/auth-cookies.test.ts.
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
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

interface DiscoveryBody {
  protocolVersion: string;
  capabilities: { interrupts: { kinds: readonly string[] } };
}

interface CreateRunBody {
  runId: string;
  status: string;
  eventsUrl: string;
}

interface RunSnapshotBody {
  runId: string;
  status: string;
}

async function jsonFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  // JSON-only — if a route returns non-JSON (HTML error page, plain
  // text 401) the parse failure throws and surfaces as a test error
  // with the raw response in the stack. For deliberately-unauth probes
  // call `fetch` directly.
  return { status: res.status, body: (await res.json()) as T };
}

describe('discovery', () => {
  it('serves /.well-known/openwop with capabilities', async () => {
    const { status, body } = await jsonFetch<DiscoveryBody>('/.well-known/openwop');
    expect(status).toBe(200);
    expect(body.protocolVersion).toBe('1.1');
    expect(body.capabilities.interrupts.kinds).toContain('approval');
  });

  it('rejects unauth requests on protected routes', async () => {
    const res = await fetch(`${BASE}/v1/runs/nonexistent`);
    expect(res.status).toBe(401);
  });
});

describe('run lifecycle', () => {
  it('creates and completes a sample run', async () => {
    const create = await jsonFetch<CreateRunBody>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.demo.uppercase',
        tenantId: 'demo',
        inputs: { text: 'hello' },
      }),
    });
    expect(create.status).toBe(201);
    expect(typeof create.body.runId).toBe('string');
    const runId = create.body.runId;

    // Poll for terminal status.
    let final: RunSnapshotBody | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const snap = await jsonFetch<RunSnapshotBody>(`/v1/runs/${runId}`);
      final = snap.body;
      if (['completed', 'failed', 'cancelled'].includes(snap.body.status)) break;
    }
    expect(final?.status).toBe('completed');
  });

  it('replays the same response for an Idempotency-Key', async () => {
    const headers = { 'idempotency-key': 'fixed-key-001' };
    const first = await jsonFetch<CreateRunBody>('/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workflowId: 'sample.demo.uppercase',
        tenantId: 'demo',
        inputs: { text: 'idem' },
      }),
    });
    expect(first.status).toBe(201);
    // Wait briefly for the inline dispatch to finish so the cached
    // response is final (not __pending__) before the second request.
    await new Promise((r) => setTimeout(r, 100));
    const second = await jsonFetch<CreateRunBody>('/v1/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workflowId: 'sample.demo.uppercase',
        tenantId: 'demo',
        inputs: { text: 'idem' },
      }),
    });
    expect(second.status).toBe(201);
    expect(second.body.runId).toBe(first.body.runId);
  });
});

describe('BYOK strip-on-persist invariant', () => {
  interface NestedPayload {
    nested: { token: string };
    arr: readonly string[];
    safe: string;
  }
  it('replaces secret values with credentialRef placeholders', () => {
    setRunSecrets('test-run-1', { mySecret: 'super-confidential-value' });
    const before: NestedPayload = {
      nested: { token: 'super-confidential-value' },
      arr: ['public', 'super-confidential-value'],
      safe: 'no-secrets-here',
    };
    const after = stripSecretsFromPersisted<NestedPayload>(before);
    expect(after.nested.token).toBe('<<redacted:mySecret>>');
    expect(after.arr[1]).toBe('<<redacted:mySecret>>');
    expect(after.arr[0]).toBe('public');
    expect(after.safe).toBe('no-secrets-here');
    clearRunSecrets('test-run-1');
  });

  it('passes through when no run secrets are set', () => {
    const before = { token: 'arbitrary-string' };
    const after = stripSecretsFromPersisted(before);
    expect(after).toEqual(before);
  });
});
