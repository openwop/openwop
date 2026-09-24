/**
 * RFC 0214 — A2A push delivery, measured at a SUITE-OWNED receiver.
 * Target major 2.
 *
 * Gate: the v2 `a2a` record lists profile `a2a-1.0` AND advertises
 * `pushNotifications: true`. Otherwise `inapplicable` — the unadvertised host's
 * obligation is the refusal row (`v2-a2a-operation-map`
 * `a2a-push-unadvertised-refused`).
 *
 * Receiver: `lib/scoped-receiver.ts`, one nonce per exercise behind the
 * operator's public front (`OPENWOP_WEBHOOK_RECEIVER_URL`, the RFC 0158
 * receiver). A conforming host REFUSES a loopback, private or plain-http push
 * destination (RFC 0214 §B, webhooks.md §Egress), so without a public https
 * front no leg here can be witnessed and each records `blocked` — never a pass,
 * and never a relaxation of the guard under test.
 *
 * Non-vacuity: every leg drives its task to INPUT_REQUIRED FIRST, registers the
 * config there, and only then resumes — a task that finished before the config
 * existed would owe no push, and a leg reading "nothing arrived" off it would
 * measure nothing. On a public front a missing delivery is a FAILURE, except
 * when other traffic provably reached the listener (`absenceIsUnmeasured`),
 * which records `blocked`.
 *
 * Limit, stated: the delivery-time DNS re-resolve arm of §B cannot be driven
 * from outside the host (the suite does not control the host's resolver); it is
 * witnessed by host unit tests, not here. The `token`-only carriage is a SHOULD
 * (RFC 0214 §C, open question 1) and is not asserted.
 *
 * @see RFCS/0214-a2a-push-credential-is-a-destination-credential.md §A–§D
 * @see spec/v2/core/interop.md §"A2A push delivery"
 * @see spec/v2/core/security-defaults.md §"Onward hops"
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { absenceIsUnmeasured, noDeliveryCause, startScopedReceiver, type ScopedHit, type ScopedReceiver } from '../lib/scoped-receiver.js';

export const REQUIRES_HOST_CALLBACK = 'the host POSTs A2A push notifications (StreamResponse statusUpdate) to the suite-owned scoped receiver behind OPENWOP_WEBHOOK_RECEIVER_URL';

const DOC = 'spec/v2/core/interop.md §"A2A push delivery" (RFC 0214)';
const R = (slug: string): string => `openwop.requirement.0214.${slug}`;
const PROFILE = 'a2a-1.0';
const SKILL = 'conformance-approval';
const ACCEPT = { action: 'accept' };
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface RpcError { code: number; message?: string; data?: unknown }
interface Rpc { status: number; result?: Record<string, unknown> | undefined; error?: RpcError | undefined }
interface Task { id?: string; contextId?: string; status?: { state?: string } }

async function rpc(url: string, method: string, params: unknown): Promise<Rpc> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'A2A-Version': '1.0' };
  const key = process.env.OPENWOP_API_KEY;
  if (key) headers['authorization'] = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).readUInt32BE(0), method, params }) });
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: RpcError };
  return { status: res.status, ...body };
}
function taskOf(r: Rpc): Task | undefined {
  const res = r.result ?? {};
  return (res['task'] ?? (res['id'] !== undefined ? res : undefined)) as Task | undefined;
}
const message = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ messageId: `conf-0214-${randomBytes(8).toString('hex')}`, role: 'ROLE_USER', parts: [{ text: 'openwop conformance RFC 0214' }], ...extra });
const acceptMessage = (taskId: string): Record<string, unknown> => message({ taskId, parts: [{ data: ACCEPT }], metadata: { openwop: { interrupt: ACCEPT } } });

type Gate = { ok: true; url: string } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };
async function gate(): Promise<Gate> {
  if (!(await v2Discovery())) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const a2a = await familyAdvertised('a2a');
  if (!a2a) return { ok: false, kind: 'inapplicable', reason: 'a2a not advertised at major 2' };
  const profiles = Array.isArray(a2a['profiles']) ? (a2a['profiles'] as unknown[]) : [];
  if (!profiles.includes(PROFILE)) return { ok: false, kind: 'inapplicable', reason: 'a2a advertised without profile a2a-1.0 — no A2A interface to register a push config on' };
  if (a2a['pushNotifications'] !== true) return { ok: false, kind: 'inapplicable', reason: 'a2a.pushNotifications not advertised — the refusal row applies (v2-a2a-operation-map a2a-push-unadvertised-refused)' };
  const cardUrl = a2a['agentCardUrl'];
  if (typeof cardUrl !== 'string') return { ok: false, kind: 'blocked', reason: 'a2a.agentCardUrl is not advertised' };
  const res = await fetch(cardUrl, { headers: { accept: 'application/json', 'A2A-Version': '1.0' } });
  const card = (await res.json().catch(() => ({}))) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }>; skills?: Array<{ id?: string }> };
  const iface = (card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0');
  if (typeof iface?.url !== 'string') return { ok: false, kind: 'blocked', reason: 'the card lists no JSONRPC 1.0 interface' };
  const skills = (card.skills ?? []).map((s) => s.id);
  if (skills.length !== 1 || skills[0] !== SKILL || !isFixtureAdvertised(SKILL)) return { ok: false, kind: 'blocked', reason: `the card routes skills [${skills.join(', ')}]; the legs need exactly ${SKILL} (conformance/fixtures.md)` };
  return { ok: true, url: iface.url };
}

/** A receiver that records its own hits and answers each with `answer` (default 204). */
async function receiver(answer?: (hit: ScopedHit, res: ServerResponse) => void): Promise<{ rx: ScopedReceiver; hits: ScopedHit[] }> {
  const hits: ScopedHit[] = [];
  const rx = await startScopedReceiver((hit, res) => {
    hits.push(hit);
    if (answer) return answer(hit, res);
    res.writeHead(204); res.end();
  });
  return { rx, hits };
}
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((ok) => setTimeout(ok, 200));
  return pred();
}
const wait = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const header = (h: ScopedHit, name: string): string | undefined => { const v = h.headers[name.toLowerCase()]; return Array.isArray(v) ? v.join(',') : v; };

