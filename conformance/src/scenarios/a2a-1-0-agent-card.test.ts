/**
 * RFC 0152 §A/§B/§C/§D — the suite's own A2A peer at 1.0, pinned.
 *
 * `A2AFakePeer` became dual-era at suite 1.112.0 (1.0 + 0.3-legacy). This file
 * boots a private instance and asserts, from the wire, that it actually speaks
 * A2A 1.0 as `a2a-integration.md` §"A2A 1.0 versioned composition" defines it
 * — because a fake peer that is 1.0-shaped only in its comments would let every
 * §C/§D host leg pass against a 0.3 wire and prove nothing (the "detector that
 * could never go green" failure, inverted).
 *
 * Pinned here (all server-free; the peer is in-process on 127.0.0.1):
 *   - the Agent Card is 1.0-shaped: `supportedInterfaces[]{url,protocolBinding,
 *     protocolVersion}` (one per spoken revision), no top-level `url` /
 *     `protocolVersion`, `capabilities.extendedAgentCard`;
 *   - a legacy-only peer serves the 0.3 card (so the shape follows the revision,
 *     not the calendar);
 *   - `A2A-Version` absent ⇒ 0.3 semantics; unsupported ⇒ `-32009`
 *     `VERSION_NOT_SUPPORTED` with `supportedVersions[]`; a 1.0-only peer
 *     rejects header-less requests;
 *   - `SendMessage` returns `{ task }` (the `SendMessageResponse` oneof) with
 *     `TASK_STATE_*`, `ROLE_*`, `Part` as a `oneof` (no `kind`), `status.timestamp`;
 *   - `GetTask` / `CancelTask` / `ListTasks` behave per §D.1, incl.
 *     `TASK_NOT_CANCELABLE` on a terminal task;
 *   - a 0.3 method name under a 1.0 header is a method-not-found, loudly.
 *
 * This is the peer half of the RFC-named `a2a-1.0-agent-card` and
 * `a2a-1.0-task-roundtrip` scenarios; the host halves are
 * `a2a-card-runtime-consistency.test.ts` and `a2a-1-0-task-roundtrip.test.ts`,
 * gated on the host claiming `a2a-1.0`.
 *
 * @see spec/v1/a2a-integration.md §"A2A 1.0 versioned composition" §A–§D
 * @see conformance/src/lib/a2a-fake-peer.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { A2AFakePeer } from '../lib/a2a-fake-peer.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite drives both ends itself: it boots the dual-era A2AFakePeer in-process and reads its agent card directly; no host connection is originated';

async function rpc(endpoint: string, method: string, params: unknown, version?: string, id = 1) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (version !== undefined) headers['A2A-Version'] = version;
  const res = await fetch(`${endpoint}/a2a/jsonrpc`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };
  return { status: res.status, ...body };
}

describe('RFC 0152 — the suite peer speaks A2A 1.0 (dual-era A2AFakePeer)', () => {
  // Explicit 1.0-first so a header-less GET returns the 1.0 card (the default
  // is 0.3-first for today's 0.3 clients; both eras are spoken either way).
  const peer = new A2AFakePeer({ protocolVersions: ['1.0', '0.3'] });
  beforeAll(async () => peer.start(0));
  afterAll(async () => peer.stop());

  it('the Agent Card is 1.0-shaped: supportedInterfaces[], no top-level url/protocolVersion', async () => {
    const res = await fetch(`${peer.endpoint()}/.well-known/agent-card.json`);
    expect(res.status).toBe(200);
    const card = (await res.json()) as Record<string, unknown>;
    const ifaces = card['supportedInterfaces'] as Array<{ url: string; protocolBinding: string; protocolVersion: string }>;
    expect(Array.isArray(ifaces) && ifaces.length > 0, '1.0 REQUIRES supportedInterfaces[]').toBe(true);
    expect(ifaces.map((i) => i.protocolVersion)).toEqual(['1.0', '0.3']);
    for (const i of ifaces) {
      expect(i.protocolBinding).toBe('JSONRPC');
      expect(i.url.startsWith(peer.endpoint())).toBe(true);
    }
    expect(card['url'], '1.0 removed top-level url').toBeUndefined();
    expect(card['protocolVersion'], '1.0 removed top-level protocolVersion (it is per interface)').toBeUndefined();
    const caps = card['capabilities'] as Record<string, unknown>;
    expect(caps['extendedAgentCard']).toBe(false);
    expect(Array.isArray(card['skills']) && (card['skills'] as unknown[]).length > 0, 'skills[] REQUIRED').toBe(true);
    for (const k of ['name', 'description', 'version', 'defaultInputModes', 'defaultOutputModes']) expect(card[k], `${k} REQUIRED`).toBeDefined();
  });

  it('the card shape follows the era asked for: A2A-Version: 0.3 on the GET returns the 0.3 card from the same peer', async () => {
    const res = await fetch(`${peer.endpoint()}/.well-known/agent-card.json`, { headers: { 'A2A-Version': '0.3' } });
    const card = (await res.json()) as Record<string, unknown>;
    expect(card['protocolVersion']).toBe('0.3.0');
    expect(typeof card['url']).toBe('string');
    expect(card['supportedInterfaces']).toBeUndefined();
    // and the default-constructed peer (0.3-first) serves the 0.3 card to a header-less GET
    const dflt = new A2AFakePeer();
    await dflt.start(0);
    try {
      const c = (await (await fetch(`${dflt.endpoint()}/.well-known/agent-card.json`)).json()) as Record<string, unknown>;
      expect(c['protocolVersion']).toBe('0.3.0');
      const c10 = (await (await fetch(`${dflt.endpoint()}/.well-known/agent-card.json`, { headers: { 'A2A-Version': '1.0' } })).json()) as Record<string, unknown>;
      expect(Array.isArray(c10['supportedInterfaces'])).toBe(true);
    } finally {
      await dflt.stop();
    }
  });

  it('a legacy-only peer serves the 0.3 card — shape follows revision, not calendar', async () => {
    const legacy = new A2AFakePeer({ protocolVersions: ['0.3'] });
    await legacy.start(0);
    try {
      const card = (await (await fetch(`${legacy.endpoint()}/.well-known/agent-card.json`)).json()) as Record<string, unknown>;
      expect(card['protocolVersion']).toBe('0.3.0');
      expect(typeof card['url']).toBe('string');
      expect(card['supportedInterfaces']).toBeUndefined();
    } finally {
      await legacy.stop();
    }
  });

  it('A2A-Version absent ⇒ 0.3 semantics; message/send returns a 0.3 task', async () => {
    const r = await rpc(peer.endpoint(), 'message/send', { message: { kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } });
    expect(r.error).toBeUndefined();
    expect(r.result?.['kind']).toBe('task');
    expect((r.result?.['status'] as { state: string }).state).toBe('submitted');
  });

  it('an unsupported version fails -32009 VERSION_NOT_SUPPORTED with supportedVersions[] (HTTP 400)', async () => {
    const r = await rpc(peer.endpoint(), 'SendMessage', { message: { messageId: 'm2', role: 'ROLE_USER', parts: [{ text: 'hi' }] } }, '99.0');
    expect(r.status).toBe(400);
    expect(r.error?.code).toBe(-32009);
    expect(r.error?.data?.['reason']).toBe('VERSION_NOT_SUPPORTED');
    expect(r.error?.data?.['supportedVersions']).toEqual(['1.0', '0.3']); // constructor order
  });

  it('a 1.0-only peer rejects a header-less request (which is 0.3 by rule)', async () => {
    const only10 = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await only10.start(0);
    try {
      const r = await rpc(only10.endpoint(), 'message/send', { message: { parts: [] } });
      expect(r.error?.code).toBe(-32009);
      expect(r.error?.data?.['requested']).toBe('0.3');
    } finally {
      await only10.stop();
    }
  });

  it('SendMessage @1.0 returns { task } with TASK_STATE_*, ROLE_*, Part oneof, no kind, status.timestamp', async () => {
    peer.reset();
    const r = await rpc(peer.endpoint(), 'SendMessage', { message: { messageId: 'm3', role: 'ROLE_USER', parts: [{ text: 'hello 1.0' }] } }, '1.0');
    expect(r.error).toBeUndefined();
    const task = r.result?.['task'] as Record<string, unknown>;
    expect(task, 'SendMessageResponse is a oneof payload: { task } | { message }').toBeDefined();
    expect(task['kind'], '1.0 removed the kind discriminator').toBeUndefined();
    const status = task['status'] as { state: string; timestamp?: string };
    expect(status.state).toBe('TASK_STATE_SUBMITTED');
    expect(typeof status.timestamp).toBe('string');
    const history = task['history'] as Array<Record<string, unknown>>;
    expect(history[0]?.['role']).toBe('ROLE_USER');
    const part = (history[0]?.['parts'] as Array<Record<string, unknown>>)[0]!;
    expect(part['text']).toBe('hello 1.0');
    expect(part['kind'], 'Part is a oneof — discriminate by member presence').toBeUndefined();
    expect(Array.isArray(task['artifacts'])).toBe(true);
  });

  it('GetTask / CancelTask / ListTasks per §D.1, incl. TASK_NOT_CANCELABLE on a terminal task', async () => {
    peer.reset();
    const sent = await rpc(peer.endpoint(), 'SendMessage', { message: { messageId: 'm4', role: 'ROLE_USER', parts: [{ text: 'x' }] } }, '1.0');
    const id = (sent.result?.['task'] as { id: string }).id;
    const got = await rpc(peer.endpoint(), 'GetTask', { id }, '1.0');
    expect((got.result as { status: { state: string } }).status.state).toBe('TASK_STATE_SUBMITTED');
    const listed = await rpc(peer.endpoint(), 'ListTasks', { status: 'TASK_STATE_SUBMITTED' }, '1.0');
    expect((listed.result as { totalSize: number }).totalSize).toBe(1);
    const cancelled = await rpc(peer.endpoint(), 'CancelTask', { id }, '1.0');
    expect((cancelled.result as { status: { state: string } }).status.state).toBe('TASK_STATE_CANCELED');
    const again = await rpc(peer.endpoint(), 'CancelTask', { id }, '1.0');
    expect(again.error?.code).toBe(-32002);
    expect(again.error?.data?.['reason']).toBe('TASK_NOT_CANCELABLE');
    const missing = await rpc(peer.endpoint(), 'GetTask', { id: 'nope' }, '1.0');
    expect(missing.error?.code).toBe(-32001);
    expect(missing.error?.data?.['reason']).toBe('TASK_NOT_FOUND');
  });

  it('a 0.3 method name under a 1.0 header is method-not-found — loudly', async () => {
    const r = await rpc(peer.endpoint(), 'message/send', { message: { parts: [] } }, '1.0');
    expect(r.status).toBe(404);
    expect(r.error?.code).toBe(-32601);
  });

  it('streaming is honestly unsupported: SubscribeToTask ⇒ UNSUPPORTED_OPERATION, matching capabilities.streaming=false', async () => {
    const r = await rpc(peer.endpoint(), 'SubscribeToTask', { id: 'task-1' }, '1.0');
    expect(r.error?.code).toBe(-32004);
  });
});
