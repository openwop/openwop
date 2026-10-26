/**
 * v2 — eval suites grade the tool path, run repeated trials, and fail closed
 * on a fixture miss (RFC 0244; the rules are the `agents.evalSuite` facet
 * description in `spec/v2/facets/agents.schema.json` and the
 * `agent-eval-suite` / `eval-summary` / `run-event-payloads` descriptions).
 *
 * Server-free legs (always on):
 *   1. The RFC 0244 suite, summary and `eval.scored` / `eval.started` fields
 *      validate, and the RFC's negatives are refused — including the
 *      content-free ones that are the v2 public test for SECURITY invariant
 *      `eval-summary-no-content-leak` (a trajectory block naming a tool, a
 *      prose `scoreLabel`).
 *   2. The three eval-suite fixtures validate against the v2 suite schema.
 *
 * Host legs (gated on the facet member AND the fixture in discovery
 * `fixtures`). Each fixture is an `AgentEvalSuite` under
 * `fixtures/eval-suites/`, run against the scripted agent
 * `core.conformance.agents.scripted` (contract in `fixtures.md`): every task's
 * `input.script` is replayed as tool calls, so the trajectory is known to the
 * suite in advance and the host's grade is checked against the reference
 * grader in `lib/eval-trajectory.ts`, not against itself.
 *   3. `conformance-eval-trajectory` — per-task `passed` and the trajectory
 *      counts equal the reference grade; the log carries the scripted calls.
 *   4. `conformance-eval-trials` — `trialCount` on `eval.started`, one
 *      `eval.scored` per task per trial with contiguous `trialIndex`, and the
 *      per-task `trials` block and `trialStats` equal the §B formulas.
 *   5. `conformance-eval-fixture-miss` — the missed task reports
 *      `fixtureMissCount: 1`, `passed: false` and `score: 0` (summary and
 *      every `eval.scored`); the served one passes.
 *      That no live tool ran is seam-gated (RFC 0244 G2) and not asserted.
 *   6. Refusal — a host advertising `agents.evalSuite` without `trials` that
 *      lists `conformance-eval-trials` refuses it at createRun with
 *      `400 validation_error`.
 *   6a. §C efficiency (2.46.25) — on the trajectory run, and on the trials run
 *      when served, each task's `efficiency.toolCallCount` equals its script
 *      length (the mean over identical trials), and on the one-trial run the
 *      counts sum to the log's `agent.tool-called` events. `efficiency` is
 *      optional, so a host that reports none records `inapplicable`. Judge in
 *      `lib/eval-efficiency-witness.ts`.
 *   6d. §C never-gated (2.46.27), `conformance-eval-efficiency-ungated`: two
 *      tasks with one output and one expectation, `lean` (1 scripted call) and
 *      `busy` (8). `busy` passes and scores what `lean` scores, and the suite
 *      passes at `passScore` 1 (`0244.efficiency-never-gated`). `blocked` when
 *      the calls never ran or `lean` itself fails. Gated on `agents.evalSuite`
 *      and the fixture only: the rule binds whether or not a host reports
 *      `efficiency`.
 *   6e. §B trial isolation (2.46.27, G3), `conformance-eval-memory-isolation`,
 *      gated on `trials`: two trials of read seed, read note, write note, read
 *      note through the reserved memory tool `conformance.eval:memory`. Every
 *      trial reads the seed, and each trial's first note read finds nothing
 *      (`0244.trial-memory-isolated`); a tool whose writes never read back is
 *      `blocked`. Judge in `lib/eval-memory-witness.ts`.
 *   6c. §C model usage and §B cost (2.46.26), on the same runs. The per-task
 *      `modelCallCount`, `inputTokens` and `outputTokens`, times the trial
 *      count, sum to the agent's `provider.usage` inside its
 *      `agent.invocation.*` brackets (judge and delegate calls excluded), or do
 *      not exceed the run's usage when the host emits no brackets
 *      (`0244.efficiency-model-usage`). On the trials run, `totalCostUsd` is
 *      at least the agent's priced usage over all three trials
 *      (`0244.cost-every-trial`). The scripted agent need not call a model, so
 *      a run with no usage, no brackets or no prices records `inapplicable`.
 *   6b. §D through the counter tool `conformance.eval:counter` (2.46.25, G2),
 *      gated on `fixtureMatching` and both counter fixtures in discovery.
 *      Three sequential runs: `conformance-eval-counter-live` (A), then
 *      `conformance-eval-counter-miss` (B), then the live suite again (C).
 *      `0244.live-miss-counted` (A's misses ran live and are counted),
 *      `0244.first-unconsumed` (B serves `{served: 1}`, `{served: 2}`, then a
 *      tool error), `0244.miss-no-live-call` (the live counters B's misses
 *      touched read the same in C as in A, once C proves the state persisted).
 *      Judges in `lib/eval-counter-witness.ts`.
 *
 * RFC 0081 §C, on the `conformance-eval-trajectory` run (2.46.20). Judges in
 * `lib/eval-envelope-witness.ts`.
 *   - `eval.started` and `eval.completed` are emitted once each, bracketing
 *     every `eval.scored`, and `eval.completed` precedes `run.completed`; its
 *     counts equal the served summary's.
 *   - The served `EvalSummary` validates, and its counts match its rows.
 *
 * RFC 0246 (safety fix): a trial that failed its trajectory counts 0 in the
 * two pass decisions, while every reported score is unchanged. Judges in
 * `lib/eval-gate-witness.ts`.
 *   7. Server-free — `gatedScore` and `gatedAggregateScore` validate; a value
 *      outside 0–1 is refused.
 *   8. `conformance-eval-trajectory-gate-mean` (trajectory + trials) — under
 *      `passRule: "mean"` a task whose two trials took a forbidden path keeps
 *      `meanScore: 1` and does not pass (`gatedScore: 0`).
 *   9. `conformance-eval-trajectory-gate` (trajectory) — `aggregateScore` 1
 *      clears `passScore` 0.6, the gating aggregate 0.5 does not, so the suite
 *      does not pass. An RFC 0244-only host reports `passed: true` on both.
 *
 * RFC 0245: a fixture entry marked `isError: true` is replayed as a tool
 * error, never as a success. Judge in `lib/eval-fixture-error-witness.ts`.
 *  10. Server-free — an `isError: true` entry validates; a string `"true"` is
 *      refused; `conformance-eval-fixture-error` validates (leg 2).
 *  11. `conformance-eval-fixture-error` (fixtureErrors + fixtureMatching) —
 *      the call served by the error entry is recorded with `error` and no
 *      `outcome` (`status: "error"` under tool hooks), the next with no
 *      `error` (`outcome` optional), and `fixtureMissCount` is 0. The two-call sequence needs
 *      RFC 0244 §D's first-unconsumed selection, hence `fixtureMatching`.
 *  12. Refusal — a host advertising `agents.evalSuite` without `fixtureErrors`
 *      that lists the fixture refuses it with `400 validation_error`.
 *
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md
 * @see RFCS/0246-trajectory-failure-gates-the-pass.md
 * @see RFCS/0245-eval-fixtures-replay-tool-errors.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { majorProfile } from '../lib/major-profile.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { FIXTURES_DIR } from '../lib/paths.js';
import { pollTerminal, readEvents, isRecord, type Ev } from '../lib/fixture-run-observer.js';
import { judgeEvalEnvelope, judgeSummaryServed } from '../lib/eval-envelope-witness.js';
import { gradeTrajectory, passAtK, passHatK, scoreStderr, withinTolerance, type TrajectorySpec } from '../lib/eval-trajectory.js';
import { judgeMeanGated, judgeSuiteGated } from '../lib/eval-gate-witness.js';
import { judgeFixtureErrorReplayed } from '../lib/eval-fixture-error-witness.js';
import { agentUsage, judgeCostEveryTrial, judgeModelUsage, judgeNeverGated, judgeToolCallCount } from '../lib/eval-efficiency-witness.js';
import { judgeTrialMemoryIsolated, memoryCalls } from '../lib/eval-memory-witness.js';
import { counterCalls, judgeFirstUnconsumed, judgeLiveMiss, judgeMissNoLiveCall, type CounterCall } from '../lib/eval-counter-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const DOC = 'agents.schema.json §evalSuite (RFC 0244)';
const AGENT = 'core.conformance.agents.scripted';
const SUITE_URI = (id: string) => `https://conformance.openwop.dev/eval-suites/${id}`;
const ID_SHAPE = 'openwop.requirement.0244.wire-shape';
const ID_CONTENT_FREE = 'openwop.requirement.0244.content-free';
const ID_FIXTURES = 'openwop.requirement.0244.fixtures-valid';
const ID_TRAJECTORY = 'openwop.requirement.0244.trajectory-graded';
const ID_TRIALS = 'openwop.requirement.0244.trials-per-task';
const ID_TRIAL_STATS = 'openwop.requirement.0244.trial-stats-formula';
const ID_MISS = 'openwop.requirement.0244.fixture-miss-fails';
const ID_REFUSED = 'openwop.requirement.0244.unadvertised-feature-refused';
const ID_EFFICIENCY = 'openwop.requirement.0244.efficiency-tool-calls';
const ID_MODEL_USAGE = 'openwop.requirement.0244.efficiency-model-usage';
const ID_COST_TRIALS = 'openwop.requirement.0244.cost-every-trial';
const ID_NEVER_GATED = 'openwop.requirement.0244.efficiency-never-gated';
const ID_MEMORY_ISOLATED = 'openwop.requirement.0244.trial-memory-isolated';
const ID_LIVE_MISS = 'openwop.requirement.0244.live-miss-counted';
const ID_FIRST_UNCONSUMED = 'openwop.requirement.0244.first-unconsumed';
const ID_NO_LIVE_CALL = 'openwop.requirement.0244.miss-no-live-call';
const DOC_COUNTER = 'RFC 0244 §D, fixtures.md counter contract';
const ID_GATED_SHAPE = 'openwop.requirement.0246.gated-fields-shape';
const ID_MEAN_GATED = 'openwop.requirement.0246.mean-gated';
const ID_SUITE_GATED = 'openwop.requirement.0246.suite-gated';
const DOC_0246 = 'eval-summary.schema.json gatedScore / gatedAggregateScore (RFC 0246)';
const ID_FIXTURE_ERROR_SHAPE = 'openwop.requirement.0245.fixture-error-shape';
const ID_FIXTURE_ERROR = 'openwop.requirement.0245.fixture-error-replayed';
const ID_FIXTURE_ERROR_REFUSED = 'openwop.requirement.0245.unadvertised-refused';
const ID_ENVELOPE = 'openwop.requirement.0081.eval-envelope';
const ID_SUMMARY = 'openwop.requirement.0081.summary-served';
const DOC_0081 = 'run-event-payloads evalStarted / evalCompleted, eval-summary.schema.json (RFC 0081 §C)';
const DOC_0245 = 'agents.schema.json §evalSuite.fixtureErrors (RFC 0245)';

interface Task { taskId: string; input: { script: Array<{ tool: string; arguments?: unknown }>; output: string }; expected: { kind: string; trajectory?: TrajectorySpec }; fixtures?: { toolResponses?: Array<Record<string, unknown>> } }
interface Suite { tasks: Task[]; trials?: { count: number; k?: number; passRule?: string } }
const fixture = (id: string): Suite => JSON.parse(readFileSync(join(FIXTURES_DIR, 'eval-suites', `${id}.json`), 'utf8')) as Suite;

const suiteSchema = v2Validator('agent-eval-suite');
const summarySchema = v2Validator('eval-summary');
const scored = v2RefValidator('run-event-payloads.schema.json#/$defs/evalScored');
const started = v2RefValidator('run-event-payloads.schema.json#/$defs/evalStarted');
const completedPayload = v2RefValidator('run-event-payloads.schema.json#/$defs/evalCompleted');

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function evalSuiteFacet(): Promise<{ doc: Record<string, unknown> | null; facet: Record<string, unknown> | null }> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  const agents = doc?.['agents'];
  const facet = isRecord(agents) && isRecord(agents['evalSuite']) ? agents['evalSuite'] : null;
  return { doc, facet };
}

type Observed = { kind: 'skip'; disposition: 'inapplicable' | 'blocked'; reason: string } | { kind: 'ok'; events: Ev[]; summary: Record<string, unknown> };

const runs = new Map<string, Promise<Observed>>();
/** One eval run per fixture per worker: two legs that read the same run share it. */
function runSuite(id: string): Promise<Observed> {
  let p = runs.get(id);
  if (p === undefined) { p = runSuiteOnce(id); runs.set(id, p); }
  return p;
}

