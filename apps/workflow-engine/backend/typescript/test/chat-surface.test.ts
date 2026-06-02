/**
 * host.chat — `vendor.myndhyve.chat` bridge to the demo chat store.
 *
 * Proves the surface is a REAL bridge: a `core.chat.sendMessage` workflow node,
 * run end-to-end, lands a message in the SAME `/v1/host/sample/chat` session the
 * SPA reads, encoded as the JSON ChatMessage the UI round-trips via
 * `JSON.parse(content)`. Plus surface-direct: idempotency (same key → one
 * message) and emitCard/updateCard.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let server: http.Server;
const PORT = 18203;
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

// The chat routes bucket bearer-authed requests under the `_anon` tenant
// (tenantFromReq), while runs default to `default`. In the deployed app both
// the SPA's chat reads and its workflow runs share one cookie tenant, so they
// align; under bearer auth the test pins the run to `_anon` to match the read.
const TENANT = '_anon';

async function runNode(workflowId: string, typeId: string, config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  await jsonFetch('/v1/host/sample/workflows', { method: 'POST', body: JSON.stringify({ workflowId, nodes: [{ nodeId: 'op', typeId, config }], edges: [] }) });
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs, tenantId: TENANT }) });
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

describe('host.chat: sendMessage node lands in the demo chat store', () => {
  it('a core.chat.sendMessage run writes a UI-renderable message to the session', async () => {
    const out = await runNode('sample.chat.send', 'core.chat.sendMessage', { role: 'agent' }, { content: 'Hello from the workflow' });
    expect(out.__status).toBe('completed');
    expect(typeof out.messageId).toBe('string');

    // Read back via the SAME route the SPA uses.
    const msgs = await jsonFetch<{ messages: Array<{ messageId: string; role: string; content: string }> }>(
      `/v1/host/sample/chat/sessions/workflow-${TENANT}/messages`,
    );
    expect(msgs.status).toBe(200);
    const found = msgs.body.messages.find((m) => m.messageId === out.messageId);
    expect(found, 'the sent message must be in the chat session the UI reads').toBeDefined();
    expect(found!.role).toBe('assistant'); // 'agent' → 'assistant'
    // content is the JSON ChatMessage the SPA parses via JSON.parse(content).
    const parsed = JSON.parse(found!.content) as { role: string; content: string };
    expect(parsed.role).toBe('assistant');
    expect(parsed.content).toBe('Hello from the workflow');
  });
});

describe('host.chat: surface-direct', () => {
  const chat = () => buildHostSurfaceBundle({ tenantId: TENANT }).chat;

  it('is idempotent by idempotencyKey (same key → same messageId, one row)', async () => {
    const c = chat();
    const a = await c.sendMessage({ role: 'agent', content: 'dedupe me', sessionId: 'idem-session', idempotencyKey: 'k-dedupe' });
    const b = await c.sendMessage({ role: 'agent', content: 'dedupe me', sessionId: 'idem-session', idempotencyKey: 'k-dedupe' });
    expect(a.messageId).toBe(b.messageId);
    const msgs = await jsonFetch<{ messages: unknown[] }>('/v1/host/sample/chat/sessions/idem-session/messages');
    expect(msgs.body.messages.length).toBe(1);
  });

  it('emitCard stores a card and updateCard patches it; missing card → found:false', async () => {
    const c = chat();
    const emit = await c.emitCard({ cardId: 'card-1', cardType: 'progress', payload: { stage: 1 }, idempotencyKey: 'ck1' });
    expect(emit.cardId).toBe('card-1');
    const upd = await c.updateCard({ cardId: 'card-1', patch: { stage: 2 }, patchType: 'merge', idempotencyKey: 'ck2' });
    expect(upd.found).toBe(true);
    const missing = await c.updateCard({ cardId: 'nope', patch: {}, idempotencyKey: 'ck3' });
    expect(missing.found).toBe(false);
  });
});
