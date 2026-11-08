/**
 * v2 — a declared, bounded loopback from an approval gate back to the node it
 * reviews (RFC 0258; the rules are `$defs/EdgeLoopback` in
 * `schemas/v2/workflow-definition.schema.json`, `$defs/nodeCompleted.loopback`
 * and `$defs/workflowLoopbackLimit` in `run-event-payloads.schema.json`,
 * `$defs/ApprovalData.loopback` in `suspend-request.schema.json`, and the
 * `loopback` family in `spec/v2/facets/loopback.schema.json`).
 *
 * Server-free (always on):
 *   1. `0258.shape` — `EdgeLoopback` requires `on` and `maxIterations >= 1`,
 *      admits only `on: "refine"`, and a loopback edge carries no condition,
 *      port or trigger rule; the marker, `ApprovalData.loopback`, the new
 *      `cap.breached` kind and the facet floor (`maxHistoryEntryBytes >= 4096`)
 *      validate as declared.
 *
 * Host legs — gated on the `loopback` family and on each fixture in discovery
 * `fixtures[]` (unadvertised → `inapplicable`); judges in
 * `lib/bounded-loopback-witness.ts`. One `conformance-loopback-refine` run is
 * driven through two refines, a refused third refine and an accept, and legs
 * 2–5 read it at the points they name.
 *   2. `0258.refine-rearms` — after one refine: the marker, a second visit of
 *      `draft`, a second request under a new key, `apply` not started.
 *   3. `0258.history-from-log` — `draft` (core.identity, echoes its inputs)
 *      shows `rounds`: `[]`, then one exact entry per round, oldest first.
 *   4. `0258.approval-data-loopback` — the three requests read `{0,2,false}`,
 *      `{1,2,false}`, `{2,2,true}`.
 *   5. `0258.withdraw-refine` — the exhausted visit omits `refine`, a refine
 *      resume answers `400 validation_error` with the run still waiting, and
 *      accept completes the run with `apply` run once.
 *   6. `0258.fail-on-exhausted` — `conformance-loopback-refine-fail`: a refine
 *      on the exhausted visit emits `workflow.loopback-limit`, `cap.breached`
 *      and `run.failed` (`loop_limit_exceeded`, `failedNodeId: gate`).
 *   7. `0258.replay-rearms` — gated also on `replay.modes ∋ replay`: a replay
 *      fork whose prefix ends at round 1's marked completion asks the gate
 *      again without deciding round 1 again.
 *
 * §B's admission refusals are not legs: v2 has no operation through which a
 * client submits a definition (no workflow registration, no inline definition
 * on createRun), so a host's refusal is not observable on the wire (RFC 0258
 * §Falsifiability).
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { gateFamily, v2RefValidator } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import { judgeApprovalData, judgeFailExhausted, judgeHistory, judgeRearm, judgeReplayRearm, judgeWithdrawn, markersOf, requestsOf, type Ev, type LoopFinding } from '../lib/bounded-loopback-witness.js';

const DOC = 'workflow-definition.schema.json $defs/EdgeLoopback; run-event-payloads.schema.json $defs/nodeCompleted.loopback (RFC 0258)';
const R = (slug: string): string => `openwop.requirement.0258.${slug}`;
const REFINE = 'conformance-loopback-refine';
const FAIL = 'conformance-loopback-refine-fail';
const GATE = 'gate';
const REARM = { gate: GATE, target: 'draft', edgeId: 'again', region: ['draft', 'gate'], forward: 'apply' };
const FB = [{ scope: 'whole', text: 'conformance round one: shorter' }, { scope: 'whole', text: 'conformance round two: darker' }];

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

async function logOf(runId: string): Promise<Ev[]> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (res?.json as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? (events as Ev[]).filter((e) => typeof e.sequence === 'number').sort((a, b) => (a.sequence as number) - (b.sequence as number)) : [];
}
const TERMINAL = /^run\.(completed|failed|cancelled)$/;

/** Poll until `done(log)` holds, or the bound passes; the log either way. */
async function until(runId: string, done: (log: Ev[]) => boolean): Promise<{ log: Ev[]; ok: boolean }> {
  const deadline = Date.now() + scaledTimeoutMs(20_000);
  for (;;) {
    const log = await logOf(runId);
    if (done(log)) return { log, ok: true };
    if (Date.now() > deadline || log.some((e) => typeof e.type === 'string' && TERMINAL.test(e.type))) return { log, ok: done(log) };
    await new Promise((r) => setTimeout(r, 250));
  }
}
const asked = (n: number) => (log: Ev[]): boolean => requestsOf(log, GATE).length >= n;
const resolve = (runId: string, resumeValue: unknown): Promise<OpenWOPResponse | null> => http(() => driver.post(`/runs/${enc(runId)}/interrupts/${enc(GATE)}`, { resumeValue }));
const refine = (runId: string, i: number): Promise<OpenWOPResponse | null> => resolve(runId, { action: 'refine', refineFeedback: FB[i] });