async function runStatus(taskId: string): Promise<string | undefined> {
  const r = await driver.get(`/runs/${encodeURIComponent(taskId)}`);
  return r.status === 200 ? ((r.json as { status?: string }).status) : undefined;
}
async function settle(taskId: string, want: (s: string | undefined) => boolean, ms = 10000): Promise<string | undefined> {
  const end = Date.now() + ms;
  let s = await runStatus(taskId);
  while (!want(s) && Date.now() < end) { await wait(150); s = await runStatus(taskId); }
  return s;
}

/** Start an approval task and hold it at INPUT_REQUIRED — the precondition every leg needs. */
async function suspendedTask(url: string, id: string): Promise<string> {
  const r = await rpc(url, 'SendMessage', { message: message() });
  const task = taskOf(r);
  expect(typeof task?.id, req(id, DOC, `SendMessage MUST start a task (got ${JSON.stringify(r.error ?? r.result)})`)).toBe('string');
  expect(await settle(task!.id!, (s) => s === 'waiting-approval'), req(id, DOC, 'precondition: the task MUST be suspended (INPUT_REQUIRED) BEFORE the config is registered, or the leg would measure a push nobody owed')).toBe('waiting-approval');
  return task!.id!;
}
async function create(url: string, taskId: string, dest: string, extra: Record<string, unknown> = {}): Promise<Rpc> {
  return rpc(url, 'CreateTaskPushNotificationConfig', { taskId, url: dest, ...extra });
}

/** Why a leg cannot be measured on this cut, or null when it can. */
function unmeasurable(rx: ScopedReceiver, created: Rpc): string | null {
  if (!rx.tunnelled) {
    return `no public https front (OPENWOP_WEBHOOK_RECEIVER_URL) is wired — a conforming host refuses the loopback destination ${rx.url} (RFC 0214 §B), so push delivery cannot be witnessed here${created.error ? ` (Create answered ${JSON.stringify(created.error)})` : ''}`;
  }
  return null;
}

