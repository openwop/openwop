/**
 * host.canvas crossCanvasInvoke — real child-run dispatch (Residual #3).
 *
 * Proves ctx.canvas.invoke now starts a REAL child run (not the stub): the
 * `core.coordination.crossCanvasInvoke` node spawns a child workflow that
 * completes, returns its terminalStatus, and the child run is persisted.
 * Surface-direct: awaitTerminal:false returns immediately, and the circuit
 * breaker opens after repeated child-run failures.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let server: http.Server;
const PORT = 18209;
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

async function registerWorkflow(workflowId: string, nodes: unknown[]): Promise<void> {
  const r = await jsonFetch('/v1/host/sample/workflows', { method: 'POST', body: JSON.stringify({ workflowId, nodes, edges: [] }) });
  expect([200, 201]).toContain(r.status);
}

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }

async function runNode(workflowId: string, typeId: string, config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  await registerWorkflow(workflowId, [{ nodeId: 'op', typeId, config }]);
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs, tenantId: 'default' }) });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  let status = 'pending';
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    status = snap.body.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
  }
  const bundle = await jsonFetch<{ events?: BundleEvent[] }>(`/v1/runs/${runId}/debug-bundle`);
  const ev = (bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'op');
  return { __status: status, ...((ev?.payload?.outputs as Record<string, unknown>) ?? {}) };
}

describe('host.canvas crossCanvasInvoke: real dispatch', () => {
  beforeAll(async () => {
    // A trivial child workflow (a webhook trigger passthrough) that completes.
    await registerWorkflow('child-ok', [{ nodeId: 'hook', typeId: 'core.trigger.webhook' }]);
  });

  it('invoke node spawns a child run that completes', async () => {
    const out = await runNode('cv.invoke', 'core.coordination.crossCanvasInvoke', { targetCanvasId: 'cv-1', workflowId: 'child-ok', awaitTerminal: true }, { args: { hello: 'world' } });
    expect(out.__status).toBe('completed');
    expect(typeof out.childRunId).toBe('string');
    expect(out.childRunId).not.toBe('');
    expect(out.terminalStatus).toBe('completed');

    // The child run really exists in storage and completed.
    const child = await jsonFetch<{ status: string }>(`/v1/runs/${out.childRunId}`);
    expect(child.status).toBe(200);
    expect(child.body.status).toBe('completed');
  });
});

describe('host.canvas crossCanvasInvoke: surface-direct', () => {
  const cv = () => buildHostSurfaceBundle({ tenantId: 'default' }).canvas;

  it('awaitTerminal:false returns a childRunId immediately', async () => {
    await registerWorkflow('child-async', [{ nodeId: 'hook', typeId: 'core.trigger.webhook' }]);
    const r = await cv().invoke('cv-2', 'child-async', { a: 1 }, { awaitTerminal: false });
    expect(typeof r.childRunId).toBe('string');
    expect(r.childRunId).not.toBe('');
    expect(r.terminalStatus).toBeUndefined();
  });

  it('opens the circuit after the threshold of child-run failures', async () => {
    // A child workflow whose node type isn't registered → the child run fails.
    await registerWorkflow('child-bad', [{ nodeId: 'x', typeId: 'does.not.exist' }]);
    const opts = { circuitBreaker: { threshold: 1 } };
    const first = await cv().invoke('cv-bad', 'child-bad', {}, opts);
    expect(first.terminalStatus).toBe('failed'); // ran, failed → counts toward the breaker
    const second = await cv().invoke('cv-bad', 'child-bad', {}, opts);
    expect(second.circuitOpen).toBe(true); // breaker open, no dispatch
    expect(second.childRunId).toBe('');
  });
});