type Gate = { skip: ['inapplicable', string] } | { maxIterations: number };
async function gateLoopback(fixture: string, needIterations: number): Promise<Gate> {
  if (!isFixtureAdvertised(fixture)) return { skip: ['inapplicable', `fixture ${fixture} is not advertised`] };
  const fam = await gateFamily('loopback');
  if (!fam) return { skip: ['inapplicable', 'loopback family not advertised (gate recorded under openwop.family.loopback)'] };
  const max = fam['maxIterations'];
  if (typeof max !== 'number' || max < needIterations) return { skip: ['inapplicable', `loopback.maxIterations ${String(max)} is below the fixture's ${needIterations}`] };
  return { maxIterations: max };
}

interface Drive { runId: string; afterOne: Ev[]; atExhausted: Ev[]; refusedStatus: number | undefined; refusedCode: string | undefined; statusAfterRefusal: unknown; final: Ev[] }
let shared: Promise<Drive | { reason: string }> | undefined;
/** The one `conformance-loopback-refine` run legs 2–5 read. */
function drive(): Promise<Drive | { reason: string }> {
  shared ??= (async () => {
    const created = await http(() => driver.post('/runs', { workflowId: REFINE }));
    const runId = (created?.json as { runId?: unknown } | null)?.runId;
    if (created === null || created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs (${REFINE}) answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim() };
    if (!(await until(runId, asked(1))).ok) return { reason: `the ${REFINE} run never asked its gate` };
    const r1 = await refine(runId, 0);
    if (r1?.status !== 200) return { reason: `the first refine answered ${r1?.status ?? 'nothing'} ${readErrorCode(r1?.json) ?? ''}`.trim() };
    const one = await until(runId, asked(2));
    if (!one.ok) return { reason: 'the gate was not asked a second time after one refine (no re-arm)' };
    const r2 = await refine(runId, 1);
    if (r2?.status !== 200) return { reason: `the second refine answered ${r2?.status ?? 'nothing'} ${readErrorCode(r2?.json) ?? ''}`.trim() };
    const two = await until(runId, asked(3));
    if (!two.ok) return { reason: 'the gate was not asked a third time after two refines' };
    const r3 = await resolve(runId, { action: 'refine', refineFeedback: { scope: 'whole', text: 'conformance: past the cap' } });
    const snap = await http(() => driver.get(`/runs/${enc(runId)}`));
    const status = (snap?.json as { status?: unknown } | null)?.status;
    const acc = await resolve(runId, { action: 'accept' });
    if (acc?.status !== 200) return { reason: `accept answered ${acc?.status ?? 'nothing'} ${readErrorCode(acc?.json) ?? ''}`.trim() };
    const end = await until(runId, (log) => log.some((e) => typeof e.type === 'string' && TERMINAL.test(e.type)));
    return { runId, afterOne: one.log, atExhausted: two.log, refusedStatus: r3?.status, refusedCode: readErrorCode(r3?.json), statusAfterRefusal: status, final: end.log };
  })();
  return shared;
}

function expectAll(id: string, findings: readonly LoopFinding[]): void {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
}