describe('RFC 0214 — v2-a2a-push-delivery (host POSTs A2A push to a suite-owned receiver)', () => {
  it('§A/§C — a transition after registration is POSTed to the registered destination with the registered Authorization and no OpenWOP signature', async () => {
    const id = R('a2a-push-delivery-authenticated');
    const g = await gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const { rx, hits } = await receiver();
    try {
      const taskId = await suspendedTask(g.url, id);
      const cred = `owpush${randomBytes(12).toString('hex')}`;
      const created = await create(g.url, taskId, rx.url, { authentication: { scheme: 'Bearer', credentials: cred } });
      const why = unmeasurable(rx, created);
      if (why !== null) { await rpc(g.url, 'CancelTask', { id: taskId }); return softSkip('blocked', why); }
      expect(created.error, req(id, DOC, `Create on a suspended task with the public receiver MUST succeed (got ${JSON.stringify(created.error)})`)).toBeUndefined();
      await rpc(g.url, 'SendMessage', { message: acceptMessage(taskId) });
      await settle(taskId, (s) => s !== undefined && TERMINAL.has(s));
      const arrived = await until(() => hits.length > 0, 20000);
      if (!arrived && absenceIsUnmeasured(rx)) return softSkip('blocked', noDeliveryCause(rx, 'A2A push'));
      expect(hits.length, req(id, `${DOC} §C ("at least one attempt")`, `a transition after registration MUST be POSTed at least once to the registered destination — ${noDeliveryCause(rx, 'A2A push')}`)).toBeGreaterThan(0);
      const h = hits[0]!;
      expect(h.method, req(id, 'A2A v1.0.1 §4.3.3', 'a push is an HTTP POST')).toBe('POST');
      expect(header(h, 'authorization'), req(id, `${DOC} §A (A2A v1.0.1 §4.3.3 "MUST include authentication credentials")`, 'the push MUST carry the registered credential as Authorization: {scheme} {credentials}')).toBe(`Bearer ${cred}`);
      expect((header(h, 'content-type') ?? '').split(';')[0]!.trim(), req(id, 'A2A v1.0.1 §4.3.3', 'the push body is application/a2a+json')).toBe('application/a2a+json');
      const body = JSON.parse(h.body || '{}') as { statusUpdate?: { taskId?: string; status?: { state?: string } } };
      expect(body.statusUpdate?.taskId, req(id, 'A2A v1.0.1 §4.3.3 (StreamResponse)', `the push body MUST be a StreamResponse statusUpdate naming the task (got ${h.body.slice(0, 200)})`)).toBe(taskId);
      const sigId = R('a2a-push-no-openwop-signature');
      for (const x of hits) {
        expect(header(x, 'openwop-signature'), req(sigId, `${DOC} §C ("no OpenWOP signature")`, 'an A2A push MUST NOT carry an OpenWOP-Signature — A2A defines no secret exchange to verify it')).toBeUndefined();
      }
    } finally { await rx.close(); }
  }, 60_000);

  it('§B — a 3xx from the destination is a failed delivery: the redirect target receives nothing, credential or not', async () => {
    const id = R('a2a-push-no-redirect');
    const g = await gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const target = await receiver();
    const origin = await receiver((_hit, res) => { res.writeHead(307, { location: target.rx.url }); res.end(); });
    try {
      const taskId = await suspendedTask(g.url, id);
      const created = await create(g.url, taskId, origin.rx.url, { authentication: { scheme: 'Bearer', credentials: `owredir${randomBytes(10).toString('hex')}` } });
      const why = unmeasurable(origin.rx, created);
      if (why !== null) { await rpc(g.url, 'CancelTask', { id: taskId }); return softSkip('blocked', why); }
      expect(created.error, req(id, DOC, `Create MUST succeed (got ${JSON.stringify(created.error)})`)).toBeUndefined();
      await rpc(g.url, 'SendMessage', { message: acceptMessage(taskId) });
      await settle(taskId, (s) => s !== undefined && TERMINAL.has(s));
      const arrived = await until(() => origin.hits.length > 0, 20000);
      if (!arrived && absenceIsUnmeasured(origin.rx)) return softSkip('blocked', noDeliveryCause(origin.rx, 'A2A push'));
      expect(origin.hits.length, req(id, DOC, `positive control: the registered destination MUST receive the push it then redirects — ${noDeliveryCause(origin.rx, 'A2A push')}`)).toBeGreaterThan(0);
      await wait(4000); // any retry or followed redirect lands in this window
      expect(target.hits.length, req(id, `${DOC} §B; webhooks.md §Egress ("refuse to follow redirects")`, 'the redirect target MUST receive nothing: a 3xx is a delivery failure and the credential MUST NOT be sent after a redirect')).toBe(0);
    } finally { await origin.rx.close(); await target.rx.close(); }
  }, 60_000);

  it('§A — after Delete no further push reaches that destination, while a live config on the same task still receives', async () => {
    const id = R('a2a-push-discard-on-delete');
    const g = await gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const kept = await receiver();
    const dropped = await receiver();
    try {
      const taskId = await suspendedTask(g.url, id);
      const a = await create(g.url, taskId, kept.rx.url, { authentication: { scheme: 'Bearer', credentials: `owkeep${randomBytes(10).toString('hex')}` } });
      const why = unmeasurable(kept.rx, a);
      if (why !== null) { await rpc(g.url, 'CancelTask', { id: taskId }); return softSkip('blocked', why); }
      const b = await create(g.url, taskId, dropped.rx.url, { authentication: { scheme: 'Bearer', credentials: `owdrop${randomBytes(10).toString('hex')}` } });
      const dropId = (b.result as { id?: string } | undefined)?.id;
      expect(typeof dropId, req(id, DOC, `Create of the second config MUST succeed (got ${JSON.stringify(b.error ?? b.result)})`)).toBe('string');
      const del = await rpc(g.url, 'DeleteTaskPushNotificationConfig', { taskId, id: dropId });
      expect(del.error, req(id, DOC, `Delete of the caller's own config MUST succeed (got ${JSON.stringify(del.error)})`)).toBeUndefined();
      await rpc(g.url, 'SendMessage', { message: acceptMessage(taskId) });
      await settle(taskId, (s) => s !== undefined && TERMINAL.has(s));
      const arrived = await until(() => kept.hits.length > 0, 20000);
      if (!arrived && absenceIsUnmeasured(kept.rx)) return softSkip('blocked', noDeliveryCause(kept.rx, 'A2A push'));
      expect(kept.hits.length, req(id, DOC, `positive control: the config that was NOT deleted MUST still receive the push — ${noDeliveryCause(kept.rx, 'A2A push')}`)).toBeGreaterThan(0);
      await wait(3000);
      expect(dropped.hits.length, req(id, `${DOC} §A ("dropped when the config is deleted")`, 'a deleted config MUST receive nothing further — its destination credential is discarded with it')).toBe(0);
    } finally { await kept.rx.close(); await dropped.rx.close(); }
  }, 60_000);

  it('§D — a replay fork of a pushed run delivers nothing to the source run\'s destination', async () => {
    const id = R('a2a-push-fork-no-push');
    const g = await gate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const replay = await familyAdvertised('replay');
    const modes = Array.isArray(replay?.['modes']) ? (replay!['modes'] as unknown[]) : [];
    if (!modes.includes('replay')) return softSkip('inapplicable', 'replay (mode replay) is not advertised — no fork to measure');
    const { rx, hits } = await receiver();
    try {
      const taskId = await suspendedTask(g.url, id);
      const created = await create(g.url, taskId, rx.url, { authentication: { scheme: 'Bearer', credentials: `owfork${randomBytes(10).toString('hex')}` } });
      const why = unmeasurable(rx, created);
      if (why !== null) { await rpc(g.url, 'CancelTask', { id: taskId }); return softSkip('blocked', why); }
      await rpc(g.url, 'SendMessage', { message: acceptMessage(taskId) });
      await settle(taskId, (s) => s !== undefined && TERMINAL.has(s));
      const arrived = await until(() => hits.length > 0, 20000);
      if (!arrived && absenceIsUnmeasured(rx)) return softSkip('blocked', noDeliveryCause(rx, 'A2A push'));
      expect(hits.length, req(id, DOC, `positive control: the source run MUST have pushed before the fork — ${noDeliveryCause(rx, 'A2A push')}`)).toBeGreaterThan(0);
      await wait(3000);
      const before = hits.length;
      const fork = await driver.post(`/runs/${encodeURIComponent(taskId)}:fork`, { mode: 'replay' });
      if (fork.status < 200 || fork.status >= 300) return softSkip('blocked', `replay is advertised but forkRun answered ${fork.status} ${JSON.stringify(fork.json)} — the fork leg is unmeasured`);
      const child = (fork.json as { runId?: string } | undefined)?.runId;
      if (typeof child === 'string') await settle(child, (s) => s !== undefined && TERMINAL.has(s), 15000);
      await wait(4000);
      expect(hits.length, req(id, `${DOC} §D; replay.md §Suppression ("MUST NOT deliver events a replay re-emits")`, `a replay fork MUST NOT push to the source run's destination (deliveries ${before} before the fork, ${hits.length} after)`)).toBe(before);
    } finally { await rx.close(); }
  }, 90_000);
});
