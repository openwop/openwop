/**
 * RFC 0208 §B–§E — the host as an A2A 1.0 server, held to the rows of
 * `spec/v2/interop-map.json` (`spec/v2/core/interop.md` §"The operation
 * mappings"). Target major 2.
 *
 * Gate: the v2 `a2a` record lists profile `a2a-1.0` (a host serving an A2A
 * interface). A host that advertises `a2a` for its client path only (no
 * `a2a-1.0` profile) is `inapplicable` here — it serves no interface to hold.
 * A host that claims the profile MUST advertise `agentCardUrl`, and the card
 * MUST list a JSONRPC interface at 1.0 (the `a2a.card` supportedInterfaces row);
 * every request carries `A2A-Version: 1.0`.
 *
 * Skill routing (a suite requirement, `conformance/fixtures.md`, not a spec
 * MUST): an A2A 1.0 `Message` carries no skill selector — the caller picks the
 * agent and the agent picks the skill — so the legs that start a task need the
 * host's interface to route to exactly one skill, `conformance-approval`
 * (skill id = workflowId, the `a2a.card` skills[] row). A card listing another
 * or several skills records `blocked`: the suite cannot choose one.
 *
 * Every leg starts its own task(s), so no leg depends on another's side effect.
 * `a2a-list-scoped` needs `OPENWOP_TEST_TENANT_B_API_KEY`, a credential bound to
 * a SECOND tenant; without it the leg is `blocked`, never passed.
 *
 * @see spec/v2/core/interop.md §"The operation mappings" (Isolation, A2A multi-turn)
 * @see spec/v2/interop-map.json a2a.operations / a2a.taskState / a2a.errors
 * @see RFCS/0208-v2-a2a-mcp-operation-mappings.md §C, §D, §E
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite is the A2A client: every leg POSTs JSON-RPC to the interface the host\'s own card lists; nothing harness-hosted is handed to the host';

const DOC = 'spec/v2/core/interop.md §"The operation mappings" (RFC 0208)';
const PROFILE = 'a2a-1.0';
const SKILL = 'conformance-approval';
const R = (slug: string): string => `openwop.requirement.0208.${slug}`;
const ACCEPT = { action: 'accept' };

interface MapStateRow { runStatus: string; wire: string; interruptKind?: string }
const MAP = JSON.parse(readFileSync(join(SCHEMAS_DIR, '..', 'spec', 'v2', 'interop-map.json'), 'utf8')) as { a2a: { taskState: MapStateRow[] } };
/** The map's forward projection (default rows only; an `interruptKind` override needs its interrupt kind). */
const WIRE_OF = new Map(MAP.a2a.taskState.filter((r) => r.interruptKind === undefined).map((r) => [r.runStatus, r.wire]));

interface RpcError { code: number; message?: string; data?: unknown }
interface Rpc { status: number; result?: Record<string, unknown> | undefined; error?: RpcError | undefined }
interface Task { id?: string; contextId?: string; status?: { state?: string } }

async function rpc(url: string, method: string, params: unknown, opts: { bearer?: string; version?: string } = {}): Promise<Rpc> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'A2A-Version': opts.version ?? '1.0' };
  const key = opts.bearer ?? process.env.OPENWOP_API_KEY;
  if (key) headers['authorization'] = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).readUInt32BE(0), method, params }) });
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: RpcError };
  return { status: res.status, ...body };
}

/** `SendMessageResponse` is a oneof `{ task } | { message }`; a run-backed answer is a task. */
function taskOf(r: Rpc): Task | undefined {
  const res = r.result ?? {};
  const t = (res['task'] ?? (res['id'] !== undefined ? res : undefined)) as Task | undefined;
  return t;
}

type Target = { ok: true; url: string } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string } | { ok: false; kind: 'fail'; reason: string };

