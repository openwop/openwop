/**
 * RFC 0152 §D — the host as an A2A 1.0 SERVER: `SendMessage` → Task → `GetTask`
 * (the task/event translation leg, host half of the RFC-named
 * `a2a-1.0-task-roundtrip`).
 *
 * `a2a-integration.md` §"A2A 1.0 versioned composition" §D.1/§D.4: `SendMessage`
 * (JSON-RPC method name, `A2A-Version: 1.0`) with no `taskId` creates a run and
 * returns `{ task }`; `Task.id` IS the backing `runId` (RFC 0100); `status.state`
 * is the 1.0 spelling projected via the D.4 bijection; `Part` is a oneof (no
 * `kind`); `history[].role` is `ROLE_*`; `GetTask` reads it back; an unknown id
 * is `TASK_NOT_FOUND` (`-32001`) — the same answer a cross-tenant id gets (§E,
 * no enumeration).
 *
 * The endpoint is discovered the way a peer would: from the host's own Agent
 * Card, `supportedInterfaces[]` with `protocolBinding: "JSONRPC"` and
 * `protocolVersion: "1.0"`. Auth: the host's normal API credential is sent as
 * the bearer, so the peer principal resolves to the conformance caller.
 *
 * Gate: `capabilities.a2a.profiles` contains `a2a-1.0` — a 0.3 host soft-skips
 * (`blocked`) and this becomes its witness when it flips. Hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * @see spec/v1/a2a-integration.md §"A2A 1.0 versioned composition" §D.1, §D.4, §E
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const PROFILE = 'a2a-1.0';
const STATES_10 = [
  'TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED',
  'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED',
];

interface A2ACaps {
  readonly supported?: boolean;
  readonly agentCardUrl?: string;
  readonly profiles?: readonly string[];
}

async function a2a(): Promise<A2ACaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<A2ACaps>(disco.json, 'a2a');
}

async function claims10(): Promise<boolean> {
  const caps = await a2a();
  return caps?.supported === true && (caps.profiles ?? []).includes('a2a-1.0');
}

async function jsonrpc10Url(): Promise<string | null> {
  const caps = await a2a();
  if (typeof caps?.agentCardUrl !== 'string') return null;
  // S18 (#1028): a header-less card GET returns the 0.3 shape while `a2a-0.3-legacy`
  // is advertised; a 1.0 client asks for the 1.0 card explicitly (a2a-integration.md §C).
  const res = await fetch(caps.agentCardUrl, { headers: { accept: 'application/json', 'A2A-Version': '1.0' } });
  if (res.status !== 200) return null;
  const card = (await res.json()) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }> };
  const iface = (card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0');
  return typeof iface?.url === 'string' ? iface.url : null;
}

async function rpc10(url: string, method: string, params: unknown, id: number) {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'A2A-Version': '1.0' };
  const key = process.env.OPENWOP_API_KEY;
  if (key) headers['authorization'] = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };
  return { status: res.status, ...body };
}

describe('RFC 0152 §D — a2a-1.0-task-roundtrip (host as A2A 1.0 server, gated on a2a.profiles ∋ a2a-1.0)', () => {
  it('SendMessage @1.0 creates a task whose id is the runId, in 1.0 spelling; GetTask reads it back; unknown id is TASK_NOT_FOUND', async () => {
    if (!behaviorGate(PROFILE, await claims10())) return;
    const url = await jsonrpc10Url();
    expect(url, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §C', 'a `a2a-1.0` host MUST publish a JSONRPC/1.0 interface in its card')).not.toBeNull();
    const sent = await rpc10(url!, 'SendMessage', {
      message: { messageId: `conf-${Date.now()}`, role: 'ROLE_USER', parts: [{ text: 'openwop conformance a2a-1.0 roundtrip' }] },
      configuration: { returnImmediately: true },
    }, 1);
    expect(sent.status, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.1', 'SendMessage MUST be accepted on the 1.0 interface')).toBe(200);
    expect(sent.error, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.1', `SendMessage MUST NOT error: ${JSON.stringify(sent.error)}`)).toBeUndefined();
    const result = sent.result ?? {};
    // SendMessageResponse is a oneof: { task } | { message }. A run-creating host answers with a task.
    const task = (result['task'] ?? (result['id'] !== undefined ? result : undefined)) as { id?: string; contextId?: string; status?: { state?: string; timestamp?: string }; history?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>; kind?: unknown } | undefined;
    expect(task, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.1', 'SendMessage without taskId MUST create a run and return `{ task }`')).toBeDefined();
    expect(task!.kind, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.5', '1.0 has no `kind` discriminator')).toBeUndefined();
    expect(typeof task!.id).toBe('string');
    expect(STATES_10, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.4', 'status.state MUST use the 1.0 TASK_STATE_* spelling')).toContain(task!.status?.state);
    for (const m of task!.history ?? []) {
      expect(['ROLE_USER', 'ROLE_AGENT'], req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.2', 'history roles are ROLE_*')).toContain(m.role);
      for (const p of m.parts ?? []) expect(p['kind'], req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.3', 'Part is a oneof — no `kind`')).toBeUndefined();
    }
    // Task.id IS the runId (RFC 0100): the OpenWOP snapshot for it MUST exist for the same caller.
    const snap = await driver.get(`/v1/runs/${encodeURIComponent(task!.id!)}`);
    expect(snap.status, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.4', '`Task.id` MUST be the backing runId — GET /v1/runs/{id} resolves it for the same principal')).toBe(200);
    // GetTask reads it back with the same id and a valid 1.0 state.
    const got = await rpc10(url!, 'GetTask', { id: task!.id }, 2);
    expect(got.error).toBeUndefined();
    const gotTask = (got.result ?? {}) as { id?: string; status?: { state?: string } };
    expect(gotTask.id).toBe(task!.id);
    expect(STATES_10).toContain(gotTask.status?.state);
    // Unknown id — and, per §E, a cross-tenant id — MUST be TASK_NOT_FOUND, never forbidden.
    const missing = await rpc10(url!, 'GetTask', { id: `run_does_not_exist_${Date.now()}` }, 3);
    expect(missing.error?.code, req('openwop.it.a2a-1-0-task-roundtrip.sendmessage-1-0-creates-a-task-whose-id-is-the-runid-in-1-0-spelling-gettask-rea', 'a2a-integration.md §D.7/§E', 'an unknown or unreadable task MUST be TASK_NOT_FOUND (-32001) — no enumeration')).toBe(-32001);
    // Tidy: cancel the run we created (best effort; terminal runs answer TASK_NOT_CANCELABLE which is fine).
    await rpc10(url!, 'CancelTask', { id: task!.id }, 4);
  });
});
