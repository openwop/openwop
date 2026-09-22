/**
 * RFC 0198 — the v2 MCP server mount maps long runs to MCP Tasks
 * (`io.modelcontextprotocol/tasks`, revision 2026-07-28), and a disconnect
 * cancels only the run it owns (`spec/v2/core/interop.md` §"MCP tasks and
 * cancellation"; `spec/v2/interop-map.json` `mcp.tasks`). Target major 2.
 *
 * Gate: the v2 `mcp` record carries `serverMount`, lists profile
 * `mcp-2026-07-28` and an `mcp.serverUrls[0]`, and the mount's
 * `server/discover` lists `io.modelcontextprotocol/tasks` in
 * `capabilities.extensions`. A mount that does not serve the extension is
 * `inapplicable` for the task legs; the §G disconnect / no-`notifications/cancelled`
 * legs bind every v2 mount and run whenever the mount does.
 *
 * Tools (a suite requirement, `conformance/fixtures.md`): `conformance-approval`,
 * `conformance-approval-approvers`, `conformance-failure`, `conformance-delay`
 * and `conformance-cancellable`, each exposed as a tool under its workflowId.
 * A missing fixture is `blocked` naming it, never a pass.
 *
 * Cross-tenant legs need `OPENWOP_TEST_TENANT_B_API_KEY` (a credential bound to
 * a SECOND tenant; not `OPENWOP_TEST_SECONDARY_API_KEY`, which is a same-principal
 * rotation key). Missing ⇒ `blocked`.
 *
 * Unwitnessable halves, stated and not claimed: the entropy of `taskId` beyond
 * its length (a proxy), the TTL rule (§F.11), stdio `notifications/cancelled`
 * (a network suite cannot drive stdio), and the replay restatement (§E.8).
 *
 * @see spec/v2/core/interop.md §"MCP tasks and cancellation"
 * @see spec/v2/interop-map.json mcp.tasks
 * @see RFCS/0198-mcp-server-mount-tasks.md
 */
import { describe, it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { loadEnv } from '../lib/env.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite is the MCP client: every leg POSTs JSON-RPC to the mount the host advertises in mcp.serverUrls; nothing harness-hosted is handed to the host';

const DOC = 'spec/v2/core/interop.md §"MCP tasks and cancellation" (RFC 0198)';
const PROFILE = 'mcp-2026-07-28';
const REV = '2026-07-28';
const TASKS = 'io.modelcontextprotocol/tasks';
const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';
const INVALID_PARAMS = -32602;
const MISSING_CAPABILITY = -32021;
/** identity.md §5 tenant-bound id, after the one-segment projection is undone. */
const BOUND = /^[A-Za-z0-9._~-]{1,128}\/([A-Za-z0-9._~-]{16,128})$/;
/** 128 bits in the opaque alphabet (~6 bits/char) — a LENGTH proxy; the entropy itself is unwitnessable. */
const MIN_OPAQUE = 22;
/** Requirement ids (top-level literals: generate-requirement-registry reads them). */
const ID_ADVERTISED_VIA_DISCOVER = 'openwop.requirement.0198.advertised-via-discover';
const ID_DISCONNECT_CANCELS_RUN = 'openwop.requirement.0198.disconnect-cancels-run';
const ID_LISTEN_OMITS_UNREADABLE = 'openwop.requirement.0198.listen-omits-unreadable';
const ID_NO_SERVER_CANCELLED = 'openwop.requirement.0198.no-server-cancelled';
const ID_TASK_CANCEL_CANCELS_RUN = 'openwop.requirement.0198.task-cancel-cancels-run';
const ID_TASK_GET_READ_ONLY = 'openwop.requirement.0198.task-get-read-only';
const ID_TASK_ID_IS_RUN_ID = 'openwop.requirement.0198.task-id-is-run-id';
const ID_TASK_STATUS_PROJECTION = 'openwop.requirement.0198.task-status-projection';
const ID_TASK_SURVIVES_DISCONNECT = 'openwop.requirement.0198.task-survives-disconnect';
const ID_TASK_UNREADABLE_NOT_FOUND = 'openwop.requirement.0198.task-unreadable-not-found';
const ID_TASK_UPDATE_APPROVER_CHECKED = 'openwop.requirement.0198.task-update-approver-checked';
const ID_TASK_UPDATE_RESOLVES_ONCE = 'openwop.requirement.0198.task-update-resolves-once';
const ID_TASK_WHEN_NONTERMINAL = 'openwop.requirement.0198.task-when-nonterminal';
const TASK_CAPS = { elicitation: {}, extensions: { [TASKS]: {} } };

interface RpcError { code: number; message?: string; data?: unknown }
interface Rpc { status: number; headers: Headers; result?: Record<string, unknown> | undefined; error?: RpcError | undefined }
type Mount = { ok: true; url: string; facet: Record<string, unknown>; tasks: boolean } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

let rpcSeq = 1;
function envelope(method: string, params: Record<string, unknown>, caps: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: '2.0', id: rpcSeq++, method, params: { ...params, _meta: { [META_V]: REV, [META_C]: caps } } };
}
function headersFor(method: string, name: string | undefined, bearer: string | null | undefined, accept = 'application/json, text/event-stream'): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept, 'MCP-Protocol-Version': REV, 'Mcp-Method': method };
  if (name !== undefined) h['Mcp-Name'] = name;
  const key = bearer === undefined ? loadEnv().apiKey : bearer;
  if (key) h['authorization'] = `Bearer ${key}`;
  return h;
}

