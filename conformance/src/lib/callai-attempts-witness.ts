/**
 * RFC 0248 — `ctx.callAI` reports its provider attempts and takes a per-call
 * retry policy. The rules are the `aiProviders.callAccounting` facet
 * descriptions (`spec/v2/facets/aiProviders.schema.json`).
 *
 * No seam. The suite runs the `conformance-callai-attempt-accounting` fixture
 * once per case. Its node makes one `ctx.callAI` call, the host's conformance
 * mock serves the case's `script` to that call's provider requests, and the
 * node echoes the result's `attempts`. The suite wrote the script, so it knows
 * what every request returned. Two normative surfaces corroborate it where the
 * host advertises them:
 *   - `provider.usage`: exactly one per provider invocation, with
 *     `outputTokens` (`events.md` §`providerUsage`);
 *   - `envelope.retry-exhausted.totalAttempts` (`events.md` §envelopes).
 *
 * The mock clamps each reported `outputTokens` to the `maxTokens` that request
 * carried and serves an over-budget entry as truncated (fixtures.md), so a
 * host that grows the budget against `growMaxTokens: false` shows on the log.
 *
 * Two halves, as in `table-schema-witness.ts`: {@link drive} observes and
 * asserts nothing; the `judge*` functions are pure.
 *
 * @see RFCS/0248-callai-attempt-accounting-and-retry-policy.md
 */

import { driver, type OpenWOPResponse } from './driver.js';
import { projectBoundId } from './bound-id.js';
import { readErrorCode } from './error-envelope.js';
import { isFixtureAdvertised } from './fixtures.js';

export const FIXTURE = 'conformance-callai-attempt-accounting';
export const NODE_ID = 'callai-echo';
const DOC_A = 'aiProviders.schema.json §callAccounting.attempts (RFC 0248 §A)';
const DOC_B = 'aiProviders.schema.json §callAccounting.retryPolicy (RFC 0248 §B)';

export interface ScriptEntry { readonly kind: 'invalid-json' | 'truncated' | 'valid'; readonly outputTokens?: number; readonly usage?: false; readonly structuredMode?: 'native' | 'prompt' }
export interface Case { readonly request: Record<string, unknown>; readonly script: readonly ScriptEntry[] }

const SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
const BUDGET = 100;
export const CASES = {
  /** §A.1/A.2: a schema violation, then a valid reply. */
  count: { request: { prompt: 'conformance', responseSchema: SCHEMA, maxTokens: BUDGET }, script: [{ kind: 'invalid-json', outputTokens: 10 }, { kind: 'valid', outputTokens: 20 }] },
  /** §A.2: one reply that reports no usage. */
  incomplete: { request: { prompt: 'conformance', maxTokens: BUDGET }, script: [{ kind: 'valid', usage: false }] },
  /** §A.3: no responseSchema, so no structuredOutput. */
  plain: { request: { prompt: 'conformance', maxTokens: BUDGET }, script: [{ kind: 'valid', outputTokens: 5 }] },
  /** §A.3: the mock declares native structured output. */
  native: { request: { prompt: 'conformance', responseSchema: SCHEMA, maxTokens: BUDGET }, script: [{ kind: 'valid', outputTokens: 5, structuredMode: 'native' }] },
  /** §B.1: one attempt allowed, and it is invalid. */
  cap: { request: { prompt: 'conformance', responseSchema: SCHEMA, maxTokens: BUDGET, retry: { maxAttempts: 1 } }, script: [{ kind: 'invalid-json', outputTokens: 10 }, { kind: 'valid', outputTokens: 20 }] },
  /** §B.2: truncated, then a reply that fits only a grown budget. */
  growth: { request: { prompt: 'conformance', responseSchema: SCHEMA, maxTokens: BUDGET, retry: { growMaxTokens: false } }, script: [{ kind: 'truncated', outputTokens: BUDGET }, { kind: 'valid', outputTokens: 150 }] },
  /** §B.5: maxAttempts out of range. */
  malformed: { request: { prompt: 'conformance', maxTokens: BUDGET, retry: { maxAttempts: 0 } }, script: [{ kind: 'valid', outputTokens: 5 }] },
} as const satisfies Record<string, Case>;
export type CaseName = keyof typeof CASES;