/** The JSON-RPC 1.0 interface the host's own card lists, and whether it routes the one suite skill. */
async function target(needsSkill: boolean): Promise<Target> {
  if (!(await v2Discovery())) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const a2a = await familyAdvertised('a2a');
  if (!a2a) return { ok: false, kind: 'inapplicable', reason: 'a2a not advertised at major 2' };
  const profiles = Array.isArray(a2a['profiles']) ? (a2a['profiles'] as unknown[]) : [];
  if (!profiles.includes(PROFILE)) return { ok: false, kind: 'inapplicable', reason: 'a2a is advertised without profile a2a-1.0 — the host serves no A2A interface (client path only)' };
  const cardUrl = a2a['agentCardUrl'];
  if (typeof cardUrl !== 'string') return { ok: false, kind: 'fail', reason: 'a host claiming profile a2a-1.0 MUST advertise a2a.agentCardUrl' };
  const res = await fetch(cardUrl, { headers: { accept: 'application/json', 'A2A-Version': '1.0' } });
  if (res.status !== 200) return { ok: false, kind: 'fail', reason: `the advertised agentCardUrl answered ${res.status}` };
  const card = (await res.json().catch(() => ({}))) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }>; skills?: Array<{ id?: string }> };
  const iface = (card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0');
  if (typeof iface?.url !== 'string') return { ok: false, kind: 'fail', reason: 'the a2a.card supportedInterfaces row: claiming a2a-1.0 requires a JSONRPC interface at 1.0 in the card' };
  if (needsSkill) {
    const skills = (card.skills ?? []).map((s) => s.id);
    if (skills.length !== 1 || skills[0] !== SKILL) return { ok: false, kind: 'blocked', reason: `the card routes skills [${skills.join(', ')}]; A2A 1.0 carries no skill selector, so the suite needs the interface to route exactly one skill, ${SKILL} (conformance/fixtures.md)` };
    if (!isFixtureAdvertised(SKILL)) return { ok: false, kind: 'blocked', reason: `fixture ${SKILL} is not in the advertised fixtures[]` };
  }
  return { ok: true, url: iface.url };
}

function skip(t: Exclude<Target, { ok: true }>, id: string): undefined {
  if (t.kind === 'fail') { expect(t.reason, req(id, DOC, t.reason)).toBe(''); return undefined; }
  return softSkip(t.kind, t.reason);
}

