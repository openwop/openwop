/**
 * Gap D-4 — core.openwop.web-search pack + sample.web.research workflow.
 *
 * Verifies:
 *   1. The `core.web.search` node is registered and runs as a deterministic
 *      stub (the demo host does NOT advertise host.webSearch).
 *   2. The hardcoded `sample.web.research` workflow runs end-to-end through
 *      search → summarize with no BYOK provider, reaching `completed`.
 *   3. The stub result is deterministic across runs (replay safety).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18203;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
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

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as T };
}

interface RunSnap {
  status: string;
  variables?: Record<string, unknown>;
}
interface BundleBody {
  events?: { type?: string; nodeId?: string; payload?: Record<string, unknown> }[];
}

async function runToTerminal(workflowId: string, inputs: Record<string, unknown>): Promise<string> {
  const create = await jsonFetch<{ runId: string }>('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ workflowId, inputs }),
  });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const snap = await jsonFetch<RunSnap>(`/v1/runs/${runId}`);
    if (['completed', 'failed', 'cancelled'].includes(snap.body.status)) return runId;
  }
  return runId;
}

describe('core.openwop.web-search — core.web.search node', () => {
  it('runs as a one-node workflow and returns a deterministic stub result', async () => {
    const reg = await jsonFetch('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.web.search-only',
        nodes: [{ nodeId: 'search', typeId: 'core.web.search', config: { maxResults: 3 } }],
        edges: [],
        variables: [{ name: 'query', type: 'string', defaultValue: 'OpenWOP protocol' }],
      }),
    });
    expect([200, 201]).toContain(reg.status);

    const runId = await runToTerminal('sample.web.search-only', { query: 'OpenWOP protocol' });
    const snap = await jsonFetch<RunSnap>(`/v1/runs/${runId}`);
    expect(snap.body.status).toBe('completed');

    const bundle = await jsonFetch<BundleBody>(`/v1/runs/${runId}/debug-bundle`);
    const completed = (bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'search');
    expect(completed, 'search node should complete').toBeTruthy();
    const out = completed!.payload as Record<string, unknown>;
    // Output may be nested under an `outputs` envelope depending on event shape.
    const outputs = (out.outputs ?? out) as Record<string, unknown>;
    expect(outputs.engine).toBe('stub');
    expect(outputs.stub).toBe(true);
    expect(Array.isArray(outputs.results)).toBe(true);
    expect((outputs.results as unknown[]).length).toBe(3);
    const first = (outputs.results as Array<Record<string, unknown>>)[0]!;
    expect(first.url).toMatch(/^https:\/\/example\.com\//);
    expect(first.rank).toBe(1);
  });

  it('is deterministic: the same query yields identical results across runs', async () => {
    const r1 = await runToTerminal('sample.web.search-only', { query: 'determinism check' });
    const r2 = await runToTerminal('sample.web.search-only', { query: 'determinism check' });
    const b1 = await jsonFetch<BundleBody>(`/v1/runs/${r1}/debug-bundle`);
    const b2 = await jsonFetch<BundleBody>(`/v1/runs/${r2}/debug-bundle`);
    const pick = (b: BundleBody) => {
      const ev = (b.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'search')!;
      const out = (ev.payload as Record<string, unknown>);
      return (out.outputs ?? out) as Record<string, unknown>;
    };
    expect(pick(b1.body).results).toEqual(pick(b2.body).results);
  });
});

describe('sample.web.research workflow (gap D-4)', () => {
  it('runs search → summarize end-to-end with no BYOK provider', async () => {
    const runId = await runToTerminal('sample.web.research', { query: 'workflow orchestration' });
    const snap = await jsonFetch<RunSnap>(`/v1/runs/${runId}`);
    expect(snap.body.status, 'web-research sample should complete without a provider').toBe('completed');

    const bundle = await jsonFetch<BundleBody>(`/v1/runs/${runId}/debug-bundle`);
    const events = bundle.body.events ?? [];
    expect(events.some((e) => e.type === 'node.completed' && e.nodeId === 'search')).toBe(true);
    expect(events.some((e) => e.type === 'node.completed' && e.nodeId === 'summarize')).toBe(true);
  });
});
