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
 *      `fixtureMissCount: 1` and `passed: false`; the served one passes.
 *      That no live tool ran is seam-gated (RFC 0244 G2) and not asserted.
 *   6. Refusal — a host advertising `agents.evalSuite` without `trials` that
 *      lists `conformance-eval-trials` refuses it at createRun with
 *      `400 validation_error`.
 *
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md
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
import { gradeTrajectory, passAtK, passHatK, scoreStderr, withinTolerance, type TrajectorySpec } from '../lib/eval-trajectory.js';

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

interface Task { taskId: string; input: { script: Array<{ tool: string; arguments?: unknown }>; output: string }; expected: { kind: string; trajectory?: TrajectorySpec } }
interface Suite { tasks: Task[]; trials?: { count: number; k?: number; passRule?: string } }
const fixture = (id: string): Suite => JSON.parse(readFileSync(join(FIXTURES_DIR, 'eval-suites', `${id}.json`), 'utf8')) as Suite;

const suiteSchema = v2Validator('agent-eval-suite');
const summarySchema = v2Validator('eval-summary');
const scored = v2RefValidator('run-event-payloads.schema.json#/$defs/evalScored');
const started = v2RefValidator('run-event-payloads.schema.json#/$defs/evalStarted');

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
    for (const id of ['conformance-eval-trajectory', 'conformance-eval-trials', 'conformance-eval-fixture-miss']) {
      const r = suiteSchema(fixture(id));
      expect(r.ok, req(ID_FIXTURES, 'fixtures.md §eval-suites', `${id} MUST validate: ${r.errors}`)).toBe(true);
    }
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
});
