/**
 * ctx.suspend / ctx.interrupt — re-invoke resume (Residual #1).
 *
 * The chat approvalGate calls `await ctx.suspend({reason:'approval', resumeKey})`
 * inline and shapes the resolution into named outputs. Proves the host now:
 *  - suspends the run on the inline call (interrupt.md §"key field"),
 *  - on resume RE-INVOKES the node so it produces its real shaped outputs
 *    (decision/approved/action) — NOT the raw {input: resumeValue} a
 *    mark-completed resume would give,
 *  - redacts a pasted secret in the resume value at the boundary (architect
 *    finding #1),
 *  - emits the approval card exactly once across suspend+resume (idempotency).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18213;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';
const TENANT = '_anon'; // align run tenant with the chat route's bearer bucket

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
});
afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }

async function pollStatus(runId: string): Promise<{ status: string; events: BundleEvent[] }> {
  let status = 'pending';
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    status = snap.body.status;
    if (['completed', 'failed', 'cancelled'].includes(status) || status.startsWith('waiting')) break;
  }
  const bundle = await jsonFetch<{ events?: BundleEvent[] }>(`/v1/runs/${runId}/debug-bundle`);
  return { status, events: bundle.body.events ?? [] };
}

async function startGateRun(workflowId: string, resumeValue: Record<string, unknown>): Promise<{ runId: string; out: Record<string, unknown>; bundleText: string }> {
  await jsonFetch('/v1/host/sample/workflows', { method: 'POST', body: JSON.stringify({ workflowId, nodes: [{ nodeId: 'gate', typeId: 'core.chat.approvalGate', config: { title: 'Review' } }], edges: [] }) });
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs: { artifact: 'draft v1' }, tenantId: TENANT }) });
  expect(create.status).toBe(201);
  const runId = create.body.runId;

  // It must suspend (not complete).
  const sus = await pollStatus(runId);
  expect(sus.status.startsWith('waiting'), `run should suspend, was ${sus.status}`).toBe(true);
  expect(sus.events.some((e) => e.type === 'node.suspended' && e.nodeId === 'gate')).toBe(true);

  // Resolve via the token surface.
  const ints = await jsonFetch<{ interrupts: Array<{ token: string; nodeId: string }> }>(`/v1/host/sample/runs/${runId}/interrupts`);
  const token = ints.body.interrupts.find((i) => i.nodeId === 'gate')?.token;
  expect(token, 'an open interrupt token for the gate').toBeTruthy();
  const resolve = await jsonFetch(`/v1/interrupts/${token}`, { method: 'POST', body: JSON.stringify({ resumeValue }) });
  expect([200, 202, 204]).toContain(resolve.status);

  const done = await pollStatus(runId);
  expect(done.status, 'run completes after resume').toBe('completed');
  const ev = done.events.find((e) => e.type === 'node.completed' && e.nodeId === 'gate');
  const bundle = await jsonFetch(`/v1/runs/${runId}/debug-bundle`);
  return { runId, out: (ev?.payload?.outputs as Record<string, unknown>) ?? {}, bundleText: JSON.stringify(bundle.body) };
}

describe('ctx.suspend re-invoke resume', () => {
  it('re-invokes the gate node so it shapes the resolution into real outputs', async () => {
    const { out } = await startGateRun('chat.gate.accept', { decision: 'accept' });
    // Re-invoke proof: the node ran again and produced its shaped outputs, not
    // a raw {input: {decision:'accept'}} from a mark-completed resume.
    expect(out.approved).toBe(true);
    expect(out.action ?? out.decision).toBeDefined();
    expect((out as Record<string, unknown>).input).toBeUndefined();
  });

  it('redacts a pasted secret in the resume value (architect finding #1)', async () => {
    const planted = 'sk-ant-api03-PLANTEDKEYPLANTEDKEYPLANTEDKEYPLANTEDKEYPLANTEDKEY00';
    const { bundleText } = await startGateRun('chat.gate.redact', { decision: 'refine', feedback: `change this, my key is ${planted} btw` });
    expect(bundleText.includes(planted), 'the pasted key MUST NOT reach the event log').toBe(false);
  });

  it('emits the approval card exactly once across suspend + resume (idempotency)', async () => {
    // The approvalGate emits a card via ctx.chat.emitCard on both the initial
    // run AND the re-invoke; the deterministic idempotencyKey must collapse them.
    // Measure the shared session's message-count delta for ONE gate run: it must
    // grow by exactly 1 (re-invoke double-emit would make it 2).
    const before = await jsonFetch<{ messages: unknown[] }>(`/v1/host/sample/chat/sessions/workflow-${TENANT}/messages`);
    const beforeCount = before.body.messages?.length ?? 0;
    await startGateRun('chat.gate.idem', { decision: 'accept' });
    const after = await jsonFetch<{ messages: unknown[] }>(`/v1/host/sample/chat/sessions/workflow-${TENANT}/messages`);
    const delta = (after.body.messages?.length ?? 0) - beforeCount;
    expect(delta, 'one card emitted across the full suspend+resume lifecycle').toBe(1);
  });
});