export interface CaseRun {
  readonly runId: string;
  readonly status: string;
  readonly attempts: Record<string, unknown> | undefined;
  readonly errorCode: string | null;
  readonly errorField: unknown;
  /** `provider.usage` payloads of the run (one node), in log order. */
  readonly usage: readonly Record<string, unknown>[];
  readonly exhaustedTotal: number | undefined;
  readonly startedSeq: number | undefined;
}

export interface Finding { readonly ok: boolean; readonly doc: string; readonly message: string }
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): Finding => ({ ok, doc, message });
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function terminal(runId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await http(() => driver.get(`/runs/${projectBoundId(runId)}`));
    const status = String((snap?.json as { status?: unknown } | undefined)?.status ?? '');
    if (TERMINAL.has(status)) return status;
    if (Date.now() > deadline) {
      await http(() => driver.post(`/runs/${projectBoundId(runId)}/cancel`, {}));
      return null;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Read one finished run's log into a CaseRun. Asserts nothing. */
export async function observe(runId: string, status: string): Promise<CaseRun | string> {
  const ev = await http(() => driver.get(`/runs/${projectBoundId(runId)}/events/poll?timeout=1`));
  const events = (ev?.json as { events?: unknown } | undefined)?.events;
  if (ev?.status !== 200 || !Array.isArray(events)) return `GET /runs/{runId}/events/poll answered ${ev?.status ?? 'nothing'}`;
  // The fixture has one node, so every event of the run is the echo node's.
  // `provider.usage.nodeId` is optional; filtering on it would blame a host
  // that omits it.
  const mine = (events as unknown[]).filter(isRec);
  const of = (type: string): Rec[] => mine.filter((e) => e['type'] === type).map((e) => (isRec(e['payload']) ? e['payload'] : {}));
  const completed = of('node.completed')[0];
  const outputs = isRec(completed?.['outputs']) ? completed['outputs'] : undefined;
  const failed = of('node.failed')[0];
  const error = isRec(failed?.['error']) ? failed['error'] : undefined;
  const details = isRec(error?.['details']) ? error['details'] : undefined;
  const exhausted = of('envelope.retry-exhausted')[0];
  const started = mine.find((e) => e['type'] === 'node.started');
  return {
    runId, status,
    attempts: isRec(outputs?.['attempts']) ? outputs['attempts'] : undefined,
    errorCode: typeof error?.['code'] === 'string' ? error['code'] : null,
    errorField: details?.['field'],
    usage: of('provider.usage'),
    exhaustedTotal: typeof exhausted?.['totalAttempts'] === 'number' ? exhausted['totalAttempts'] : undefined,
    startedSeq: typeof started?.['sequence'] === 'number' ? started['sequence'] : undefined,
  };
}

export type Drive = { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string } | { readonly kind: 'observed'; readonly run: CaseRun };

/** One fixture run of one case. Asserts nothing. */
export async function runCase(name: CaseName, timeoutMs = 60_000): Promise<Drive> {
  if (!isFixtureAdvertised(FIXTURE)) return { kind: 'skip', disposition: 'inapplicable', reason: `the host does not advertise fixture ${FIXTURE}` };
  const c = CASES[name];
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs: { request: c.request, script: c.script } }));
  if (created === null) return { kind: 'skip', disposition: 'blocked', reason: 'POST /runs unreachable (fetch failed)' };
  if (created.status === 429) return { kind: 'skip', disposition: 'blocked', reason: 'POST /runs answered 429 — the run budget, not the wire' };
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { kind: 'skip', disposition: 'blocked', reason: `POST /runs {workflowId: ${FIXTURE}} answered ${created.status} ${readErrorCode(created.json) ?? ''}`.trim() };
  const status = await terminal(runId, timeoutMs);
  if (status === null) return { kind: 'skip', disposition: 'blocked', reason: `the ${name} run did not reach a terminal status within ${timeoutMs} ms` };
  const run = await observe(runId, status);
  return typeof run === 'string' ? { kind: 'skip', disposition: 'blocked', reason: run } : { kind: 'observed', run };
}

