/**
 * host.canvas — `vendor.myndhyve.canvas` against the demo host's new durable
 * canvas store. Proves create/write/read really work end-to-end through the
 * pack nodes (a canvas created by one node is read by another), plus
 * surface-direct optimistic-concurrency conflict, deep merge, tenant isolation,
 * and the honest crossCanvasInvoke stub.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let server: http.Server;
const PORT = 18205;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
});
afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  return { status: res.status, body: (await res.json()) as T };
}

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }

async function runNode(workflowId: string, typeId: string, config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  await jsonFetch('/v1/host/sample/workflows', { method: 'POST', body: JSON.stringify({ workflowId, nodes: [{ nodeId: 'op', typeId, config }], edges: [] }) });
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs, tenantId: 'default' }) });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  let status = 'pending';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    status = snap.body.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
  }
  const bundle = await jsonFetch<{ events?: BundleEvent[] }>(`/v1/runs/${runId}/debug-bundle`);
  const ev = (bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'op');
  return { __status: status, ...((ev?.payload?.outputs as Record<string, unknown>) ?? {}) };
}

describe('host.canvas: create → write → read through the pack nodes', () => {
  it('a canvas created by one node is mutated + read by others', async () => {
    const created = await runNode('c.create', 'core.coordination.canvasCreate', { canvasTypeId: 'doc' }, { name: 'Spec', initialState: { title: 'Draft', count: 1 } });
    expect(created.__status).toBe('completed');
    const canvasId = created.canvasId as string;
    expect(canvasId).toMatch(/^canvas-/);

    const written = await runNode('c.write', 'core.coordination.canvasWrite', { merge: 'shallow' }, { canvasId, mutation: { count: 2, status: 'review' } });
    expect(written.__status).toBe('completed');
    expect(written.newVersion).toBe(2); // create=v1, one write=v2

    const read = await runNode('c.read', 'core.coordination.canvasRead', {}, { canvasId });
    expect(read.__status).toBe('completed');
    const state = read.state as Record<string, unknown>;
    expect(state.title).toBe('Draft');   // preserved
    expect(state.count).toBe(2);          // overwritten
    expect(state.status).toBe('review');  // added
    expect(read.version).toBe(2);
  });
});

describe('host.canvas: surface-direct', () => {
  const cv = () => buildHostSurfaceBundle({ tenantId: 'default' }).canvas;

  it('rejects a stale expectedVersion (optimistic concurrency)', async () => {
    const c = cv();
    const { canvasId } = await c.create({ canvasTypeId: 'doc', initialState: { v: 0 } });
    await c.write(canvasId, { v: 1 }, { expectedVersion: 1 }); // ok → v2
    await expect(c.write(canvasId, { v: 2 }, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'canvas_version_conflict' });
  });

  it('deep-merges nested state', async () => {
    const c = cv();
    const { canvasId } = await c.create({ canvasTypeId: 'doc', initialState: { meta: { a: 1, b: 2 } } });
    await c.write(canvasId, { meta: { b: 3, c: 4 } }, { merge: 'deep' });
    const r = await c.read(canvasId);
    expect(r.state.meta).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('isolates canvases by tenant', async () => {
    const a = buildHostSurfaceBundle({ tenantId: 'tA' }).canvas;
    const b = buildHostSurfaceBundle({ tenantId: 'tB' }).canvas;
    const { canvasId } = await a.create({ canvasTypeId: 'doc', initialState: {} });
    await expect(b.read(canvasId)).rejects.toMatchObject({ code: 'canvas_not_found' });
  });

  it('crossCanvasInvoke does real dispatch — rejects an unknown workflow', async () => {
    // Now a real child-run dispatcher (see canvas-invoke-dispatch.test.ts);
    // an unknown workflowId is refused rather than stubbed.
    await expect(cv().invoke('canvas-x', 'wf-does-not-exist', {})).rejects.toMatchObject({ code: 'canvas_invoke_workflow_not_found' });
  });
});