async function call(url: string, method: string, params: Record<string, unknown>, o: { caps?: Record<string, unknown>; bearer?: string | null; name?: string } = {}): Promise<Rpc> {
  const name = o.name ?? (typeof params['taskId'] === 'string' ? (params['taskId'] as string) : typeof params['name'] === 'string' ? (params['name'] as string) : undefined);
  const res = await fetch(url, { method: 'POST', headers: headersFor(method, name, o.bearer), body: JSON.stringify(envelope(method, params, o.caps ?? TASK_CAPS)) });
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: RpcError };
  return { status: res.status, headers: res.headers, ...body };
}

async function mount(): Promise<Mount> {
  if (!(await v2Discovery())) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const facet = await familyAdvertised('mcp');
  if (!facet) return { ok: false, kind: 'inapplicable', reason: 'mcp not advertised at major 2' };
  const profiles = Array.isArray(facet['profiles']) ? (facet['profiles'] as unknown[]) : [];
  if (facet['serverMount'] === undefined || !profiles.includes(PROFILE)) return { ok: false, kind: 'inapplicable', reason: 'mcp is advertised without serverMount + profile mcp-2026-07-28 — the host serves no MCP mount' };
  const urls = Array.isArray(facet['serverUrls']) ? (facet['serverUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
  if (urls.length === 0) return { ok: false, kind: 'blocked', reason: 'mcp.serverMount is advertised with no mcp.serverUrls[0] — the mount is unaddressable' };
  const u = urls[0]!;
  const url = /^https?:\/\//i.test(u) ? u : `${loadEnv().baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
  const d = await call(url, 'server/discover', {}, { caps: {} });
  const ext = (d.result?.['capabilities'] as { extensions?: Record<string, unknown> } | undefined)?.extensions;
  return { ok: true, url, facet, tasks: ext !== undefined && ext !== null && typeof ext === 'object' && TASKS in ext };
}

/** The task legs: the mount must serve the extension. */
async function taskMount(): Promise<{ url: string; facet: Record<string, unknown> } | undefined> {
  const m = await mount();
  if (!m.ok) return softSkip(m.kind, m.reason);
  if (!m.tasks) return softSkip('inapplicable', `the mount's server/discover does not list ${TASKS} — the host does not serve MCP Tasks (RFC 0198 §A is a MAY)`);
  return m;
}

function needFixtures(ids: string[]): string | null {
  const missing = ids.filter((id) => !isFixtureAdvertised(id));
  return missing.length === 0 ? null : `fixture(s) ${missing.join(', ')} not in the advertised fixtures[] — the leg calls them as tools`;
}

/** Undo the identity.md §5 one-segment projection (`~XX` → byte). */
function unproject(segment: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === '~' && /^[0-9A-Fa-f]{2}$/.test(segment.slice(i + 1, i + 3))) { bytes.push(parseInt(segment.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(...new TextEncoder().encode(segment[i] as string));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const createTask = (url: string, tool: string, args: Record<string, unknown> = {}): Promise<Rpc> => call(url, 'tools/call', { name: tool, arguments: args });
const taskGet = (url: string, taskId: string, bearer?: string | null): Promise<Rpc> => call(url, 'tasks/get', { taskId }, bearer === undefined ? {} : { bearer });

async function pollTask(url: string, taskId: string, until: (s: string) => boolean, timeoutMs: number): Promise<Rpc> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await taskGet(url, taskId);
    const s = String(r.result?.['status'] ?? '');
    if (r.error !== undefined || until(s) || Date.now() > deadline) return r;
    await new Promise((ok) => setTimeout(ok, 200));
  }
}

async function runStatus(runId: string): Promise<string | null> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}`);
  return r.status === 200 ? String((r.json as { status?: unknown } | null)?.status ?? '') : null;
}
async function waitRun(runId: string, wanted: ReadonlySet<string>, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await runStatus(runId);
    if ((s !== null && wanted.has(s)) || Date.now() > deadline) return s;
    await new Promise((ok) => setTimeout(ok, 200));
  }
}
interface Ev { type?: string; sequence?: number; payload?: Record<string, unknown> }
async function events(runId: string): Promise<Ev[]> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  return (r.json as { events?: Ev[] } | undefined)?.events ?? [];
}
async function listRunIds(workflowId: string): Promise<string[]> {
  const r = await driver.get(`/runs?workflowId=${encodeURIComponent(workflowId)}&limit=100`);
  return ((r.json as { runs?: Array<{ runId?: string }> } | undefined)?.runs ?? []).map((x) => String(x.runId));
}
async function freshRun(workflowId: string, before: ReadonlySet<string>, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fresh = (await listRunIds(workflowId)).filter((x) => !before.has(x));
    if (fresh.length > 0) return fresh[0]!;
    if (Date.now() > deadline) return null;
    await new Promise((ok) => setTimeout(ok, 100));
  }
}
async function runListGate(): Promise<string | null> {
  const f = await familyAdvertised('runList');
  if (!f) return 'runList not advertised — the suite has no black-box way to find a run the client never received a handle for';
  return null;
}

/** POST a JSON-RPC request over a raw socket and hand back the socket, so the leg decides when the connection dies. */
function rawPost(url: string, body: Record<string, unknown>, headers: Record<string, string>): { done: Promise<{ status: number; text: string }>; destroy: () => void; started: Promise<void> } {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  const fn = u.protocol === 'https:' ? httpsRequest : httpRequest;
  let destroyFn: () => void = () => undefined;
  let startedOk: () => void = () => undefined;
  const started = new Promise<void>((ok) => { startedOk = ok; });
  const done = new Promise<{ status: number; text: string }>((ok, fail) => {
    const r = fn(u, { method: 'POST', agent: false, headers: { ...headers, 'content-length': String(Buffer.byteLength(payload)) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { text += c; });
      res.on('end', () => ok({ status: res.statusCode ?? 0, text }));
      res.on('error', (e) => fail(e));
    });
    r.on('error', (e) => fail(e));
    r.on('socket', () => startedOk());
    destroyFn = () => r.destroy();
    r.end(payload);
  });
  return { done, destroy: () => destroyFn(), started };
}

/** Read an SSE response frame by frame (`data:` lines are JSON-RPC messages). */
async function* sseMessages(res: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
      const data = frame.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data.length > 0) { try { yield JSON.parse(data) as Record<string, unknown>; } catch { /* a non-JSON frame is not a JSON-RPC message */ } }
    }
  }
}

/** Open `subscriptions/listen` for task ids and return the acknowledgement plus anything received within `windowMs`. */
async function listen(url: string, taskIds: string[], bearer: string | undefined, windowMs: number): Promise<{ status: number; ack: Record<string, unknown> | null; after: Array<Record<string, unknown>>; error?: RpcError }> {
  const ac = new AbortController();
  const res = await fetch(url, { method: 'POST', signal: ac.signal, headers: headersFor('subscriptions/listen', undefined, bearer, 'text/event-stream, application/json'), body: JSON.stringify(envelope('subscriptions/listen', { notifications: { taskIds } }, TASK_CAPS)) });
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const body = (await res.json().catch(() => ({}))) as { error?: RpcError };
    return { status: res.status, ack: null, after: [], ...(body.error ? { error: body.error } : {}) };
  }
  let ack: Record<string, unknown> | null = null;
  const after: Array<Record<string, unknown>> = [];
  const timer = setTimeout(() => ac.abort(), windowMs);
  try {
    for await (const msg of sseMessages(res)) {
      if (ack === null && msg['method'] === 'notifications/subscriptions/acknowledged') ack = msg; else after.push(msg);
    }
  } catch { /* the leg's own abort ends the stream */ } finally { clearTimeout(timer); ac.abort(); }
  return { status: res.status, ack, after };
}
const ackedIds = (ack: Record<string, unknown> | null): string[] => {
  const n = (ack?.['params'] as { notifications?: { taskIds?: unknown } } | undefined)?.notifications?.taskIds;
  return Array.isArray(n) ? n.map(String) : [];
};

describe('RFC 0198 — v2-mcp-tasks (MCP Tasks on the server mount; disconnect cancels only the run it owns)', () => {
  it('a mount that lists the Tasks extension in server/discover also lists extensions in mcp.features', async () => {
    const m = await taskMount();
    if (!m) return;
    const features = Array.isArray(m.facet['features']) ? (m.facet['features'] as unknown[]).map(String) : [];
    expect(features, req(ID_ADVERTISED_VIA_DISCOVER, `${DOC}; RFC 0198 §A.1`, `server/discover lists ${TASKS}, so mcp.features[] MUST list \`extensions\` (one direction only, G9); advertised [${features.join(', ')}]`)).toContain('extensions');
  });

  it('a tools/call declaring the extension on a run that is not terminal is answered CreateTaskResult', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval', 'conformance-delay']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    expect(r.error, req(ID_TASK_WHEN_NONTERMINAL, `${DOC}; RFC 0198 §B.3`, `tools/call conformance-approval with the extension declared MUST be answered, not refused: ${JSON.stringify(r.error)}`)).toBeUndefined();
    expect(r.result?.['resultType'], req(ID_TASK_WHEN_NONTERMINAL, `${DOC}; RFC 0198 §B.3`, `a non-terminal run MUST be answered CreateTaskResult (resultType task), never InputRequiredResult; got ${JSON.stringify(r.result)}`)).toBe('task');
    expect(['working', 'input_required'], req(ID_TASK_WHEN_NONTERMINAL, 'interop-map.json mcp.tasks.status', `the seed status of a suspending run is working | input_required (got ${String(r.result?.['status'])})`)).toContain(r.result?.['status']);
    const taskId = String(r.result?.['taskId'] ?? '');
    const got = await taskGet(m.url, taskId);
    expect(got.error, req(ID_TASK_WHEN_NONTERMINAL, 'ext-tasks §Task Creation (durably created)', `a returned taskId MUST already resolve on tasks/get: ${JSON.stringify(got.error)}`)).toBeUndefined();
    // Upstream MUST NOT: a CreateTaskResult to a client that did not declare the extension.
    const plain = await call(m.url, 'tools/call', { name: 'conformance-delay', arguments: { delayMs: 200 } }, { caps: {} });
    expect(plain.result?.['resultType'], req(ID_TASK_WHEN_NONTERMINAL, 'ext-tasks §Capability Negotiation', `a tools/call that did not declare ${TASKS} MUST NOT be answered CreateTaskResult`)).not.toBe('task');
    const noCap = await call(m.url, 'tasks/get', { taskId }, { caps: {} });
    expect(noCap.error?.code, req(ID_TASK_WHEN_NONTERMINAL, 'interop-map.json mcp.tasks.fields clientCapabilities.extensions', `tasks/get without the extension declared MUST be -32021 (got ${JSON.stringify(noCap.error ?? noCap.result)})`)).toBe(MISSING_CAPABILITY);
    await call(m.url, 'tasks/cancel', { taskId });
  });

  it('taskId is the run id in its projected wire form, with an opaque segment of at least 22 characters', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    const runId = unproject(taskId);
    const match = BOUND.exec(runId);
    expect(match !== null, req(ID_TASK_ID_IS_RUN_ID, `${DOC}; identity.md §5`, `taskId MUST be the run's projected tenant-bound runId <tenantId>~2F<opaque> (got ${JSON.stringify(taskId)})`)).toBe(true);
    expect((match?.[1] ?? '').length, req(ID_TASK_ID_IS_RUN_ID, `${DOC}; RFC 0198 §C.5`, 'the opaque segment carries ≥128 bits (length ≥ 22 is the observable proxy; the entropy itself is unwitnessable)')).toBeGreaterThanOrEqual(MIN_OPAQUE);
    const run = await driver.get(`/runs/${encodeURIComponent(runId)}`);
    expect([run.status, (run.json as { workflowId?: string } | undefined)?.workflowId], req(ID_TASK_ID_IS_RUN_ID, `${DOC}; RFC 0198 §C.5`, `getRun(<taskId unprojected>) MUST be the run the call started (got ${run.status})`)).toEqual([200, 'conformance-approval']);
    await call(m.url, 'tasks/cancel', { taskId });
  });

  it('tasks/get projects input_required keyed by interruptId, and a failed run as completed with isError true', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval', 'conformance-failure']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    const t = await pollTask(m.url, taskId, (s) => s === 'input_required', 10_000);
    expect(t.result?.['status'], req(ID_TASK_STATUS_PROJECTION, 'interop-map.json mcp.tasks.status waiting-approval', `a waiting-approval run MUST read input_required (got ${JSON.stringify(t.error ?? t.result)})`)).toBe('input_required');
    expect(t.result?.['resultType'], req(ID_TASK_STATUS_PROJECTION, 'ext-tasks §Task Polling', 'tasks/get carries resultType complete')).toBe('complete');
    const requests = (t.result?.['inputRequests'] ?? {}) as Record<string, { method?: string }>;
    const suspended = (await events(unproject(taskId))).filter((e) => e.type === 'node.suspended').map((e) => String(e.payload?.['interruptId']));
    expect(Object.keys(requests), req(ID_TASK_STATUS_PROJECTION, 'interop-map.json mcp.tasks.status; RFC 0198 §D', `inputRequests MUST carry exactly one key per open interrupt, keyed by its interruptId (node.suspended ${JSON.stringify(suspended)})`)).toEqual(suspended);
    expect(requests[suspended[0] ?? '']?.method, req(ID_TASK_STATUS_PROJECTION, 'interop-map.json mcp.mrtr InputRequiredResult', 'the entry is projected as the MRTR row projects it (elicitation/create)')).toBe('elicitation/create');
    await call(m.url, 'tasks/cancel', { taskId });

    const f = await createTask(m.url, 'conformance-failure');
    let terminal: Rpc;
    if (f.result?.['resultType'] === 'task') terminal = await pollTask(m.url, String(f.result['taskId']), (s) => ['completed', 'failed', 'cancelled'].includes(s), 10_000);
    else return softSkip('inapplicable', 'conformance-failure finished before the host answered, so it was answered CallToolResult (RFC 0198 §B.4) — no task to project');
    expect([terminal.result?.['status'], (terminal.result?.['result'] as { isError?: unknown } | undefined)?.isError], req(ID_TASK_STATUS_PROJECTION, 'interop-map.json mcp.tasks.status failed; ext-tasks §Task Execution Errors', `a failed run is a tool outcome: completed with result.isError true, never failed (got ${JSON.stringify(terminal.result)})`)).toEqual(['completed', true]);
  });

  it('tasks/update answered twice resolves the interrupt once and the task completes', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    const t = await pollTask(m.url, taskId, (s) => s === 'input_required', 10_000);
    const key = Object.keys((t.result?.['inputRequests'] ?? {}) as Record<string, unknown>)[0];
    expect(key, req(ID_TASK_UPDATE_RESOLVES_ONCE, 'interop-map.json mcp.tasks.status', 'the approval task is input_required with one key')).toBeDefined();
    const answer = { inputResponses: { [key!]: { action: 'accept', content: { action: 'accept' } } } };
    const u1 = await call(m.url, 'tasks/update', { taskId, ...answer });
    const u2 = await call(m.url, 'tasks/update', { taskId, ...answer });
    expect([u1.error, u1.result?.['resultType'], u2.error, u2.result?.['resultType']], req(ID_TASK_UPDATE_RESOLVES_ONCE, 'interop-map.json mcp.tasks.methods tasks/update', `both updates MUST be acknowledged with an empty result — a repeat resolves nothing and is not an error (got ${JSON.stringify([u1.error ?? u1.result, u2.error ?? u2.result])})`)).toEqual([undefined, 'complete', undefined, 'complete']);
    const done = await pollTask(m.url, taskId, (s) => ['completed', 'failed', 'cancelled'].includes(s), 10_000);
    expect([done.result?.['status'], (done.result?.['result'] as { isError?: unknown } | undefined)?.isError], req(ID_TASK_UPDATE_RESOLVES_ONCE, 'interop-map.json mcp.tasks.status completed', `the accepted task completes with result.isError false (got ${JSON.stringify(done.result)})`)).toEqual(['completed', false]);
    const resolved = (await events(unproject(taskId))).filter((e) => e.type === 'interrupt.resolved');
    expect(resolved.length, req(ID_TASK_UPDATE_RESOLVES_ONCE, `${DOC}; RFC 0198 §E.7`, 'one interrupt is resolved at most once however often it is answered: exactly one interrupt.resolved')).toBe(1);
  });

  it('a tasks/update from a caller not in approversList resolves nothing', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval-approvers']);
    if (missing) return softSkip('blocked', missing);
    // The suite's bearer is not `urn:conformance:listed-approver`, so it is the non-listed resolver by construction.
    const r = await createTask(m.url, 'conformance-approval-approvers');
    const taskId = String(r.result?.['taskId'] ?? '');
    const t = await pollTask(m.url, taskId, (s) => s === 'input_required', 10_000);
    const key = Object.keys((t.result?.['inputRequests'] ?? {}) as Record<string, unknown>)[0];
    expect(key, req(ID_TASK_UPDATE_APPROVER_CHECKED, 'interop-map.json mcp.tasks.status', `the approvers task is input_required (got ${JSON.stringify(t.error ?? t.result)})`)).toBeDefined();
    const u = await call(m.url, 'tasks/update', { taskId, inputResponses: { [key!]: { action: 'accept', content: { action: 'accept' } } } });
    expect(u.error === undefined || u.error.code === INVALID_PARAMS, req(ID_TASK_UPDATE_APPROVER_CHECKED, 'interop-map.json mcp.tasks.methods tasks/update', `a non-approver's update is acknowledged or -32602, never an internal error (got ${JSON.stringify(u.error)})`)).toBe(true);
    await new Promise((ok) => setTimeout(ok, 750));
    expect(await runStatus(unproject(taskId)), req(ID_TASK_UPDATE_APPROVER_CHECKED, `${DOC}; interrupt.md §Approver enforcement; RFC 0198 §E.7`, 'the interrupt stays open: the run is still waiting-approval')).toBe('waiting-approval');
    expect((await events(unproject(taskId))).filter((e) => e.type === 'interrupt.resolved').length, req(ID_TASK_UPDATE_APPROVER_CHECKED, 'interrupt.md §Approver enforcement', 'no interrupt.resolved is recorded')).toBe(0);
    await call(m.url, 'tasks/cancel', { taskId });
  });

  it('tasks/get appends nothing to the run log', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    await pollTask(m.url, taskId, (s) => s === 'input_required', 10_000);
    const count = async (): Promise<number> => (await events(unproject(taskId))).filter((e) => !String(e.type).startsWith('heartbeat.')).length;
    const before = await count();
    for (let i = 0; i < 3; i++) { await taskGet(m.url, taskId); await new Promise((ok) => setTimeout(ok, 300)); }
    expect(await count(), req(ID_TASK_GET_READ_ONLY, `${DOC}; RFC 0198 §F.9`, 'the host MUST NOT append to a run\'s log to answer tasks/get (heartbeat.* excluded)')).toBe(before);
    await call(m.url, 'tasks/cancel', { taskId });
  });

  it('an unreadable task is answered -32602 exactly as a nonexistent one', async () => {
    const other = process.env['OPENWOP_TEST_TENANT_B_API_KEY'];
    if (!other) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-caller half cannot run');
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    const mine = await taskGet(m.url, taskId);
    expect(mine.error, req(ID_TASK_UNREADABLE_NOT_FOUND, 'interop-map.json mcp.tasks.methods tasks/get', 'positive control: the owner reads its own task')).toBeUndefined();
    const runId = unproject(taskId);
    const slash = runId.indexOf('/');
    const opaque = runId.slice(slash + 1);
    const tenant = runId.slice(0, slash);
    const fabricated = `${tenant}~2F${'Z'.repeat(opaque.length)}`;
    const foreign = `${tenant === 'conformance-foreign-tenant' ? 'conformance-foreign-tenant-2' : 'conformance-foreign-tenant'}~2F${opaque}`;
    const legs: Array<[string, Rpc]> = [
      ['fabricated same-tenant id', await taskGet(m.url, fabricated)],
      ['real opaque, tenant segment swapped', await taskGet(m.url, foreign)],
      ["tenant B reading tenant A's task", await taskGet(m.url, taskId, other)],
    ];
    for (const [what, g] of legs) {
      expect([g.error?.code, g.result], req(ID_TASK_UNREADABLE_NOT_FOUND, `${DOC}; interop.md §"The operation mappings" Isolation; RFC 0198 §C.6`, `${what}: MUST be -32602 with no result, exactly as a nonexistent task — never 403 / -32603 (got ${g.status} ${JSON.stringify(g.error ?? g.result)})`)).toEqual([INVALID_PARAMS, undefined]);
    }
    const shape = legs.map(([, g]) => JSON.stringify({ status: g.status, code: g.error?.code, message: g.error?.message, data: g.error?.data }));
    expect(new Set(shape).size, req(ID_TASK_UNREADABLE_NOT_FOUND, 'SECURITY/invariants.yaml mcp-task-tenant-scoped', `the three refusals MUST be indistinguishable (status, code, message, data): ${shape.join(' | ')}`)).toBe(1);
    const bCancel = await call(m.url, 'tasks/cancel', { taskId }, { bearer: other });
    expect(bCancel.error?.code, req(ID_TASK_UNREADABLE_NOT_FOUND, 'interop-map.json mcp.tasks.methods tasks/cancel', `tenant B cancelling tenant A's task MUST be -32602 (got ${JSON.stringify(bCancel.error ?? bCancel.result)})`)).toBe(INVALID_PARAMS);
    expect(await runStatus(runId), req(ID_TASK_UNREADABLE_NOT_FOUND, 'SECURITY/invariants.yaml mcp-task-tenant-scoped', 'possession of a taskId grants nothing: the run is untouched by the foreign cancel')).toBe('waiting-approval');
    await call(m.url, 'tasks/cancel', { taskId });
  });

  it("a subscriptions/listen acknowledgement leaves out a task the caller cannot read", async () => {
    const other = process.env['OPENWOP_TEST_TENANT_B_API_KEY'];
    if (!other) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-caller half cannot run');
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    const own = await listen(m.url, [taskId], undefined, 1500);
    if (own.error?.code === -32601 || (own.ack !== null && !ackedIds(own.ack).includes(taskId))) {
      await call(m.url, 'tasks/cancel', { taskId });
      return softSkip('inapplicable', 'the host does not deliver task status notifications on subscriptions/listen (optional upstream): it does not acknowledge even the owner\'s own task, so there is nothing for the cross-caller rule to bind');
    }
    expect(ackedIds(own.ack), req(ID_LISTEN_OMITS_UNREADABLE, 'interop-map.json mcp.tasks.methods notifications/tasks', `positive control: the owner's listen acknowledges its own task (got ${JSON.stringify(own.error ?? own.ack)})`)).toContain(taskId);
    const theirs = await listen(m.url, [taskId], other, 3000);
    expect(theirs.ack, req(ID_LISTEN_OMITS_UNREADABLE, 'subscriptions §Acknowledgment', `tenant B's listen is served (the acknowledgement is the first message) — got ${theirs.status} ${JSON.stringify(theirs.error)}`)).not.toBeNull();
    expect(ackedIds(theirs.ack), req(ID_LISTEN_OMITS_UNREADABLE, `${DOC}; RFC 0198 §C.6`, "a task id the caller cannot read MUST be left out of the acknowledgement, exactly as a nonexistent one")).toEqual([]);
    expect(theirs.after.filter((x) => x['method'] === 'notifications/tasks').length, req(ID_LISTEN_OMITS_UNREADABLE, 'SECURITY/invariants.yaml mcp-task-tenant-scoped', 'and never notified')).toBe(0);
    await call(m.url, 'tasks/cancel', { taskId });
  });

  it('tasks/cancel cancels the run; on a terminal task it is acknowledged and appends nothing', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const r = await createTask(m.url, 'conformance-approval');
    const taskId = String(r.result?.['taskId'] ?? '');
    await pollTask(m.url, taskId, (s) => s === 'input_required', 10_000);
    const c = await call(m.url, 'tasks/cancel', { taskId });
    expect([c.error, c.result?.['resultType']], req(ID_TASK_CANCEL_CANCELS_RUN, 'interop-map.json mcp.tasks.methods tasks/cancel', `tasks/cancel is acknowledged with an empty result (got ${JSON.stringify(c.error ?? c.result)})`)).toEqual([undefined, 'complete']);
    expect(await waitRun(unproject(taskId), new Set(['cancelled']), 10_000), req(ID_TASK_CANCEL_CANCELS_RUN, `${DOC}; RFC 0198 §F.10`, 'the run is cancelled as cancelRun would cancel it, within 10 s')).toBe('cancelled');
    const t = await taskGet(m.url, taskId);
    expect(t.result?.['status'], req(ID_TASK_CANCEL_CANCELS_RUN, 'interop-map.json mcp.tasks.status cancelled', 'tasks/get reads cancelled')).toBe('cancelled');
    const before = (await events(unproject(taskId))).length;
    const again = await call(m.url, 'tasks/cancel', { taskId });
    expect([again.error, again.result?.['resultType']], req(ID_TASK_CANCEL_CANCELS_RUN, 'interop-map.json mcp.tasks.methods tasks/cancel; RFC 0194 §A.2', `a cancel on a terminal task is acknowledged (got ${JSON.stringify(again.error ?? again.result)})`)).toEqual([undefined, 'complete']);
    expect((await events(unproject(taskId))).length, req(ID_TASK_CANCEL_CANCELS_RUN, 'RFC 0194 §A.2', 'and nothing is appended after the terminal event')).toBe(before);
  });

  it('a client disconnect before the host answers a task-less tools/call cancels the run it started', async () => {
    const m = await mount();
    if (!m.ok) return softSkip(m.kind, m.reason);
    const missing = needFixtures(['conformance-delay']);
    if (missing) return softSkip('blocked', missing);
    const gate = await runListGate();
    if (gate) return softSkip('inapplicable', gate);
    const before = new Set(await listRunIds('conformance-delay'));
    const p = rawPost(m.url, envelope('tools/call', { name: 'conformance-delay', arguments: { delayMs: 8000 } }, {}), headersFor('tools/call', 'conformance-delay', undefined));
    p.done.catch(() => undefined);
    const runId = await freshRun('conformance-delay', before, 3000);
    expect(runId, req(ID_DISCONNECT_CANCELS_RUN, 'interop-map.json mcp.methods tools/call', 'the task-less tools/call started a run listRuns shows')).not.toBeNull();
    await new Promise((ok) => setTimeout(ok, 500));
    p.destroy();
    const s = await waitRun(runId!, new Set(['cancelled', 'completed', 'failed']), 15_000);
    expect(s, req(ID_DISCONNECT_CANCELS_RUN, `${DOC}; RFC 0198 §G.12`, 'until the host has answered, the run belongs to the request: a streamable-HTTP disconnect MUST cancel it (not detach it)')).toBe('cancelled');
    const cancelled = (await events(runId!)).find((e) => e.type === 'run.cancelled');
    expect(cancelled?.payload?.['reason'], req(ID_DISCONNECT_CANCELS_RUN, `${DOC}; run-event-payloads runCancelled.reason`, 'run.cancelled.reason is mcp-request-cancelled')).toBe('mcp-request-cancelled');
  });

  it('a disconnect after CreateTaskResult never affects the run', async () => {
    const m = await taskMount();
    if (!m) return;
    const missing = needFixtures(['conformance-delay']);
    if (missing) return softSkip('blocked', missing);
    const p = rawPost(m.url, envelope('tools/call', { name: 'conformance-delay', arguments: { delayMs: 2500 } }, TASK_CAPS), { ...headersFor('tools/call', 'conformance-delay', undefined), connection: 'keep-alive' });
    const res = await p.done;
    p.destroy();
    const body = JSON.parse(res.text || '{}') as { result?: Record<string, unknown> };
    expect(body.result?.['resultType'], req(ID_TASK_SURVIVES_DISCONNECT, 'RFC 0198 §B.3', `a 2.5 s run is not terminal when the host answers: CreateTaskResult (got ${res.text.slice(0, 200)})`)).toBe('task');
    const taskId = String(body.result?.['taskId']);
    const done = await pollTask(m.url, taskId, (s) => ['completed', 'failed', 'cancelled'].includes(s), 15_000);
    expect(done.result?.['status'], req(ID_TASK_SURVIVES_DISCONNECT, `${DOC}; RFC 0198 §G.13`, 'once the response is sent, a disconnect MUST NOT affect the run: the task reads completed over a new connection')).toBe('completed');
  });

  it('a blocking tools/call on an SSE stream whose run is cancelled carries no notifications/cancelled and ends isError true', async () => {
    const m = await mount();
    if (!m.ok) return softSkip(m.kind, m.reason);
    const missing = needFixtures(['conformance-cancellable']);
    if (missing) return softSkip('blocked', missing);
    const gate = await runListGate();
    if (gate) return softSkip('inapplicable', gate);
    const before = new Set(await listRunIds('conformance-cancellable'));
    const ac = new AbortController();
    const resP = fetch(m.url, { method: 'POST', signal: ac.signal, headers: headersFor('tools/call', 'conformance-cancellable', undefined, 'text/event-stream, application/json'), body: JSON.stringify(envelope('tools/call', { name: 'conformance-cancellable', arguments: { delayMs: 20_000 } }, {})) });
    const runId = await freshRun('conformance-cancellable', before, 3000);
    expect(runId, req(ID_NO_SERVER_CANCELLED, 'interop-map.json mcp.methods tools/call', 'the tools/call started a run listRuns shows')).not.toBeNull();
    const res = await resP;
    if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      ac.abort();
      await driver.post(`/runs/${encodeURIComponent(runId!)}/cancel`, {});
      return softSkip('inapplicable', 'the mount answered the blocking call as JSON, not SSE — a JSON response cannot carry a notifications/cancelled frame');
    }
    const cancel = await driver.post(`/runs/${encodeURIComponent(runId!)}/cancel`, {});
    expect(cancel.status, req(ID_NO_SERVER_CANCELLED, 'runs.md §Cancel', `REST cancelRun is accepted (got ${cancel.status})`)).toBeLessThan(300);
    const msgs: Array<Record<string, unknown>> = [];
    const timer = setTimeout(() => ac.abort(), 15_000);
    try { for await (const msg of sseMessages(res)) msgs.push(msg); } catch { /* aborted at the deadline */ } finally { clearTimeout(timer); }
    expect(msgs.filter((x) => x['method'] === 'notifications/cancelled').length, req(ID_NO_SERVER_CANCELLED, `${DOC}; RFC 0198 §G.14; MCP cancellation (servers MUST NOT send notifications/cancelled for any other purpose)`, 'the host MUST NOT use notifications/cancelled to report that a run was cancelled')).toBe(0);
    const final = msgs.find((x) => 'result' in x || 'error' in x) as { result?: { isError?: unknown }; error?: unknown } | undefined;
    expect(final?.result?.isError, req(ID_NO_SERVER_CANCELLED, `${DOC}; RFC 0198 §G.14`, `a cancelled blocking call is answered CallToolResult { isError: true } (got ${JSON.stringify(final)})`)).toBe(true);
  });
});