const message = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ messageId: `conf-0208-${randomBytes(8).toString('hex')}`, role: 'ROLE_USER', parts: [{ text: 'openwop conformance RFC 0208' }], ...extra });
const acceptMessage = (taskId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => message({ taskId, parts: [{ data: ACCEPT }], metadata: { openwop: { interrupt: ACCEPT } }, ...extra });

async function startApprovalTask(url: string, bearer?: string): Promise<{ rpc: Rpc; task: Task | undefined }> {
  const r = await rpc(url, 'SendMessage', { message: message() }, bearer === undefined ? {} : { bearer });
  return { rpc: r, task: taskOf(r) };
}

async function runStatus(taskId: string): Promise<string | undefined> {
  const r = await driver.get(`/runs/${encodeURIComponent(taskId)}`);
  return r.status === 200 ? ((r.json as { status?: string }).status) : undefined;
}
async function eventCount(taskId: string): Promise<number> {
  const r = await driver.get(`/runs/${encodeURIComponent(taskId)}/events/poll?timeout=1`);
  return Array.isArray((r.json as { events?: unknown[] } | undefined)?.events) ? ((r.json as { events: unknown[] }).events.length) : -1;
}
async function settle(taskId: string, want: (s: string | undefined) => boolean, ms = 8000): Promise<string | undefined> {
  const end = Date.now() + ms;
  let s = await runStatus(taskId);
  while (!want(s) && Date.now() < end) { await new Promise((ok) => setTimeout(ok, 100)); s = await runStatus(taskId); }
  return s;
}
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

describe('RFC 0208 — v2-a2a-operation-map (host as A2A 1.0 server, gated on a2a.profiles ∋ a2a-1.0)', () => {
  it('a message carrying taskId without contextId is answered with the task\'s contextId', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-context-inferred'));
    const first = await startApprovalTask(t.url);
    expect(first.rpc.error, req(R('a2a-context-inferred'), DOC, `SendMessage (no taskId) MUST start a run of the routed skill: ${JSON.stringify(first.rpc.error)}`)).toBeUndefined();
    expect(first.task?.status?.state, req(R('a2a-context-inferred'), DOC, 'a run at waiting-approval projects as TASK_STATE_INPUT_REQUIRED (a2a.taskState)')).toBe(WIRE_OF.get('waiting-approval'));
    const ctx = first.task?.contextId;
    expect(typeof ctx === 'string' && ctx.length > 0, req(R('a2a-context-inferred'), DOC, 'the Task MUST carry a contextId (Message.contextId row: persisted as A2ATaskState.contextId)')).toBe(true);
    const reply = await rpc(t.url, 'SendMessage', { message: acceptMessage(first.task!.id!) });
    expect(reply.error, req(R('a2a-context-inferred'), DOC, `a message resolving the open interrupt by taskId MUST be accepted: ${JSON.stringify(reply.error)}`)).toBeUndefined();
    expect(taskOf(reply)?.contextId, req(R('a2a-context-inferred'), 'interop.md §"A2A multi-turn" (A2A §3.4.3)', 'a message carrying taskId without contextId MUST be answered with the task\'s contextId — not a fresh one, not omitted')).toBe(ctx);
    await settle(first.task!.id!, (s) => s !== undefined && TERMINAL.has(s));
  });

  it('a message whose contextId is not its task\'s is refused invalid-parameters and changes nothing', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-context-mismatch-refused'));
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(R('a2a-context-mismatch-refused'), DOC, `SendMessage MUST start a task: ${JSON.stringify(first.rpc.error)}`)).toBe('string');
    await settle(id!, (s) => s === 'waiting-approval');
    const before = await eventCount(id!);
    const bad = await rpc(t.url, 'SendMessage', { message: acceptMessage(id!, { contextId: `ctx-mismatch-${randomBytes(6).toString('hex')}` }) });
    expect(bad.error?.code, req(R('a2a-context-mismatch-refused'), 'interop.md §"A2A multi-turn"; a2a.errors (invalid parameters)', `a message whose contextId is not its task's MUST be refused with the JSON-RPC invalid-parameters error -32602 (got ${JSON.stringify(bad.error ?? bad.result)})`)).toBe(-32602);
    expect(await runStatus(id!), req(R('a2a-context-mismatch-refused'), DOC, 'the refused message MUST NOT change the run: it is still waiting-approval (the interrupt did not resolve)')).toBe('waiting-approval');
    expect(await eventCount(id!), req(R('a2a-context-mismatch-refused'), DOC, 'the refused message MUST NOT append an event to the run')).toBe(before);
    await rpc(t.url, 'CancelTask', { id });
  });

  it('a message to a retained terminal task is refused UnsupportedOperationError, and appends no event', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-terminal-unsupported'));
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(R('a2a-terminal-unsupported'), DOC, `SendMessage MUST start a task: ${JSON.stringify(first.rpc.error)}`)).toBe('string');
    await rpc(t.url, 'SendMessage', { message: acceptMessage(id!) });
    const status = await settle(id!, (s) => s !== undefined && TERMINAL.has(s));
    expect(status, req(R('a2a-terminal-unsupported'), DOC, 'precondition: the accepted approval task reaches completed and stays readable through getRun (retained)')).toBe('completed');
    const before = await eventCount(id!);
    const late = await rpc(t.url, 'SendMessage', { message: message({ taskId: id }) });
    expect(late.error?.code, req(R('a2a-terminal-unsupported'), 'interop.md §"A2A multi-turn"; a2a.operations SendMessage (taskId, run terminal and retained)', `a message to a retained terminal task MUST be refused UnsupportedOperationError -32004, not TaskNotFoundError -32001 (got ${JSON.stringify(late.error ?? late.result)})`)).toBe(-32004);
    expect(await eventCount(id!), req(R('a2a-terminal-unsupported'), DOC, 'the refusal appends no event (a2a.operations: "No event is appended")')).toBe(before);
  });

  it('an unknown task and another tenant\'s task are answered by the same TaskNotFoundError', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-unreadable-not-found'));
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id === 'string' && id.includes('/'), req(R('a2a-unreadable-not-found'), 'identity.md §5; a2a.operations GetTask', `Task.id is the tenant-bound runId <tenant>/<opaque> (got ${JSON.stringify(id)})`)).toBe(true);
    const [tenant, opaque] = [id!.slice(0, id!.indexOf('/')), id!.slice(id!.indexOf('/') + 1)];
    const fabricated = `${tenant}/${randomBytes(16).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 22)}`;
    const foreign = `zz-conformance-foreign/${opaque}`;
    const a = await rpc(t.url, 'GetTask', { id: fabricated });
    const b = await rpc(t.url, 'GetTask', { id: foreign });
    expect(a.error?.code, req(R('a2a-unreadable-not-found'), 'a2a.errors TaskNotFoundError', `an unknown task MUST be TaskNotFoundError -32001 (got ${JSON.stringify(a.error ?? a.result)})`)).toBe(-32001);
    expect(b.error?.code, req(R('a2a-unreadable-not-found'), 'interop.md §"The operation mappings" Isolation', `a task the caller cannot read — here a foreign tenant segment REST refuses 403 — MUST be answered exactly as a nonexistent one, -32001 (got ${JSON.stringify(b.error ?? b.result)}, HTTP ${b.status})`)).toBe(-32001);
    const shape = (e: RpcError | undefined): string => JSON.stringify({ http: e === undefined ? null : 'rpc', dataKeys: e?.data && typeof e.data === 'object' ? Object.keys(e.data as object).sort() : typeof e?.data });
    expect(shape(b.error) + String(b.status), req(R('a2a-unreadable-not-found'), 'interop.md §"The operation mappings" Isolation (A2A 1.0.1 §3.3.2)', 'the foreign-tenant answer MUST be indistinguishable from the unknown-id answer: same HTTP status and the same error.data shape')).toBe(shape(a.error) + String(a.status));
    await rpc(t.url, 'CancelTask', { id });
  });

  it('Task.status.state is the map\'s projection of the run status at every observed state', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-state-projection'));
    const observed: string[] = [];
    const check = async (id: string, label: string): Promise<void> => {
      const status = await runStatus(id);
      const got = taskOf(await rpc(t.url, 'GetTask', { id }))?.status?.state;
      observed.push(`${label}: run ${String(status)} → ${String(got)}`);
      expect(got, req(R('a2a-state-projection'), 'interop-map.json a2a.taskState', `GetTask state MUST equal taskState[${String(status)}].wire (${String(WIRE_OF.get(String(status)))}); observed ${observed.join('; ')}`)).toBe(WIRE_OF.get(String(status)));
    };
    const one = (await startApprovalTask(t.url)).task?.id;
    const two = (await startApprovalTask(t.url)).task?.id;
    expect(typeof one === 'string' && typeof two === 'string', req(R('a2a-state-projection'), DOC, 'SendMessage MUST start tasks')).toBe(true);
    await settle(one!, (s) => s === 'waiting-approval');
    await check(one!, 'suspended');
    await rpc(t.url, 'SendMessage', { message: acceptMessage(one!) });
    await settle(one!, (s) => s !== undefined && TERMINAL.has(s));
    await check(one!, 'accepted');
    await settle(two!, (s) => s === 'waiting-approval');
    const cancel = await rpc(t.url, 'CancelTask', { id: two });
    expect([WIRE_OF.get('cancelling'), WIRE_OF.get('cancelled')], req(R('a2a-state-projection'), 'a2a.operations CancelTask', `CancelTask answers the Task at TASK_STATE_WORKING while cancelling, TASK_STATE_CANCELED once cancelled (got ${JSON.stringify(cancel.error ?? taskOf(cancel)?.status)})`)).toContain(taskOf(cancel)?.status?.state);
    await settle(two!, (s) => s !== undefined && TERMINAL.has(s));
    await check(two!, 'cancelled');
  });

  it('the JSON-RPC error codes the suite can cause are the A2A 1.0.1 codes', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-error-codes'));
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(R('a2a-error-codes'), DOC, 'SendMessage MUST start a task')).toBe('string');
    await rpc(t.url, 'SendMessage', { message: acceptMessage(id!) });
    await settle(id!, (s) => s !== undefined && TERMINAL.has(s));
    const cancel = await rpc(t.url, 'CancelTask', { id });
    expect(cancel.error?.code, req(R('a2a-error-codes'), 'a2a.errors TaskNotCancelableError', `CancelTask on a terminal run MUST be TaskNotCancelableError -32002 (got ${JSON.stringify(cancel.error ?? cancel.result)})`)).toBe(-32002);
    const version = await rpc(t.url, 'GetTask', { id }, { version: '9.9' });
    expect(version.error?.code, req(R('a2a-error-codes'), 'a2a.errors VersionNotSupportedError', `an A2A-Version the interface does not serve MUST be VersionNotSupportedError -32009 (got ${JSON.stringify(version.error ?? version.result)})`)).toBe(-32009);
  });

  it('a row whose requires facet is not advertised is refused with the row\'s error', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R('row-requires-refused'));
    const a2a = (await familyAdvertised('a2a'))!;
    if (a2a['streaming'] === true) return softSkip('inapplicable', 'a2a.streaming is advertised — SubscribeToTask is a served row here, not a refused one');
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(R('row-requires-refused'), DOC, 'SendMessage MUST start a task')).toBe('string');
    const sub = await rpc(t.url, 'SubscribeToTask', { id });
    expect(sub.error?.code, req(R('row-requires-refused'), 'interop.md §"The operation mappings"; a2a.operations SubscribeToTask requires a2a.streaming', `a host not advertising a2a.streaming MUST refuse SubscribeToTask with UnsupportedOperationError -32004 (got ${JSON.stringify(sub.error ?? sub.result)})`)).toBe(-32004);
    await rpc(t.url, 'CancelTask', { id });
  });

  it('ListTasks returns only what listRuns returns to the same Subject; tenant and contextId never select', async () => {
    const other = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
    if (!other) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-caller leg cannot run');
    const t = await target(true);
    if (!t.ok) return skip(t, R('a2a-list-scoped'));
    const mine = await startApprovalTask(t.url);
    const theirs = await startApprovalTask(t.url, other);
    const id = mine.task?.id;
    const ctx = mine.task?.contextId;
    const theirId = theirs.task?.id;
    if (typeof id !== 'string' || typeof theirId !== 'string' || !id.includes('/')) {
      expect(typeof id === 'string' && typeof theirId === 'string', req(R('a2a-list-scoped'), DOC, `SendMessage MUST start a task under both credentials: ${JSON.stringify(mine.rpc.error ?? theirs.rpc.error)}`)).toBe(true);
    }
    const tenantA = id!.slice(0, id!.indexOf('/'));
    if (theirId!.startsWith(`${tenantA}/`)) {
      await rpc(t.url, 'CancelTask', { id });
      await rpc(t.url, 'CancelTask', { id: theirId }, { bearer: other });
      return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY binds the same tenant as OPENWOP_API_KEY — the leg needs a second tenant');
    }
    const ids = (r: Rpc): string[] => (Array.isArray(r.result?.['tasks']) ? (r.result!['tasks'] as Task[]).map((x) => String(x.id)) : []);
    const own = await rpc(t.url, 'ListTasks', { contextId: ctx });
    expect(ids(own), req(R('a2a-list-scoped'), 'a2a.operations ListTasks', `positive control: the owner's ListTasks filtered by the task's contextId MUST list it (got ${JSON.stringify(own.error ?? own.result)})`)).toContain(id);
    const plain = await rpc(t.url, 'ListTasks', {}, { bearer: other });
    expect(plain.error, req(R('a2a-list-scoped'), 'a2a.operations ListTasks', `ListTasks MUST be served to the second caller: ${JSON.stringify(plain.error)}`)).toBeUndefined();
    expect(ids(plain).filter((x) => x.startsWith(`${tenantA}/`)), req(R('a2a-list-scoped'), 'interop.md §"The operation mappings" Isolation', 'ListTasks MUST return only runs listRuns would return to the same Subject — no task of another tenant')).toEqual([]);
    const hinted = await rpc(t.url, 'ListTasks', { tenant: tenantA, contextId: ctx }, { bearer: other });
    expect(ids(hinted).filter((x) => x.startsWith(`${tenantA}/`)), req(R('a2a-list-scoped'), 'interop.md §"The operation mappings" Isolation', '`tenant` and `contextId` never select a tenant: naming the owner\'s tenant and contextId MUST NOT reveal the owner\'s task')).toEqual([]);
    const peek = await rpc(t.url, 'GetTask', { id }, { bearer: other });
    expect(peek.error?.code, req(R('a2a-list-scoped'), 'interop.md §"The operation mappings" Isolation', `another tenant's real task MUST be TaskNotFoundError for this caller (got ${JSON.stringify(peek.error ?? peek.result)})`)).toBe(-32001);
    await rpc(t.url, 'CancelTask', { id });
    await rpc(t.url, 'CancelTask', { id: theirId }, { bearer: other });
  });
});