async function runSuiteOnce(id: string): Promise<Observed> {
  const res = await http(() => driver.post(PROFILE.runsPath, { mode: 'eval', evalSuiteRef: SUITE_URI(id), agentId: AGENT }));
  if (res === null) return { kind: 'skip', disposition: 'blocked', reason: 'POST /runs unreachable (fetch failed)' };
  if (res.status === 429) return { kind: 'skip', disposition: 'blocked', reason: 'POST /runs answered 429 — the run budget, not the wire' };
  const runId = isRecord(res.json) && typeof res.json['runId'] === 'string' ? res.json['runId'] : undefined;
  if ((res.status !== 201 && res.status !== 202) || runId === undefined) return { kind: 'skip', disposition: 'blocked', reason: `createRun of eval suite ${id} answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim() };
  const terminal = await pollTerminal(PROFILE, runId, { timeoutMs: 60_000 });
  if (terminal.snapshot['status'] !== 'completed') return { kind: 'skip', disposition: 'blocked', reason: `eval run ${runId} ended ${String(terminal.snapshot['status'])}, not completed` };
  const s = await http(() => driver.get(`${PROFILE.runsPath}/${PROFILE.idSegment(runId)}/eval-summary`));
  if (s === null || s.status !== 200 || !isRecord(s.json)) return { kind: 'skip', disposition: 'blocked', reason: `GET …/eval-summary answered ${s?.status ?? 'nothing'}` };
  return { kind: 'ok', events: await readEvents(PROFILE, runId), summary: s.json };
}

const taskEntry = (summary: Record<string, unknown>, taskId: string): Record<string, unknown> | undefined =>
  (Array.isArray(summary['tasks']) ? (summary['tasks'] as unknown[]) : []).filter(isRecord).find((t) => t['taskId'] === taskId);

describe('v2 RFC 0244 — wire shape (server-free)', () => {
  it('the RFC 0244 suite, summary and event fields validate and the negatives are refused', () => {
    const traj = fixture('conformance-eval-trajectory');
    const bad = (mut: (s: Suite) => void): boolean => { const s = structuredClone(traj) as Suite; mut(s); return suiteSchema(s).ok; };
    expect(bad((s) => { (s.tasks[0]!.expected.trajectory as { match: string }).match = 'superset'; }), req(ID_SHAPE, DOC, 'trajectory.match "superset" MUST be refused (use any-order)')).toBe(false);
    expect(bad((s) => { s.trials = { count: 0 }; }), req(ID_SHAPE, DOC, 'trials.count 0 MUST be refused')).toBe(false);
    expect(bad((s) => { (s.tasks[0]!.expected.trajectory as unknown as Record<string, unknown>)['weight'] = 0.5; }), req(ID_SHAPE, DOC, 'an unknown trajectory member MUST be refused')).toBe(false);

    const good = { taskId: 't', score: 1, passed: true, trialIndex: 2, scoreLabel: 'pass', evaluatorType: 'deterministic' };
    expect(scored(good).ok, req(ID_SHAPE, DOC, `eval.scored with trialIndex/scoreLabel/evaluatorType MUST validate: ${scored(good).errors}`)).toBe(true);
    expect(started({ suiteId: 'core.openwop.evals.x', suiteVersion: '1.0.0', taskCount: 2, modes: ['golden'], trialCount: 3 }).ok, req(ID_SHAPE, DOC, 'eval.started.trialCount MUST validate')).toBe(true);
    expect(scored({ ...good, evaluatorType: 'gpt' }).ok, req(ID_SHAPE, DOC, 'an unknown evaluatorType MUST be refused')).toBe(false);

    const summary = {
      suiteId: 'core.openwop.evals.x', suiteVersion: '1.0.0', aggregateScore: 0.5, passed: false, taskCount: 1, passedCount: 0,
      tasks: [{ taskId: 't', score: 0.8, passed: false,
        trajectory: { mode: 'in-order', matched: false, expectedCount: 2, observedCount: 3, matchedCount: 1, forbiddenCount: 1 },
        trials: { n: 5, passedCount: 4, meanScore: 0.8, passAtK: 1, passHatK: 0.4 },
        efficiency: { toolCallCount: 3, modelCallCount: 1, inputTokens: 10, outputTokens: 5 }, fixtureMissCount: 0 }],
      trialStats: { k: 3, passAtK: 1, passHatK: 0.4 },
    };
    expect(summarySchema(summary).ok, req(ID_SHAPE, DOC, `an RFC 0244 EvalSummary MUST validate: ${summarySchema(summary).errors}`)).toBe(true);
  });

  it('the RFC 0244 additions are content-free (eval-summary-no-content-leak)', () => {
    const base = { suiteId: 'core.openwop.evals.x', suiteVersion: '1.0.0', aggregateScore: 0, passed: false, taskCount: 1, passedCount: 0 };
    const leak = { ...base, tasks: [{ taskId: 't', score: 0, passed: false, trajectory: { mode: 'exact', matched: false, expectedCount: 1, observedCount: 1, matchedCount: 0, forbiddenCount: 1, tools: ['billing:refund'] } }] };
    expect(summarySchema(leak).ok, req(ID_CONTENT_FREE, DOC, 'a trajectory block naming tools MUST be refused')).toBe(false);
    expect(scored({ taskId: 't', score: 1, passed: true, scoreLabel: 'Looks good to me' }).ok, req(ID_CONTENT_FREE, DOC, 'a prose scoreLabel MUST be refused')).toBe(false);
  });

  it('the eval-suite fixtures validate against the v2 suite schema', () => {
    for (const id of ['conformance-eval-trajectory', 'conformance-eval-trials', 'conformance-eval-fixture-miss', 'conformance-eval-trajectory-gate', 'conformance-eval-trajectory-gate-mean', 'conformance-eval-fixture-error', 'conformance-eval-counter-live', 'conformance-eval-counter-miss', 'conformance-eval-efficiency-ungated', 'conformance-eval-memory-isolation', 'conformance-eval-regression-base', 'conformance-eval-regression-candidate']) {
      const r = suiteSchema(fixture(id));
      expect(r.ok, req(ID_FIXTURES, 'fixtures.md §eval-suites', `${id} MUST validate: ${r.errors}`)).toBe(true);
    }
  });

  it('the RFC 0246 gating fields validate and stay in 0–1', () => {
    const base = { suiteId: 'core.openwop.evals.x', suiteVersion: '1.0.0', aggregateScore: 1, passed: false, taskCount: 1, passedCount: 0 };
    const ok = { ...base, gatedAggregateScore: 0, tasks: [{ taskId: 't', score: 1, gatedScore: 0, passed: false }] };
    expect(summarySchema(ok).ok, req(ID_GATED_SHAPE, DOC_0246, `gatedScore and gatedAggregateScore MUST validate: ${summarySchema(ok).errors}`)).toBe(true);
    expect(summarySchema({ ...ok, gatedAggregateScore: 1.5 }).ok, req(ID_GATED_SHAPE, DOC_0246, 'gatedAggregateScore above 1 MUST be refused')).toBe(false);
    expect(summarySchema({ ...ok, tasks: [{ taskId: 't', score: 1, gatedScore: -0.1, passed: false }] }).ok, req(ID_GATED_SHAPE, DOC_0246, 'a negative gatedScore MUST be refused')).toBe(false);
  });

  it('a fixture entry may be marked isError, and only as a boolean (RFC 0245 §A)', () => {
    const base = fixture('conformance-eval-fixture-error');
    const withIsError = (v: unknown): boolean => { const s = structuredClone(base) as Suite; s.tasks[0]!.fixtures!.toolResponses![0]!['isError'] = v; return suiteSchema(s).ok; };
    expect(withIsError(true), req(ID_FIXTURE_ERROR_SHAPE, DOC_0245, `an isError: true entry MUST validate: ${suiteSchema(base).errors}`)).toBe(true);
    expect(withIsError(false), req(ID_FIXTURE_ERROR_SHAPE, DOC_0245, 'an isError: false entry MUST validate')).toBe(true);
    expect(withIsError('true'), req(ID_FIXTURE_ERROR_SHAPE, DOC_0245, 'a string isError MUST be refused')).toBe(false);
  });
});

describe('v2 RFC 0244 — host behaviour', () => {
  it('a trajectory suite is graded per the reference grader', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet?.['trajectory'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.trajectory');
    const id = 'conformance-eval-trajectory';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    const suite = fixture(id);
    for (const t of suite.tasks) {
      const want = gradeTrajectory(t.expected.trajectory!, t.input.script.map((c) => ({ tool: c.tool, inputs: c.arguments })));
      const entry = taskEntry(o.summary, t.taskId);
      expect(entry, req(ID_TRAJECTORY, DOC, `the summary MUST carry task ${t.taskId}`)).toBeDefined();
      const got = isRecord(entry?.['trajectory']) ? entry['trajectory'] : {};
      expect(got, req(ID_TRAJECTORY, DOC, `task ${t.taskId}: the trajectory counts MUST equal the reference grade`)).toEqual(want);
      if (!want.matched) expect(entry?.['passed'], req(ID_TRAJECTORY, DOC, `task ${t.taskId}: an unmatched trajectory MUST NOT pass`)).toBe(false);
      if (t.expected.kind === 'trajectory') expect(entry?.['score'], req(ID_TRAJECTORY, DOC, `task ${t.taskId}: a trajectory-only task scores 1 when matched, else 0`)).toBe(want.matched ? 1 : 0);
    }
    const calls = o.events.filter((e) => e.type === 'agent.tool-called' && e.payload['agentId'] === AGENT).length;
    const scripted = suite.tasks.reduce((a, t) => a + t.input.script.length, 0);
    expect(calls, req(ID_TRAJECTORY, DOC, `the log MUST carry one agent.tool-called per scripted call (${scripted})`)).toBe(scripted);
  });

  async function trajectoryRun(): Promise<{ skip: [Parameters<typeof softSkip>[0], string] } | { o: Extract<Observed, { kind: 'ok' }> }> {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return { skip: ['blocked', UNREADABLE] };
    if (facet?.['trajectory'] !== true) return { skip: ['inapplicable', 'the host does not advertise agents.evalSuite.trajectory'] };
    const id = 'conformance-eval-trajectory';
    if (!isFixtureAdvertised(id)) return { skip: ['inapplicable', `the host does not advertise fixture ${id}`] };
    const o = await runSuite(id);
    if (o.kind === 'skip') return { skip: [o.disposition, o.reason] };
    return { o };
  }

  it('an eval run brackets its scores with one eval.started and one eval.completed (RFC 0081 §C)', async () => {
    const r = await trajectoryRun();
    if ('skip' in r) return softSkip(...r.skip);
    for (const x of judgeEvalEnvelope(r.o.events, r.o.summary, { completedValid: completedPayload })) {
      expect(x.ok, req(ID_ENVELOPE, DOC_0081, x.message)).toBe(true);
    }
  });

  it('the served EvalSummary validates and its counts match its rows (RFC 0081 §C)', async () => {
    const r = await trajectoryRun();
    if ('skip' in r) return softSkip(...r.skip);
    for (const x of judgeSummaryServed(r.o.summary, summarySchema)) {
      expect(x.ok, req(ID_SUMMARY, DOC_0081, x.message)).toBe(true);
    }
  });

  async function trialsRun(): Promise<{ skip: [Parameters<typeof softSkip>[0], string] } | { o: Extract<Observed, { kind: 'ok' }>; suite: Suite; n: number; k: number }> {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return { skip: ['blocked', UNREADABLE] };
    if (!isRecord(facet?.['trials'])) return { skip: ['inapplicable', 'the host does not advertise agents.evalSuite.trials'] };
    const id = 'conformance-eval-trials';
    if (!isFixtureAdvertised(id)) return { skip: ['inapplicable', `the host does not advertise fixture ${id}`] };
    const o = await runSuite(id);
    if (o.kind === 'skip') return { skip: [o.disposition, o.reason] };
    const suite = fixture(id);
    const n = suite.trials!.count;
    return { o, suite, n, k: suite.trials!.k ?? n };
  }

  it('repeated trials emit one eval.scored per task per trial', async () => {
    const r = await trialsRun();
    if ('skip' in r) return softSkip(...r.skip);
    const { o, suite, n } = r;
    expect(o.events.find((e) => e.type === 'eval.started')?.payload['trialCount'], req(ID_TRIALS, DOC, 'eval.started MUST carry trialCount')).toBe(n);
    for (const t of suite.tasks) {
      const rows = o.events.filter((e) => e.type === 'eval.scored' && e.payload['taskId'] === t.taskId);
      expect(rows.map((x) => x.payload['trialIndex']).sort(), req(ID_TRIALS, DOC, `task ${t.taskId}: trialIndex MUST be 0..${n - 1}, once each`)).toEqual([...Array(n).keys()]);
    }
  });

  it('the per-task trials block and trialStats follow the §B formulas', async () => {
    const r = await trialsRun();
    if ('skip' in r) return softSkip(...r.skip);
    const { o, suite, n, k } = r;
    const means: number[] = [];
    for (const t of suite.tasks) {
      const rows = o.events.filter((e) => e.type === 'eval.scored' && e.payload['taskId'] === t.taskId);
      const c = rows.filter((x) => x.payload['passed'] === true).length;
      const mean = rows.length === 0 ? 0 : rows.reduce((a, x) => a + Number(x.payload['score']), 0) / rows.length;
      means.push(mean);
      const trials = taskEntry(o.summary, t.taskId)?.['trials'];
      const got = isRecord(trials) ? trials : {};
      expect(got['n'], req(ID_TRIAL_STATS, DOC, `task ${t.taskId}: trials.n`)).toBe(n);
      expect(got['passedCount'], req(ID_TRIAL_STATS, DOC, `task ${t.taskId}: trials.passedCount MUST count the passed trials`)).toBe(c);
      expect(withinTolerance(Number(got['passAtK']), passAtK(n, c, k)), req(ID_TRIAL_STATS, DOC, `task ${t.taskId}: passAtK MUST equal 1 − C(n−c,k)/C(n,k) within 1e-9 relative (got ${String(got['passAtK'])}, want ${passAtK(n, c, k)})`)).toBe(true);
      expect(withinTolerance(Number(got['passHatK']), passHatK(n, c, k)), req(ID_TRIAL_STATS, DOC, `task ${t.taskId}: passHatK MUST equal C(c,k)/C(n,k) within 1e-9 relative (got ${String(got['passHatK'])}, want ${passHatK(n, c, k)})`)).toBe(true);
      expect(withinTolerance(Number(got['meanScore']), mean), req(ID_TRIAL_STATS, DOC, `task ${t.taskId}: meanScore MUST equal the mean trial score within 1e-9 relative (got ${String(got['meanScore'])}, want ${mean})`)).toBe(true);
    }
    const stats = isRecord(o.summary['trialStats']) ? o.summary['trialStats'] : {};
    const se = scoreStderr(means);
    if (se !== undefined) expect(withinTolerance(Number(stats['scoreStderr']), se), req(ID_TRIAL_STATS, DOC, `trialStats.scoreStderr MUST equal sd(per-task means)/√T within 1e-9 relative (got ${String(stats['scoreStderr'])}, want ${se})`)).toBe(true);
  });

  it('efficiency.toolCallCount counts the scripted agent.tool-called events (§C)', async () => {
    const r = await trajectoryRun();
    if ('skip' in r) return softSkip(...r.skip);
    const scriptedTasks = (s: Suite) => s.tasks.map((t) => ({ taskId: t.taskId, scriptLength: t.input.script.length }));
    const logCalls = r.o.events.filter((e) => e.type === 'agent.tool-called' && e.payload['agentId'] === AGENT).length;
    const verdicts = [judgeToolCallCount(r.o.summary, scriptedTasks(fixture('conformance-eval-trajectory')), logCalls)];
    const t = await trialsRun();
    if (!('skip' in t)) verdicts.push(judgeToolCallCount(t.o.summary, scriptedTasks(t.suite), undefined));
    if (!verdicts.some((v) => v.applicable)) return softSkip('inapplicable', 'no task entry carries efficiency, which RFC 0244 §C makes optional');
    for (const v of verdicts) for (const x of v.findings) expect(x.ok, req(ID_EFFICIENCY, 'eval-summary.schema.json efficiency (RFC 0244 §C)', x.message)).toBe(true);
  });

  it('efficiency model and token counts match the agent\'s provider.usage (§C)', async () => {
    const r = await trajectoryRun();
    if ('skip' in r) return softSkip(...r.skip);
    const ids = (s: Suite) => s.tasks.map((t) => t.taskId);
    const verdicts = [judgeModelUsage(r.o.summary, ids(fixture('conformance-eval-trajectory')), agentUsage(r.o.events, AGENT), 1)];
    const t = await trialsRun();
    if (!('skip' in t)) verdicts.push(judgeModelUsage(t.o.summary, ids(t.suite), agentUsage(t.o.events, AGENT), t.n));
    if (!verdicts.some((v) => v.applicable)) return softSkip('inapplicable', 'no run carries both a reported model count and provider.usage to check it against (the scripted agent need not call a model; RFC 0244 §C fields are optional)');
    for (const v of verdicts) for (const x of v.findings) expect(x.ok, req(ID_MODEL_USAGE, 'eval-summary.schema.json efficiency (RFC 0244 §C)', x.message)).toBe(true);
  });

  it('totalCostUsd counts every trial (§B)', async () => {
    const t = await trialsRun();
    if ('skip' in t) return softSkip(...t.skip);
    const v = judgeCostEveryTrial(t.o.summary, agentUsage(t.o.events, AGENT));
    if (!v.applicable) return softSkip('inapplicable', 'the trials run carries no totalCostUsd, no agent.invocation.* brackets, or an unpriced provider.usage, so the per-trial cost is not observable');
    for (const x of v.findings) expect(x.ok, req(ID_COST_TRIALS, 'agent-eval-suite.schema.json thresholds.maxCostUsd, eval-summary.schema.json totalCostUsd (RFC 0244 §B)', x.message)).toBe(true);
  });

  it('a host does not fail a task or a suite on efficiency (§C)', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet === null) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite');
    const id = 'conformance-eval-efficiency-ungated';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    const task = (taskId: string) => ({ taskId, scriptLength: fixture(id).tasks.find((t) => t.taskId === taskId)!.input.script.length });
    const logCalls = o.events.filter((e) => e.type === 'agent.tool-called' && e.payload['agentId'] === AGENT).length;
    const v = judgeNeverGated(o.summary, task('lean'), task('busy'), logCalls);
    if ('blocked' in v) return softSkip('blocked', v.blocked);
    for (const x of v.findings) expect(x.ok, req(ID_NEVER_GATED, 'eval-summary.schema.json efficiency (RFC 0244 §C)', x.message)).toBe(true);
  });

  it('memory one trial writes is not visible to another trial (§B)', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const trials = facet?.['trials'];
    if (!isRecord(trials)) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.trials');
    const id = 'conformance-eval-memory-isolation';
    const n = fixture(id).trials!.count;
    if (typeof trials['maxTrials'] === 'number' && trials['maxTrials'] < n) return softSkip('inapplicable', `the host advertises trials.maxTrials ${trials['maxTrials']}, below the fixture's ${n}`);
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}, its opt-in to the memory-tool contract`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    const v = judgeTrialMemoryIsolated(memoryCalls(o.events, AGENT), n);
    if (v.kind === 'blocked') return softSkip('blocked', v.reason);
    for (const x of v.findings) expect(x.ok, req(ID_MEMORY_ISOLATED, 'agent-eval-suite.schema.json trials, fixtures.md memory contract (RFC 0244 §B)', x.message)).toBe(true);
  });

  type CounterRuns = { skip: [Parameters<typeof softSkip>[0], string] } | { a: CounterCall[]; b: CounterCall[]; c: CounterCall[]; aMisses: unknown };
  let counterSeq: Promise<CounterRuns> | undefined;
  /** A → B → C, strictly in order, once per worker: the three counter legs read the same runs. */
  function counterRuns(): Promise<CounterRuns> {
    counterSeq ??= (async (): Promise<CounterRuns> => {
      const { doc, facet } = await evalSuiteFacet();
      if (!doc) return { skip: ['blocked', UNREADABLE] };
      if (facet?.['fixtureMatching'] !== true) return { skip: ['inapplicable', 'the host does not advertise agents.evalSuite.fixtureMatching'] };
      for (const id of ['conformance-eval-counter-live', 'conformance-eval-counter-miss']) {
        if (!isFixtureAdvertised(id)) return { skip: ['inapplicable', `the host does not advertise fixture ${id}, its opt-in to the counter-tool contract`] };
      }
      const a = await runSuiteOnce('conformance-eval-counter-live');
      if (a.kind === 'skip') return { skip: [a.disposition, `run A: ${a.reason}`] };
      const b = await runSuiteOnce('conformance-eval-counter-miss');
      if (b.kind === 'skip') return { skip: [b.disposition, `run B: ${b.reason}`] };
      const c = await runSuiteOnce('conformance-eval-counter-live');
      if (c.kind === 'skip') return { skip: [c.disposition, `run C: ${c.reason}`] };
      return { a: counterCalls(a.events, AGENT), b: counterCalls(b.events, AGENT), c: counterCalls(c.events, AGENT), aMisses: taskEntry(a.summary, 'live-counter')?.['fixtureMissCount'] };
    })();
    return counterSeq;
  }

  it('a miss under onMiss "live" reaches the live counter and is counted (§D)', async () => {
    const r = await counterRuns();
    if ('skip' in r) return softSkip(...r.skip);
    const v = judgeLiveMiss(r.a, r.aMisses);
    if (v.kind === 'blocked') return softSkip('blocked', v.reason);
    for (const x of v.findings) expect(x.ok, req(ID_LIVE_MISS, DOC_COUNTER, x.message)).toBe(true);
  });

  it('repeated calls are served the first unconsumed fixture entry, once each (§D)', async () => {
    const r = await counterRuns();
    if ('skip' in r) return softSkip(...r.skip);
    const v = judgeFirstUnconsumed(r.b);
    if (v.kind === 'blocked') return softSkip('blocked', v.reason);
    for (const x of v.findings) expect(x.ok, req(ID_FIRST_UNCONSUMED, DOC_COUNTER, x.message)).toBe(true);
  });

  it('a miss under onMiss "fail" never reaches the live counter (§D)', async () => {
    const r = await counterRuns();
    if ('skip' in r) return softSkip(...r.skip);
    const v = judgeMissNoLiveCall(r.a, r.b, r.c);
    if (v.kind === 'blocked') return softSkip('blocked', v.reason);
    for (const x of v.findings) expect(x.ok, req(ID_NO_LIVE_CALL, DOC_COUNTER, x.message)).toBe(true);
  });

  it('a fixture miss under onMiss "fail" fails the trial and is counted', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet?.['fixtureMatching'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.fixtureMatching');
    const id = 'conformance-eval-fixture-miss';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    const missed = taskEntry(o.summary, 'missed');
    const served = taskEntry(o.summary, 'served');
    expect(missed?.['fixtureMissCount'], req(ID_MISS, DOC, 'the missed task MUST report fixtureMissCount 1')).toBe(1);
    expect(missed?.['passed'], req(ID_MISS, DOC, 'a miss under onMiss "fail" MUST fail the trial')).toBe(false);
    expect(missed?.['score'], req(ID_MISS, DOC, 'a trial that fails closed MUST report score 0 in the summary')).toBe(0);
    const missedScored = o.events.filter((e) => e.type === 'eval.scored' && e.payload['taskId'] === 'missed');
    expect(missedScored.length, req(ID_MISS, DOC, 'the missed task MUST emit eval.scored')).toBeGreaterThan(0);
    for (const e of missedScored) expect(e.payload['score'], req(ID_MISS, DOC, 'eval.scored for a trial that fails closed MUST carry score 0')).toBe(0);
    expect(served?.['passed'], req(ID_MISS, DOC, 'a served task MUST still pass')).toBe(true);
    expect(served?.['fixtureMissCount'] ?? 0, req(ID_MISS, DOC, 'a served task MUST NOT report a miss')).toBe(0);
  });

  it('a suite using an unadvertised RFC 0244 feature is refused at createRun', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet === null) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite (v2-eval-mode-unadvertised-refused covers it)');
    if (isRecord(facet['trials'])) return softSkip('inapplicable', 'the host advertises agents.evalSuite.trials, so the trials suite is served');
    const id = 'conformance-eval-trials';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const res = await http(() => driver.post(PROFILE.runsPath, { mode: 'eval', evalSuiteRef: SUITE_URI(id), agentId: AGENT }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const runId = isRecord(res.json) && typeof res.json['runId'] === 'string' ? res.json['runId'] : undefined;
    if (res.status === 201 && runId !== undefined) await http(() => driver.post(`${PROFILE.runsPath}/${PROFILE.idSegment(runId)}/cancel`, {}));
    expect(res.status, req(ID_REFUSED, DOC, `a trials suite on a host without agents.evalSuite.trials MUST be refused with 400 (got ${res.status})`)).toBe(400);
    expect(readErrorCode(res.json), req(ID_REFUSED, DOC, 'the refusal MUST carry validation_error')).toBe('validation_error');
  });

  it('under passRule "mean" a task whose trials failed their trajectory does not pass (RFC 0246)', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet?.['trajectory'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.trajectory');
    if (!isRecord(facet['trials'])) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.trials, so passRule "mean" over trials does not apply');
    const id = 'conformance-eval-trajectory-gate-mean';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    const scoredRows = o.events.filter((e) => e.type === 'eval.scored').map((e) => e.payload);
    for (const x of judgeMeanGated(o.summary, scoredRows, fixture(id).trials!.count)) expect(x.ok, req(ID_MEAN_GATED, x.doc, x.message)).toBe(true);
  });

  it('a suite whose tasks failed their trajectory does not pass on the output scores (RFC 0246)', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet?.['trajectory'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.trajectory');
    const id = 'conformance-eval-trajectory-gate';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    for (const x of judgeSuiteGated(o.summary, 0.6)) expect(x.ok, req(ID_SUITE_GATED, x.doc, x.message)).toBe(true);
  });

  it('a fixture entry marked isError is replayed as a tool error, not a success (RFC 0245)', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet?.['fixtureErrors'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.fixtureErrors');
    if (facet['fixtureMatching'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.fixtureMatching, which the error-then-success sequence needs (RFC 0244 §D first unconsumed match)');
    const id = 'conformance-eval-fixture-error';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const o = await runSuite(id);
    if (o.kind === 'skip') return softSkip(o.disposition, o.reason);
    const hooks = doc['toolHooks'];
    const prePostEvents = isRecord(hooks) && hooks['prePostEvents'] === true;
    for (const x of judgeFixtureErrorReplayed(o.events, o.summary, { agentId: AGENT, prePostEvents })) expect(x.ok, req(ID_FIXTURE_ERROR, x.doc, x.message)).toBe(true);
  });

  it('a suite using isError is refused at createRun without fixtureErrors (RFC 0245 §C)', async () => {
    const { doc, facet } = await evalSuiteFacet();
    if (!doc) return softSkip('blocked', UNREADABLE);
    if (facet === null) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite (v2-eval-mode-unadvertised-refused covers it)');
    if (facet['fixtureErrors'] === true) return softSkip('inapplicable', 'the host advertises agents.evalSuite.fixtureErrors, so the isError suite is served');
    const id = 'conformance-eval-fixture-error';
    if (!isFixtureAdvertised(id)) return softSkip('inapplicable', `the host does not advertise fixture ${id}`);
    const res = await http(() => driver.post(PROFILE.runsPath, { mode: 'eval', evalSuiteRef: SUITE_URI(id), agentId: AGENT }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const runId = isRecord(res.json) && typeof res.json['runId'] === 'string' ? res.json['runId'] : undefined;
    if (res.status === 201 && runId !== undefined) await http(() => driver.post(`${PROFILE.runsPath}/${PROFILE.idSegment(runId)}/cancel`, {}));
    expect(res.status, req(ID_FIXTURE_ERROR_REFUSED, DOC_0245, `an isError suite on a host without agents.evalSuite.fixtureErrors MUST be refused with 400 (got ${res.status})`)).toBe(400);
    expect(readErrorCode(res.json), req(ID_FIXTURE_ERROR_REFUSED, DOC_0245, 'the refusal MUST carry validation_error')).toBe('validation_error');
  });
});