describe('v2 RFC 0258 — bounded loopback wire shape (server-free)', () => {
  it('EdgeLoopback, the marker, ApprovalData.loopback, the cap kind and the facet validate as declared', () => {
    const edge = v2RefValidator('workflow-definition.schema.json#/$defs/WorkflowEdge');
    const base = { id: 'again', sourceNodeId: 'gate', targetNodeId: 'draft' };
    expect(edge({ ...base, loopback: { on: 'refine', maxIterations: 3, historyInput: 'rounds' } }).ok, req(R('shape'), DOC, 'a loopback edge MUST validate')).toBe(true);
    expect(edge({ ...base, loopback: { on: 'refine' } }).ok, req(R('shape'), DOC, 'maxIterations is required')).toBe(false);
    expect(edge({ ...base, loopback: { on: 'refine', maxIterations: 0 } }).ok, req(R('shape'), DOC, 'maxIterations has minimum 1')).toBe(false);
    expect(edge({ ...base, loopback: { on: 'reject', maxIterations: 2 } }).ok, req(R('shape'), DOC, 'on admits only refine')).toBe(false);
    expect(edge({ ...base, loopback: { on: 'refine', maxIterations: 2, onExhausted: 'retry' } }).ok, req(R('shape'), DOC, 'onExhausted is withdraw or fail')).toBe(false);
    for (const extra of [{ condition: { type: 'truthy', left: 'approved' } }, { sourceOutput: 'output' }, { targetInput: 'input' }, { triggerRule: 'all_success' }]) {
      expect(edge({ ...base, ...extra, loopback: { on: 'refine', maxIterations: 2 } }).ok, req(R('shape'), DOC, `a loopback edge MUST NOT carry ${Object.keys(extra)[0]}`)).toBe(false);
    }
    expect(edge({ ...base, condition: { type: 'truthy', left: 'approved' } }).ok, req(R('shape'), DOC, 'a plain edge with a condition still validates')).toBe(true);
    const done = v2RefValidator('run-event-payloads.schema.json#/$defs/nodeCompleted');
    expect(done({ nodeId: 'gate', loopback: { edgeId: 'again', targetNodeId: 'draft', round: 1, rearmed: ['draft', 'gate'] } }).ok, req(R('shape'), DOC, 'the marker MUST validate')).toBe(true);
    expect(done({ nodeId: 'gate', loopback: { edgeId: 'again', targetNodeId: 'draft', round: 0, rearmed: ['draft', 'gate'] } }).ok, req(R('shape'), DOC, 'round has minimum 1')).toBe(false);
    expect(done({ nodeId: 'gate', loopback: { edgeId: 'again', targetNodeId: 'draft', round: 1, rearmed: ['gate'] } }).ok, req(R('shape'), DOC, 'rearmed holds at least the target and the gate')).toBe(false);
    const approval = v2RefValidator('suspend-request.schema.json#/$defs/ApprovalData');
    const data = { artifactId: 'a', artifactType: 'text', title: 't', actions: ['accept', 'refine'] };
    expect(approval({ ...data, loopback: { round: 0, maxIterations: 2, exhausted: false } }).ok, req(R('shape'), DOC, 'ApprovalData.loopback MUST validate')).toBe(true);
    expect(approval({ ...data, loopback: { round: 0, maxIterations: 2 } }).ok, req(R('shape'), DOC, 'exhausted is required')).toBe(false);
    const cap = v2RefValidator('run-event-payloads.schema.json#/$defs/capBreached');
    expect(cap({ kind: 'loopback-iterations', limit: 2, observed: 3 }).ok, req(R('shape'), DOC, 'cap.breached admits kind loopback-iterations')).toBe(true);
    const facet = v2RefValidator('capabilities.schema.json#/properties/loopback');
    const rec = { status: 'stable', since: '2.46', witness: 'witnessable-gated', maxIterations: 3 };
    expect(facet({ ...rec, maxHistoryEntryBytes: 65536 }).ok, req(R('shape'), DOC, 'the loopback record MUST validate')).toBe(true);
    expect(facet({ ...rec, maxHistoryEntryBytes: 1 }).ok, req(R('shape'), DOC, 'maxHistoryEntryBytes has minimum 4096')).toBe(false);
    expect(facet(rec).ok, req(R('shape'), DOC, 'maxHistoryEntryBytes is required')).toBe(false);
  });
});