/** Fork a finished run in replay mode from the node's start and read the fork. Asserts nothing. */
export async function replayOf(source: CaseRun, timeoutMs = 60_000): Promise<{ declined: number } | { run: CaseRun } | string> {
  if (source.startedSeq === undefined) return 'the source run has no node.started for the echo node';
  const res = await http(() => driver.post(`/runs/${projectBoundId(source.runId)}:fork`, { mode: 'replay', fromSeq: source.startedSeq }));
  if (res === null) return 'POST /runs/{runId}:fork unreachable (fetch failed)';
  if (res.status === 404 || res.status === 403 || res.status === 501) return { declined: res.status };
  const forkId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof forkId !== 'string') return `POST /runs/{runId}:fork answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim();
  const status = await terminal(forkId, timeoutMs);
  if (status === null) return `the replay fork did not reach a terminal status within ${timeoutMs} ms`;
  const run = await observe(forkId, status);
  return typeof run === 'string' ? run : { run };
}

const tokensOf = (script: readonly ScriptEntry[], i: number, budget: number): number => {
  const e = script[Math.min(i, script.length - 1)]!;
  return Math.min(e.outputTokens ?? 0, budget);
};
const intAtLeast = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;

const presence = (run: CaseRun): Finding[] => {
  const a = run.attempts;
  const out = [f(run.status === 'completed' && a !== undefined, DOC_A, `a completed ctx.callAI call MUST carry attempts on its result (run ${run.status}, attempts ${a === undefined ? 'absent' : 'present'})`)];
  if (a !== undefined) out.push(f(intAtLeast(a['count'], 1), DOC_A, `attempts.count MUST be an integer ≥ 1 (got ${JSON.stringify(a['count'])})`));
  return out;
};

/**
 * §A.1: the record's count equals the provider requests — one `provider.usage`
 * each where the host advertises it (`withUsageEvents`).
 */
export function judgeCount(run: CaseRun, withUsageEvents: boolean): Finding[] {
  const out = presence(run);
  const count = run.attempts?.['count'];
  if (!intAtLeast(count, 1)) return out;
  if (withUsageEvents) out.push(f(run.usage.length === count, DOC_A, `attempts.count MUST equal the provider requests, one provider.usage each (events.md §providerUsage): ${run.usage.length} provider.usage vs count ${count}`));
  return out;
}

/**
 * §A.2: `outputTokens` is the sum over the requests the script served, equals
 * the summed `provider.usage` where advertised, and `usageComplete` is true
 * because every scripted reply reported usage.
 */
export function judgeSum(run: CaseRun, c: Case, withUsageEvents: boolean): Finding[] {
  const out = presence(run);
  const a = run.attempts;
  const count = a?.['count'];
  if (a === undefined || !intAtLeast(count, 1)) return out;
  const budget = typeof c.request['maxTokens'] === 'number' ? (c.request['maxTokens'] as number) : Number.MAX_SAFE_INTEGER;
  const want = Array.from({ length: count }, (_, i) => tokensOf(c.script, i, budget)).reduce((x, y) => x + y, 0);
  out.push(f(a['usageComplete'] === true, DOC_A, `every scripted request reported usage, so usageComplete MUST be true (got ${JSON.stringify(a['usageComplete'])})`));
  out.push(f(a['outputTokens'] === want, DOC_A, `attempts.outputTokens MUST be the sum over the ${count} requests the script served (want ${want}, got ${JSON.stringify(a['outputTokens'])})`));
  if (withUsageEvents) {
    const sum = run.usage.reduce((x, u) => x + (typeof u['outputTokens'] === 'number' ? u['outputTokens'] : 0), 0);
    out.push(f(sum === a['outputTokens'], DOC_A, `attempts.outputTokens MUST equal the summed provider.usage.outputTokens (${sum} vs ${JSON.stringify(a['outputTokens'])})`));
  }
  return out;
}

/** §A.2: a request that reported no usage makes usageComplete false. */
export function judgeIncomplete(run: CaseRun): Finding[] {
  const a = run.attempts;
  if (run.status !== 'completed' || a === undefined) return [f(false, DOC_A, `a completed ctx.callAI call MUST carry attempts (run ${run.status})`)];
  return [f(a['usageComplete'] === false, DOC_A, `a request that reported no usage MUST make usageComplete false (got ${JSON.stringify(a['usageComplete'])})`)];
}

/** §A.3: absent without responseSchema; the declared mode with one. */
export function judgeStructuredOutput(plain: CaseRun, native: CaseRun): Finding[] {
  const out: Finding[] = [];
  for (const [run, label] of [[plain, 'plain'], [native, 'native']] as const) {
    if (run.status !== 'completed' || run.attempts === undefined) out.push(f(false, DOC_A, `the ${label} call MUST complete with attempts (run ${run.status})`));
  }
  if (plain.attempts !== undefined) out.push(f(plain.attempts['structuredOutput'] === undefined, DOC_A, `without responseSchema attempts.structuredOutput MUST be absent (got ${JSON.stringify(plain.attempts['structuredOutput'])})`));
  if (native.attempts !== undefined) out.push(f(native.attempts['structuredOutput'] === 'native', DOC_A, `the final request used the mock's native structured output, so structuredOutput MUST be "native" (got ${JSON.stringify(native.attempts['structuredOutput'])})`));
  return out;
}

