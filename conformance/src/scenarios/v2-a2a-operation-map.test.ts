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
 * @see RFCS/0199-outbound-oauth-client-and-credential-interrupt.md §D.1 (the credential leg; interop-map.json a2a.taskState override row)
 * @see RFCS/0214-a2a-push-credential-is-a-destination-credential.md (the push-config refusal leg; invariants a2a-push-credential-destination-bound, a2a-push-secrets-not-returned)
 * @see RFCS/0211-a2a-error-details-are-errorinfo.md §A–§E (the error-details legs; the isolation comparator)
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
import { SEAMS_PREFIX } from '../lib/seams.js';
import { unservedDestination } from '../lib/scoped-receiver.js';
import { errorInfos, normaliseErrorData, isOpenwopEnvelope, A2A_ERROR_DOMAIN } from '../lib/a2a-error-info.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite is the A2A client: every leg POSTs JSON-RPC to the interface the host\'s own card lists; the RFC 0214 push-config legs register an UNSERVED destination (lib/scoped-receiver unservedDestination) whose deliveries are neither required nor read — delivery is v2-a2a-push-delivery\'s claim';

const DOC = 'spec/v2/core/interop.md §"The operation mappings" (RFC 0208)';
const PROFILE = 'a2a-1.0';
const SKILL = 'conformance-approval';
const R = (slug: string): string => `openwop.requirement.0208.${slug}`;
const R11 = (slug: string): string => `openwop.requirement.0211.${slug}`;
const DOC11 = 'spec/v2/core/interop.md §"The operation mappings", A2A error details (RFC 0211)';
const ACCEPT = { action: 'accept' };

