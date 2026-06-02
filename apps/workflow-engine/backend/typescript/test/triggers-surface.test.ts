/**
 * host.triggers — `core.openwop.triggers` pack execution against the demo host.
 *
 * Proves the trigger surface really works end-to-end (createApp → register a
 * trigger workflow → run → inspect the event log), not just that a flag flipped:
 *
 *  1. A `core.trigger.webhook` entry node surfaces the run-scoped
 *     `ctx.triggerData` payload — sourced from `run.metadata.triggerData` when a
 *     trigger path provides it, else falling back to the run's own `inputs`.
 *     (Before this wiring `ctx.triggerData` was always `{}`, so every trigger
 *     node emitted empty data regardless of how the run started.)
 *  2. The `core.trigger.webhook-respond` node's reply is durably recorded by the
 *     host via `ctx.respondToWebhook` as a `host.webhook.response` event, and the
 *     node reports `responded: true`.
 *
 * The trigger pack is mounted from the repo's `packs/` tree by
 * `ensureLocalPacksMounted()` during `createApp`.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18191;
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
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
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

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }
interface BundleBody { events?: BundleEvent[] }

async function runToCompletion(workflowId: string, body: Record<string, unknown>): Promise<BundleEvent[]> {
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, ...body }) });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    if (['completed', 'failed', 'cancelled'].includes(snap.body.status)) break;
  }
  const bundle = await jsonFetch<BundleBody>(`/v1/runs/${runId}/debug-bundle`);
  expect(bundle.status).toBe(200);
  return bundle.body.events ?? [];
}

function nodeOutputs(events: BundleEvent[], nodeId: string): Record<string, unknown> {
  const ev = events.find((e) => e.type === 'node.completed' && e.nodeId === nodeId);
  expect(ev, `node.completed for ${nodeId} must exist`).toBeDefined();
  return (ev!.payload?.outputs ?? {}) as Record<string, unknown>;
}

describe('host.triggers: webhook trigger surfaces ctx.triggerData', () => {
  beforeAll(async () => {
    const reg = await jsonFetch('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.trigger.webhook',
        nodes: [{ nodeId: 'hook', typeId: 'core.trigger.webhook' }],
        edges: [],
      }),
    });
    expect([200, 201]).toContain(reg.status);
  });

  it('sources triggerData from run.metadata.triggerData', async () => {
    const events = await runToCompletion('sample.trigger.webhook', {
      inputs: {},
      metadata: { triggerData: { method: 'PUT', headers: { 'x-test': '1' }, body: { hello: 'world' } } },
    });
    const out = nodeOutputs(events, 'hook');
    expect(out.method).toBe('PUT');
    expect((out.headers as Record<string, unknown>)['x-test']).toBe('1');
    expect((out.body as Record<string, unknown>).hello).toBe('world');
  });

  it('falls back to run.inputs when no metadata.triggerData is present', async () => {
    const events = await runToCompletion('sample.trigger.webhook', {
      inputs: { method: 'PATCH', body: { n: 1 } },
    });
    const out = nodeOutputs(events, 'hook');
    expect(out.method).toBe('PATCH');
    expect((out.body as Record<string, unknown>).n).toBe(1);
    // The pass-through defaults still fill the unspecified ports.
    expect(out.query).toEqual({});
  });
});

describe('host.triggers: webhook-respond records the reply via ctx.respondToWebhook', () => {
  beforeAll(async () => {
    const reg = await jsonFetch('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.trigger.respond',
        nodes: [{ nodeId: 'reply', typeId: 'core.trigger.webhook-respond', config: { status: 201, headers: { 'x-demo': 'y' } } }],
        edges: [],
      }),
    });
    expect([200, 201]).toContain(reg.status);
  });

  it('durably emits host.webhook.response and reports responded:true', async () => {
    const events = await runToCompletion('sample.trigger.respond', { inputs: { body: { ok: true } } });

    const resp = events.find((e) => e.type === 'host.webhook.response');
    expect(resp, 'host.webhook.response event must be recorded').toBeDefined();
    expect(resp!.payload?.status).toBe(201);
    expect((resp!.payload?.headers as Record<string, unknown>)['x-demo']).toBe('y');
    expect((resp!.payload?.body as Record<string, unknown>).ok).toBe(true);

    const out = nodeOutputs(events, 'reply');
    expect(out.responded).toBe(true);
  });
});