/** §B.1: maxAttempts 1 with an invalid first reply — one request, then failure. */
export function judgeCap(run: CaseRun, withUsageEvents: boolean): Finding[] {
  const out: Finding[] = [f(run.status === 'failed', DOC_B, `with maxAttempts 1 and an invalid first reply the call MUST fail, since a completion needs a second request (run ${run.status})`)];
  out.push(f(run.errorCode !== 'validation_error', DOC_B, 'a well-formed retry policy MUST NOT be refused as validation_error'));
  if (withUsageEvents) out.push(f(run.usage.length <= 1, DOC_B, `the host MUST NOT send more than maxAttempts provider requests: ${run.usage.length} provider.usage for maxAttempts 1`));
  if (run.exhaustedTotal !== undefined) out.push(f(run.exhaustedTotal === 1, DOC_B, `envelope.retry-exhausted.totalAttempts MUST be 1 under maxAttempts 1 (got ${run.exhaustedTotal})`));
  return out;
}

/**
 * §B.2: growMaxTokens false. The second reply fits only a grown budget, so a
 * host that keeps the budget never completes, and every reported attempt stays
 * within it.
 */
export function judgeNoGrowth(run: CaseRun, withUsageEvents: boolean): Finding[] {
  const out: Finding[] = [f(run.status !== 'completed', DOC_B, `under growMaxTokens false the over-budget reply MUST stay truncated, so the call MUST NOT complete — completing means an attempt's maxTokens exceeded ${BUDGET}`)];
  out.push(f(run.errorCode !== 'validation_error', DOC_B, 'a well-formed retry policy MUST NOT be refused as validation_error'));
  if (withUsageEvents) {
    const over = run.usage.map((u) => u['outputTokens']).filter((t) => typeof t === 'number' && t > BUDGET);
    out.push(f(over.length === 0, DOC_B, `no attempt MAY exceed the request's maxTokens ${BUDGET} under growMaxTokens false (provider.usage outputTokens over it: ${JSON.stringify(over)})`));
  }
  return out;
}

/** §B.5: a malformed retry is refused validation_error naming the key. */
export function judgeMalformed(run: CaseRun): Finding[] {
  return [
    f(run.status === 'failed' && run.errorCode === 'validation_error', DOC_B, `retry.maxAttempts 0 MUST be refused with validation_error, never ignored (run ${run.status} ${run.errorCode ?? ''})`.trim()),
    f(run.errorField === 'retry.maxAttempts', DOC_B, `the refusal MUST name the key in details.field (got ${JSON.stringify(run.errorField)})`),
  ];
}

/** §A.5: a replay fork reproduces the recorded attempts. */
export function judgeReplayed(source: CaseRun, fork: CaseRun): Finding[] {
  return [
    f(fork.status === 'completed' && fork.attempts !== undefined, DOC_A, `the replay fork MUST complete with attempts (fork ${fork.status})`),
    f(JSON.stringify(fork.attempts) === JSON.stringify(source.attempts), DOC_A, `on replay attempts MUST equal the recorded value (source ${JSON.stringify(source.attempts)}, fork ${JSON.stringify(fork.attempts)})`),
  ];
}