interface MapStateRow { runStatus: string; wire: string; interruptKind?: string }
const MAP = JSON.parse(readFileSync(join(SCHEMAS_DIR, '..', 'spec', 'v2', 'interop-map.json'), 'utf8')) as { a2a: { taskState: MapStateRow[] } };
/** The map's forward projection (default rows only; an `interruptKind` override needs its interrupt kind). */
const WIRE_OF = new Map(MAP.a2a.taskState.filter((r) => r.interruptKind === undefined).map((r) => [r.runStatus, r.wire]));
/** RFC 0199 §D.1 — the override row for a run suspended on a `credential` interrupt. */
const CREDENTIAL_WIRE = MAP.a2a.taskState.find((r) => r.runStatus === 'waiting-input' && r.interruptKind === 'credential')?.wire;

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
    // RFC 0211 §D: compare the details per element. `Object.keys(data)` of a one-element
    // array is ["0"] whatever the element discloses, so a key comparison is vacuous.
    const na = normaliseErrorData(a.error?.data, fabricated);
    const nb = normaliseErrorData(b.error?.data, foreign);
    expect(errorInfos(a.error?.data).length, req(R11('a2a-unreadable-not-found-details'), DOC11, `positive control: the unknown-id answer MUST carry error.data as an array with a google.rpc.ErrorInfo — without one the comparison below proves nothing (got ${JSON.stringify(a.error?.data)})`)).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(nb) + String(b.status), req(R11('a2a-unreadable-not-found-details'), 'interop.md §"The operation mappings" Isolation; RFC 0211 §D (A2A 1.0.1 §3.3.2)', 'the foreign-tenant answer MUST be indistinguishable from the unknown-id answer: same HTTP status and the same normalised error details (@type, reason, domain, sorted metadata keys, minus an echo of the requested id)')).toBe(JSON.stringify(na) + String(a.status));
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

  it('a host not advertising a2a.pushNotifications refuses all four push-config operations with PushNotificationNotSupportedError', async () => {
    const rid = 'openwop.requirement.0214.a2a-push-unadvertised-refused';
    const pushDoc = 'interop-map.json a2a.errors PushNotificationNotSupportedError (serverWhen: push config without a2a.pushNotifications) and the push-config operation rows; A2A v1.0.1 §3.3.4';
    const t = await target(true);
    if (!t.ok) return skip(t, rid);
    const a2a = (await familyAdvertised('a2a'))!;
    if (a2a['pushNotifications'] === true) return softSkip('inapplicable', 'a2a.pushNotifications is advertised — the push-config rows are served here, not refused');
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(rid, DOC, `SendMessage MUST start a task: ${JSON.stringify(first.rpc.error)}`)).toBe('string');
    // Positive control: the task is readable, so a -32001 below could not be masking the refusal under test.
    const read = await rpc(t.url, 'GetTask', { id });
    expect(read.error, req(rid, 'a2a.operations GetTask', `positive control: the task the suite just started MUST be readable (got ${JSON.stringify(read.error)})`)).toBeUndefined();
    const configId = `conf-0214-${randomBytes(6).toString('hex')}`;
    const calls: Array<[string, Record<string, unknown>]> = [
      ['CreateTaskPushNotificationConfig', { taskId: id, url: 'https://push.example.com/openwop-conformance' }],
      ['GetTaskPushNotificationConfig', { taskId: id, id: configId }],
      ['ListTaskPushNotificationConfigs', { taskId: id }],
      ['DeleteTaskPushNotificationConfig', { taskId: id, id: configId }],
    ];
    for (const [method, params] of calls) {
      const r = await rpc(t.url, method, params);
      expect(r.error?.code, req(rid, pushDoc, `${method} on a host not advertising a2a.pushNotifications MUST be refused PushNotificationNotSupportedError -32003 — not method-not-found -32601 (got ${JSON.stringify(r.error ?? r.result)})`)).toBe(-32003);
    }
    await rpc(t.url, 'CancelTask', { id });
  });

  // ── RFC 0214 — push-config legs on a host that ADVERTISES a2a.pushNotifications ──
  // Delivery itself (credential at the destination, no redirect, discard, fork) needs
  // a public receiver and lives in v2-a2a-push-delivery.test.ts; these three need none.

  it('RFC 0214 — CreateTaskPushNotificationConfig refuses a non-https or private destination', async () => {
    const rid = 'openwop.requirement.0214.a2a-push-register-ssrf';
    const doc = 'interop-map.json a2a.operations CreateTaskPushNotificationConfig ("the url MUST pass the webhooks.md egress guard"); webhooks.md §Egress; RFC 0214 §B';
    const t = await target(true);
    if (!t.ok) return skip(t, rid);
    const a2a = (await familyAdvertised('a2a'))!;
    if (a2a['pushNotifications'] !== true) return softSkip('inapplicable', 'a2a.pushNotifications is not advertised — the refusal row (a2a-push-unadvertised-refused) applies instead');
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(rid, DOC, `SendMessage MUST start a task: ${JSON.stringify(first.rpc.error)}`)).toBe('string');
    for (const bad of ['http://push.example.com/openwop-conformance', 'https://10.0.0.1/openwop-conformance', 'https://127.0.0.1/openwop-conformance', 'https://169.254.169.254/latest/meta-data']) {
      const r = await rpc(t.url, 'CreateTaskPushNotificationConfig', { taskId: id, url: bad });
      expect(r.result, req(rid, doc, `a push destination the egress guard refuses (${bad}) MUST NOT be registered (got result ${JSON.stringify(r.result)})`)).toBeUndefined();
      expect(typeof r.error?.code, req(rid, doc, `the refusal of ${bad} MUST be a JSON-RPC error (got ${JSON.stringify(r)})`)).toBe('number');
    }
    await rpc(t.url, 'CancelTask', { id });
  });

  it('RFC 0214 §E — a push config of another tenant\'s task, of another task, or unknown, is answered identically', async () => {
    const rid = 'openwop.requirement.0214.a2a-push-config-isolation';
    const doc = 'interop.md §"A2A push delivery" (RFC 0214 §E); interop.md §"The operation mappings" Isolation';
    const t = await target(true);
    if (!t.ok) return skip(t, rid);
    const a2a = (await familyAdvertised('a2a'))!;
    if (a2a['pushNotifications'] !== true) return softSkip('inapplicable', 'a2a.pushNotifications is not advertised — no push config can exist to isolate');
    const one = (await startApprovalTask(t.url)).task?.id;
    const two = (await startApprovalTask(t.url)).task?.id;
    expect(typeof one === 'string' && typeof two === 'string' && one.includes('/'), req(rid, DOC, 'SendMessage MUST start two tasks with tenant-bound ids')).toBe(true);
    const dest = unservedDestination('https://example.com/openwop-conformance-push');
    const created = await rpc(t.url, 'CreateTaskPushNotificationConfig', { taskId: one, url: dest.url });
    const cfg = (created.result ?? {}) as { id?: string };
    if (created.error !== undefined && !dest.tunnelled) {
      await rpc(t.url, 'CancelTask', { id: one }); await rpc(t.url, 'CancelTask', { id: two });
      return softSkip('blocked', `Create was refused for ${dest.url} and no public front (OPENWOP_WEBHOOK_RECEIVER_URL) is wired — the isolation leg needs one config to exist (${JSON.stringify(created.error)})`);
    }
    expect(typeof cfg.id, req(rid, doc, `positive control: Create on the caller's own task with a public destination MUST return a config id (got ${JSON.stringify(created.error ?? created.result)})`)).toBe('string');
    const own = await rpc(t.url, 'GetTaskPushNotificationConfig', { taskId: one, id: cfg.id });
    expect(own.error, req(rid, doc, `positive control: the caller MUST read its own config back (got ${JSON.stringify(own.error)})`)).toBeUndefined();
    const opaque = one!.slice(one!.indexOf('/') + 1);
    const foreignTask = `zz-conformance-foreign/${opaque}`;
    const unknownId = `pnc-${randomBytes(12).toString('hex')}`;
    const answers: Array<[string, Rpc, string]> = [
      ['unknown config id', await rpc(t.url, 'GetTaskPushNotificationConfig', { taskId: one, id: unknownId }), unknownId],
      ['config id under another of the caller\'s tasks', await rpc(t.url, 'GetTaskPushNotificationConfig', { taskId: two, id: cfg.id }), cfg.id!],
      ['config id under another tenant\'s task segment', await rpc(t.url, 'GetTaskPushNotificationConfig', { taskId: foreignTask, id: cfg.id }), cfg.id!],
    ];
    const shape = (r: Rpc, echo: string): string => JSON.stringify({ status: r.status, code: r.error?.code, message: (r.error?.message ?? '').split(echo).join('<id>'), data: normaliseErrorData(r.error?.data, echo), result: r.result });
    const base = shape(answers[0]![1], answers[0]![2]);
    expect(answers[0]![1].error?.code, req(rid, doc, `an unknown config id MUST be refused (got ${JSON.stringify(answers[0]![1].result)})`)).toBeTypeOf('number');
    for (const [what, r, echo] of answers.slice(1)) {
      expect(shape(r, echo), req(rid, doc, `a read of a ${what} MUST be answered exactly as an unknown id — same status, code, message and error details (minus an echo of the requested id)`)).toBe(base);
    }
    const foreignDelete = await rpc(t.url, 'DeleteTaskPushNotificationConfig', { taskId: foreignTask, id: cfg.id });
    expect(foreignDelete.result === undefined || JSON.stringify(foreignDelete.result) === '{}', req(rid, doc, `a delete naming another tenant's task MUST NOT disclose anything beyond the idempotent answer (got ${JSON.stringify(foreignDelete)})`)).toBe(true);
    const still = await rpc(t.url, 'GetTaskPushNotificationConfig', { taskId: one, id: cfg.id });
    expect(still.error, req(rid, doc, 'a delete naming another tenant\'s task MUST NOT delete the caller\'s config')).toBeUndefined();
    await rpc(t.url, 'DeleteTaskPushNotificationConfig', { taskId: one, id: cfg.id });
    const again = await rpc(t.url, 'DeleteTaskPushNotificationConfig', { taskId: one, id: cfg.id });
    expect(again.error, req(rid, 'A2A v1.0.1 §3.1.10 ("MUST be idempotent")', `a second delete of the same config MUST succeed idempotently (got ${JSON.stringify(again.error)})`)).toBeUndefined();
    await rpc(t.url, 'CancelTask', { id: one }); await rpc(t.url, 'CancelTask', { id: two });
  });

  it('RFC 0214 §A — a push config\'s token and credentials are never returned, and never reach task, events or state', async () => {
    const rid = 'openwop.requirement.0214.a2a-push-secrets-not-returned';
    const doc = 'interop-map.json a2a.operations push rows ("secrets are never returned"); security-defaults.md §"Onward hops" (RFC 0214 §A)';
    const t = await target(true);
    if (!t.ok) return skip(t, rid);
    const a2a = (await familyAdvertised('a2a'))!;
    if (a2a['pushNotifications'] !== true) return softSkip('inapplicable', 'a2a.pushNotifications is not advertised — no push credential can be registered');
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id, req(rid, DOC, `SendMessage MUST start a task: ${JSON.stringify(first.rpc.error)}`)).toBe('string');
    const credSentinel = `owcred${randomBytes(12).toString('hex')}`;
    const tokenSentinel = `owtok${randomBytes(12).toString('hex')}`;
    const dest = unservedDestination('https://example.com/openwop-conformance-push');
    const created = await rpc(t.url, 'CreateTaskPushNotificationConfig', { taskId: id, url: dest.url, token: tokenSentinel, authentication: { scheme: 'Bearer', credentials: credSentinel } });
    if (created.error !== undefined && !dest.tunnelled) {
      await rpc(t.url, 'CancelTask', { id });
      return softSkip('blocked', `Create was refused for ${dest.url} and no public front (OPENWOP_WEBHOOK_RECEIVER_URL) is wired (${JSON.stringify(created.error)})`);
    }
    const cfgId = (created.result as { id?: string } | undefined)?.id;
    expect(typeof cfgId, req(rid, doc, `positive control: Create with a credential MUST succeed (got ${JSON.stringify(created.error ?? created.result)})`)).toBe('string');
    const leaks = (what: string, v: unknown): void => {
      const text = JSON.stringify(v ?? null);
      expect(text.includes(credSentinel) || text.includes(tokenSentinel), req(rid, doc, `${what} MUST NOT carry the registered token or credentials`)).toBe(false);
    };
    leaks('the Create response', created.result);
    leaks('GetTaskPushNotificationConfig', (await rpc(t.url, 'GetTaskPushNotificationConfig', { taskId: id, id: cfgId })).result);
    leaks('ListTaskPushNotificationConfigs', (await rpc(t.url, 'ListTaskPushNotificationConfigs', { taskId: id })).result);
    leaks('GetTask', (await rpc(t.url, 'GetTask', { id })).result);
    leaks('the run snapshot (getRun)', (await driver.get(`/runs/${encodeURIComponent(id!)}`)).json);
    leaks('the run event log (pollRunEvents)', (await driver.get(`/runs/${encodeURIComponent(id!)}/events/poll?timeout=1`)).json);
    await rpc(t.url, 'DeleteTaskPushNotificationConfig', { taskId: id, id: cfgId });
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

  it('an A2A error\'s data is an array carrying one ErrorInfo with the map row\'s reason and the A2A domain', async () => {
    const t = await target(true);
    if (!t.ok) return skip(t, R11('a2a-error-data-shape'));
    const first = await startApprovalTask(t.url);
    const id = first.task?.id;
    expect(typeof id === 'string' && id.includes('/'), req(R11('a2a-error-data-shape'), DOC, `SendMessage MUST start a task with a tenant-bound id: ${JSON.stringify(first.rpc.error)}`)).toBe(true);
    const tenant = id!.slice(0, id!.indexOf('/'));
    const unknown = await rpc(t.url, 'GetTask', { id: `${tenant}/${randomBytes(16).toString('hex').slice(0, 22)}` });
    await rpc(t.url, 'SendMessage', { message: acceptMessage(id!) });
    await settle(id!, (s) => s !== undefined && TERMINAL.has(s));
    const terminal = await rpc(t.url, 'CancelTask', { id });
    for (const [label, r, reason] of [['GetTask on an unknown id', unknown, 'TASK_NOT_FOUND'], ['CancelTask on a terminal task', terminal, 'TASK_NOT_CANCELABLE']] as const) {
      expect(Array.isArray(r.error?.data), req(R11('a2a-error-data-shape'), `${DOC11} (A2A §9.5)`, `${label}: error.data MUST be an array of objects each carrying @type (got ${JSON.stringify(r.error ?? r.result)})`)).toBe(true);
      const all = (Array.isArray(r.error?.data) ? r.error!.data : []) as unknown[];
      expect(all.every((x) => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>)['@type'] === 'string'), req(R11('a2a-error-data-shape'), `${DOC11} (A2A §9.5)`, `${label}: every element of error.data MUST carry @type (got ${JSON.stringify(all)})`)).toBe(true);
      const infos = errorInfos(r.error?.data);
      expect(infos.length, req(R11('a2a-error-data-shape'), DOC11, `${label}: error.data MUST include exactly one google.rpc.ErrorInfo (got ${JSON.stringify(all)})`)).toBe(1);
      expect([infos[0]?.reason, infos[0]?.domain], req(R11('a2a-error-data-shape'), `${DOC11}; interop-map.json a2a.errors reason`, `${label}: the ErrorInfo reason MUST be the map row's reason and the domain ${A2A_ERROR_DOMAIN}`)).toEqual([reason, A2A_ERROR_DOMAIN]);
    }
  });

  it('no response on the card\'s JSON-RPC interface URL is the OpenWOP error envelope', async () => {
    const t = await target(false);
    if (!t.ok) return skip(t, R11('a2a-no-openwop-envelope'));
    const probes: Array<[string, RequestInit]> = [
      ['a body that is not JSON', { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0', ...(process.env.OPENWOP_API_KEY ? { authorization: `Bearer ${process.env.OPENWOP_API_KEY}` } : {}) }, body: '{"jsonrpc":"2.0","id":1,' }],
      ['a request with no credential', { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: 'x/y' } }) }],
      ['an unknown method', { method: 'POST', headers: { 'content-type': 'application/json', 'A2A-Version': '1.0', ...(process.env.OPENWOP_API_KEY ? { authorization: `Bearer ${process.env.OPENWOP_API_KEY}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'openwop.conformance.NoSuchMethod', params: {} }) }],
    ];
    const seen: string[] = [];
    for (const [label, init] of probes) {
      const res = await fetch(t.url, init);
      const text = await res.text();
      let body: unknown = null;
      try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = null; }
      seen.push(`${label}: HTTP ${res.status}`);
      expect(isOpenwopEnvelope(body), req(R11('a2a-no-openwop-envelope'), `${DOC11}; RFC 0211 §C`, `${label}: a response on an interface URL the card lists — including a refusal before dispatch — MUST be in the binding's shape, never the OpenWOP { error, message } envelope (HTTP ${res.status}, body ${text.slice(0, 200)})`)).toBe(false);
    }
    expect(seen.length, req(R11('a2a-no-openwop-envelope'), DOC11, 'every probe reached the interface')).toBe(probes.length);
  });

  it('VersionNotSupportedError carries ErrorInfo VERSION_NOT_SUPPORTED, and supportedVersions is a comma-joined subset of the card', async () => {
    const t = await target(false);
    if (!t.ok) return skip(t, R11('a2a-version-not-supported-shape'));
    const a2a = (await familyAdvertised('a2a'))!;
    const card = (await (await fetch(String(a2a['agentCardUrl']), { headers: { accept: 'application/json', 'A2A-Version': '1.0' } })).json().catch(() => ({}))) as { supportedInterfaces?: Array<{ url?: string; protocolVersion?: string }> };
    const offered = new Set((card.supportedInterfaces ?? []).filter((i) => i.url === t.url).map((i) => String(i.protocolVersion)));
    const r = await rpc(t.url, 'GetTask', { id: 'zz-conformance/unknown' }, { version: '99.0' });
    expect(r.error?.code, req(R11('a2a-version-not-supported-shape'), 'a2a.errors VersionNotSupportedError', `an A2A-Version the interface does not serve MUST be -32009, not -32600 (got ${JSON.stringify(r.error ?? r.result)})`)).toBe(-32009);
    const info = errorInfos(r.error?.data)[0];
    expect(info?.reason, req(R11('a2a-version-not-supported-shape'), DOC11, `the -32009 error MUST carry ErrorInfo reason VERSION_NOT_SUPPORTED (got ${JSON.stringify(r.error?.data)})`)).toBe('VERSION_NOT_SUPPORTED');
    const sv = (info?.metadata as Record<string, unknown> | undefined)?.['supportedVersions'];
    // metadata.supportedVersions is a SHOULD (RFC 0211 §E): absent is not a failure — a client
    // falls back to the card. When present it MUST be a comma-joined subset of the card's versions.
    if (sv !== undefined) {
      expect(typeof sv === 'string' && sv.split(',').every((v) => offered.has(v.trim())), req(R11('a2a-version-not-supported-shape'), `${DOC11}; RFC 0211 §E`, `when present, metadata.supportedVersions MUST be a comma-joined string of versions the card lists for this interface (got ${JSON.stringify(sv)}; card ${JSON.stringify([...offered])})`)).toBe(true);
    }
  });

  it('an HTTP+JSON interface answers an A2A error with google.rpc.Status carrying the ErrorInfo', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const a2a = await familyAdvertised('a2a');
    if (!a2a || !(Array.isArray(a2a['profiles']) && (a2a['profiles'] as unknown[]).includes(PROFILE))) return softSkip('inapplicable', 'a2a-1.0 is not claimed — no A2A interface to hold');
    const card = (await (await fetch(String(a2a['agentCardUrl']), { headers: { accept: 'application/json', 'A2A-Version': '1.0' } })).json().catch(() => ({}))) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }> };
    const rest = (card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'HTTP+JSON' && i.protocolVersion === '1.0');
    if (typeof rest?.url !== 'string') return softSkip('inapplicable', 'the card lists no HTTP+JSON interface at 1.0 — RFC 0211 §B binds only a host that lists one');
    const headers: Record<string, string> = { accept: 'application/a2a+json, application/json', 'A2A-Version': '1.0' };
    if (process.env.OPENWOP_API_KEY) headers['authorization'] = `Bearer ${process.env.OPENWOP_API_KEY}`;
    const res = await fetch(`${rest.url.replace(/\/$/, '')}/tasks/${encodeURIComponent(`zz-conformance/${randomBytes(8).toString('hex')}`)}`, { headers });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: unknown; status?: unknown; message?: unknown; details?: unknown } };
    expect([typeof body.error?.code, typeof body.error?.status, typeof body.error?.message], req(R11('a2a-httpjson-status'), `${DOC11} (A2A §11.6)`, `an HTTP+JSON A2A error MUST be google.rpc.Status { error: { code, status, message, details } } (HTTP ${res.status}, got ${JSON.stringify(body)})`)).toEqual(['number', 'string', 'string']);
    expect(errorInfos(body.error?.details)[0]?.reason, req(R11('a2a-httpjson-status'), `${DOC11} (A2A §11.6)`, 'the Status details MUST carry the ErrorInfo TASK_NOT_FOUND')).toBe('TASK_NOT_FOUND');
  });

  it('a run suspended on a credential interrupt projects to TASK_STATE_AUTH_REQUIRED, naming the provider and carrying connectUrl', async () => {
    const id = 'openwop.requirement.0199.a2a-auth-required';
    const t = await target(false);
    if (!t.ok) return skip(t, id);
    const oauth = await familyAdvertised('oauth');
    if (oauth?.['credentialInterrupt'] !== true) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised — the host raises no credential interrupt to project (RFC 0199 §C.1)');
    if (!isFixtureAdvertised('conformance-credential')) return softSkip('blocked', 'fixture conformance-credential is not in the advertised fixtures[]');
    // A fresh Subject, so no credential another scenario acquired satisfies the node.
    const minted = await driver.post(`${SEAMS_PREFIX}/sample/auth/credential/mint`, { lane: 'api-key' }).catch(() => null);
    const bearer = (minted?.json as { credential?: unknown } | undefined)?.credential;
    if (typeof bearer !== 'string') return softSkip('blocked', 'the credential mint seam did not mint a fresh Subject — a Subject that may already hold a credential makes the leg vacuous');
    const created = await driver.post('/runs', { workflowId: 'conformance-credential', inputs: {} }, { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
    const runId = (created.json as { runId?: string } | undefined)?.runId;
    expect(typeof runId, req(id, 'runs.md createRun', `createRun of conformance-credential MUST be accepted (got ${created.status})`)).toBe('string');
    const end = Date.now() + 8000;
    let snap = await driver.get(`/runs/${encodeURIComponent(runId!)}`, { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
    while ((snap.json as { status?: string } | undefined)?.status !== 'waiting-input' && Date.now() < end) {
      await new Promise((ok) => setTimeout(ok, 100));
      snap = await driver.get(`/runs/${encodeURIComponent(runId!)}`, { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
    }
    expect((snap.json as { status?: string } | undefined)?.status, req(id, 'oauth.md §The credential interrupt', 'precondition: the run suspends on the credential interrupt (waiting-input)')).toBe('waiting-input');
    const got = await rpc(t.url, 'GetTask', { id: runId }, { bearer });
    const task = taskOf(got) as (Task & { status?: { state?: string; message?: { parts?: Array<{ text?: string }> } }; metadata?: { openwop?: { interrupt?: { kind?: string } } } }) | undefined;
    expect(CREDENTIAL_WIRE, req(id, 'interop-map.json a2a.taskState', 'the map carries the (waiting-input, credential) override row')).toBe('TASK_STATE_AUTH_REQUIRED');
    expect(task?.status?.state, req(id, 'interop.md §The durable-task projection; interop-map.json a2a.taskState (waiting-input, credential)', `a run suspended on a credential interrupt MUST project to TASK_STATE_AUTH_REQUIRED, not INPUT_REQUIRED (got ${JSON.stringify(got.error ?? task?.status)})`)).toBe(CREDENTIAL_WIRE);
    expect(task?.metadata?.openwop?.interrupt?.kind, req(id, 'RFC 0199 §D.1', 'metadata.openwop.interrupt.kind (the interruptKind carrier) MUST be credential')).toBe('credential');
    const text = (task?.status?.message?.parts ?? []).map((p) => p.text ?? '').join(' ');
    const events = await driver.get(`/runs/${encodeURIComponent(runId!)}/events/poll?timeout=1`, { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
    const asked = ((events.json as { events?: Array<{ type?: string; payload?: { kind?: string; data?: { connectUrl?: string; provider?: string } } }> } | undefined)?.events ?? []).find((e) => e.type === 'interrupt.requested' && e.payload?.kind === 'credential');
    const connectUrl = asked?.payload?.data?.connectUrl ?? '\u0000';
    expect(text.includes(connectUrl) && text.includes(asked?.payload?.data?.provider ?? '\u0000'), req(id, 'RFC 0199 §D.1 (A2A v1.0.1 §7.6.1)', `the TaskStatus message MUST name the provider and carry connectUrl (got ${JSON.stringify(text)})`)).toBe(true);
    await driver.post(`/runs/${encodeURIComponent(runId!)}:cancel`, {}, { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
  });
});