describe('v2 RFC 0258 — bounded loopback (host)', () => {
  it('a refine re-arms the region: the marker, a new visit of the target, a new key, nothing released forward', async () => {
    const g = await gateLoopback(REFINE, 2);
    if ('skip' in g) return softSkip(...g.skip);
    const d = await drive();
    if ('reason' in d) return softSkip('blocked', d.reason);
    expectAll(R('refine-rearms'), judgeRearm(d.afterOne, REARM));
  }, 120_000);

  it('the target receives the round history rebuilt from the log, with no run-scoped bytes', async () => {
    const g = await gateLoopback(REFINE, 2);
    if ('skip' in g) return softSkip(...g.skip);
    const d = await drive();
    if ('reason' in d) return softSkip('blocked', d.reason);
    expectAll(R('history-from-log'), judgeHistory(d.atExhausted, { target: 'draft', port: 'rounds', feedback: FB }));
  }, 120_000);

  it('each visit of the gate carries ApprovalData.loopback {round, maxIterations, exhausted}', async () => {
    const g = await gateLoopback(REFINE, 2);
    if ('skip' in g) return softSkip(...g.skip);
    const d = await drive();
    if ('reason' in d) return softSkip('blocked', d.reason);
    expectAll(R('approval-data-loopback'), judgeApprovalData(d.atExhausted, GATE, [
      { round: 0, maxIterations: 2, exhausted: false }, { round: 1, maxIterations: 2, exhausted: false }, { round: 2, maxIterations: 2, exhausted: true },
    ]));
  }, 120_000);

  it('the exhausted visit withdraws refine, refuses a refine resume, and accept completes the run', async () => {
    const g = await gateLoopback(REFINE, 2);
    if ('skip' in g) return softSkip(...g.skip);
    const d = await drive();
    if ('reason' in d) return softSkip('blocked', d.reason);
    expectAll(R('withdraw-refine'), judgeWithdrawn(d.atExhausted, GATE));
    expect(d.refusedStatus, req(R('withdraw-refine'), DOC, 'a refine resume on the exhausted visit MUST answer 400')).toBe(400);
    expect(d.refusedCode, req(R('withdraw-refine'), DOC, 'the refusal MUST carry validation_error')).toBe('validation_error');
    expect(d.statusAfterRefusal, req(R('withdraw-refine'), DOC, 'the refused refine MUST leave the run waiting-approval')).toBe('waiting-approval');
    expect(d.final.some((e) => e.type === 'run.completed'), req(R('withdraw-refine'), DOC, 'accept MUST complete the run')).toBe(true);
    expect(d.final.filter((e) => e.type === 'node.started' && (e.nodeId ?? e.payload?.['nodeId']) === 'apply').length, req(R('withdraw-refine'), DOC, 'apply MUST run exactly once, after accept')).toBe(1);
  }, 120_000);

  it('under onExhausted: fail, a refine on the exhausted visit fails the run with loop_limit_exceeded', async () => {
    const g = await gateLoopback(FAIL, 1);
    if ('skip' in g) return softSkip(...g.skip);
    const created = await http(() => driver.post('/runs', { workflowId: FAIL }));
    const runId = (created?.json as { runId?: unknown } | null)?.runId;
    if (created === null || created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs (${FAIL}) answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim());
    if (!(await until(runId, asked(1))).ok) return softSkip('blocked', `the ${FAIL} run never asked its gate`);
    const r1 = await refine(runId, 0);
    if (r1?.status !== 200) return softSkip('blocked', `the first refine answered ${r1?.status ?? 'nothing'}`);
    if (!(await until(runId, asked(2))).ok) return softSkip('blocked', 'the gate was not asked again after one refine (no re-arm)');
    await refine(runId, 1);
    const end = await until(runId, (log) => log.some((e) => typeof e.type === 'string' && TERMINAL.test(e.type)));
    if (!end.ok) return softSkip('blocked', `the ${FAIL} run logged no terminal event within the bound`);
    expectAll(R('fail-on-exhausted'), judgeFailExhausted(end.log, GATE, 1));
  }, 120_000);

  it('a replay fork at round 1\'s marked completion re-arms and asks the gate again', async () => {
    const g = await gateLoopback(REFINE, 2);
    if ('skip' in g) return softSkip(...g.skip);
    const replay = await gateFamily('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');
    if (!(Array.isArray(replay['modes']) && replay['modes'].includes('replay'))) return softSkip('inapplicable', 'replay.modes does not list replay');
    const d = await drive();
    if ('reason' in d) return softSkip('blocked', d.reason);
    const mark = markersOf(d.final, GATE)[0];
    if (typeof mark?.sequence !== 'number') return softSkip('blocked', 'the source run logged no marked gate completion to fork from');
    const fromSeq = mark.sequence + 1;
    const fork = await http(() => driver.post(`/runs/${enc(d.runId)}:fork`, { mode: 'replay', fromSeq }));
    const forkId = (fork?.json as { runId?: unknown } | null)?.runId;
    if (fork === null || fork.status !== 201 || typeof forkId !== 'string') return softSkip('blocked', `POST /runs/{runId}:fork answered ${fork?.status ?? 'nothing'} ${readErrorCode(fork?.json) ?? ''} — forkRun owns that contract`.trim());
    const k = await until(forkId, (log) => requestsOf(log, GATE).some((e) => typeof e.sequence === 'number' && e.sequence >= fromSeq));
    expectAll(R('replay-rearms'), judgeReplayRearm(k.log, GATE, fromSeq));
  }, 120_000);
});
