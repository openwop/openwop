/**
 * v2 — an eval task takes its fixtures from a recorded run (RFC 0252; the
 * rules are the `agents.evalSuite.recordedFixtures` facet description in
 * `spec/v2/facets/agents.schema.json`, the `createRun` `fixtureRuns`
 * description and `eval.started.fixtureRuns`).
 *
 * Server-free leg:
 *   1. `0252.shape` — the facet member is a boolean, `eval.started` carries
 *      `fixtureRuns` (taskId → runId, non-empty), and the derived `createRun`
 *      eval body carries `fixtureRuns`.
 *
 * Host legs — gated on `recordedFixtures`, `fixtureMatching`, and the three
 * `conformance-eval-recorded-*` fixtures in discovery `fixtures`. Four runs
 * through the reserved counter tool, in order, once per worker: source,
 * replay (`fixtureRuns: {record: source}`), drift (the same source), and the
 * source suite again as a probe. Judges in `lib/eval-recorded-fixtures-witness.ts`.
 *   2. `0252.source-replayed` — `eval.started` echoes the map; each replayed
 *      call returns the source's outcome; no miss; the probe shows the replay
 *      never reached the live counter.
 *   3. `0252.drift-fails-closed` — the unrecorded `inc P` misses, the task
 *      fails, and the probe reads P unchanged.
 *   4. `0252.source-refused` — an unknown id, and a `conformance-noop`
 *      workflow run (when listed) that never invoked the agent, are refused
 *      `400 validation_error` without the id.
 *   5. `0252.source-uniform` — tenant B's source run
 *      (`OPENWOP_TEST_TENANT_B_API_KEY`) is refused exactly as the unknown id.
 *   6. `0252.fields-refused` — a key naming no task, a target task that
 *      carries its own fixtures, and `fixtureRuns` without `mode`.
 *
 * @see RFCS/0252-eval-fixtures-from-a-recorded-run.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { majorProfile } from '../lib/major-profile.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { API_DIR } from '../lib/paths.js';
import { pollTerminal, readEvents, isRecord, type Ev } from '../lib/fixture-run-observer.js';
import { counterCalls, type CounterCall } from '../lib/eval-counter-witness.js';
import { judgeRefused, judgeUniform, type Answer } from '../lib/eval-regression-witness.js';
import { judgeDriftFailsClosed, judgeEchoed, judgeReplayed, recordTask, TASK, type RecordedFinding, type RecordedVerdict } from '../lib/eval-recorded-fixtures-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const DOC = 'agents.schema.json §evalSuite.recordedFixtures, createRun fixtureRuns, eval.started.fixtureRuns (RFC 0252)';
const AGENT = 'core.conformance.agents.scripted';
const SUITE_URI = (id: string) => `https://conformance.openwop.dev/eval-suites/${id}`;
const SOURCE = 'conformance-eval-recorded-source';
const REPLAY = 'conformance-eval-recorded-replay';
const DRIFT = 'conformance-eval-recorded-drift';
const ID_SHAPE = 'openwop.requirement.0252.shape';
const ID_REPLAYED = 'openwop.requirement.0252.source-replayed';
const ID_DRIFT = 'openwop.requirement.0252.drift-fails-closed';
const ID_REFUSED = 'openwop.requirement.0252.source-refused';
const ID_UNIFORM = 'openwop.requirement.0252.source-uniform';
const ID_FIELDS = 'openwop.requirement.0252.fields-refused';

type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
type Done = { runId: string; events: Ev[]; summary: Record<string, unknown>; calls: CounterCall[] };
type Runs = { source: Done; replay: Done; drift: Done; probe: Done };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
const answer = (r: OpenWOPResponse): Answer => ({ status: r.status, json: r.json, text: r.text });
const expectAll = (id: string, findings: readonly RecordedFinding[]): void => {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
};
const expectVerdict = (id: string, v: RecordedVerdict): void => {
  if (v.kind === 'blocked') return softSkip('blocked', v.reason);
  expectAll(id, v.findings);
};

async function gate(): Promise<Skip | null> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { return { skip: ['blocked', UNREADABLE] }; }
  const agents = doc?.['agents'];
  const facet = isRecord(agents) && isRecord(agents['evalSuite']) ? agents['evalSuite'] : null;
  if (facet === null || facet['recordedFixtures'] !== true) return { skip: ['inapplicable', 'the host does not advertise agents.evalSuite.recordedFixtures'] };
  if (facet['fixtureMatching'] !== true) return { skip: ['inapplicable', 'the host advertises recordedFixtures without fixtureMatching'] };
  for (const id of [SOURCE, REPLAY, DRIFT]) if (!isFixtureAdvertised(id)) return { skip: ['inapplicable', `the host does not advertise fixture ${id}`] };
  return null;
}

const create = (id: string, extra: Record<string, unknown>, headers?: Record<string, string>) =>
  http(() => driver.post(PROFILE.runsPath, { mode: 'eval', evalSuiteRef: SUITE_URI(id), agentId: AGENT, ...extra }, headers ? { headers } : {}));

async function complete(id: string, extra: Record<string, unknown>): Promise<Skip | Done> {
  const res = await create(id, extra);
  if (res === null) return { skip: ['blocked', 'POST /runs unreachable (fetch failed)'] };
  if (res.status === 429) return { skip: ['blocked', 'POST /runs answered 429 — the run budget, not the wire'] };
  const runId = isRecord(res.json) && typeof res.json['runId'] === 'string' ? res.json['runId'] : undefined;
  if ((res.status !== 201 && res.status !== 202) || runId === undefined) return { skip: ['blocked', `createRun of ${id} answered ${res.status} ${readErrorCode(res.json) ?? ''}`.trim()] };
  const terminal = await pollTerminal(PROFILE, runId, { timeoutMs: 60_000 });
  if (terminal.snapshot['status'] !== 'completed') return { skip: ['blocked', `eval run ${runId} ended ${String(terminal.snapshot['status'])}, not completed`] };
  const s = await http(() => driver.get(`${PROFILE.runsPath}/${PROFILE.idSegment(runId)}/eval-summary`));
  if (s === null || s.status !== 200 || !isRecord(s.json)) return { skip: ['blocked', `GET …/eval-summary answered ${s?.status ?? 'nothing'}`] };
  const events = await readEvents(PROFILE, runId);
  return { runId, events, summary: s.json, calls: counterCalls(events, AGENT) };
}

let seq: Promise<Skip | Runs> | undefined;
/** Source → replay → drift → probe, strictly in order, once per worker: the host legs read the same runs. */
function runs(): Promise<Skip | Runs> {
  seq ??= (async (): Promise<Skip | Runs> => {
    const source = await complete(SOURCE, {});
    if ('skip' in source) return source;
    const replay = await complete(REPLAY, { fixtureRuns: { [TASK]: source.runId } });
    if ('skip' in replay) return replay;
    const drift = await complete(DRIFT, { fixtureRuns: { [TASK]: source.runId } });
    if ('skip' in drift) return drift;
    const probe = await complete(SOURCE, {});
    if ('skip' in probe) return probe;
    return { source, replay, drift, probe };
  })();
  return seq;
}

/** An id in the caller's own tenant, with the runId grammar, that the host never minted. */
const unknownBeside = (runId: string): string => `${runId.split('/')[0]}/${randomBytes(16).toString('hex')}`;

describe('v2 RFC 0252 — wire shape (server-free)', () => {
  it('the recordedFixtures member, eval.started.fixtureRuns and the createRun property are in the derived contract', () => {
    const facet = v2RefValidator('capabilities.schema.json#/properties/agents/properties/evalSuite/properties/recordedFixtures');
    expect(facet(true).ok, req(ID_SHAPE, DOC, 'recordedFixtures: true MUST validate')).toBe(true);
    expect(facet('yes').ok, req(ID_SHAPE, DOC, 'recordedFixtures MUST be a boolean')).toBe(false);
    const started = v2RefValidator('run-event-payloads.schema.json#/$defs/evalStarted');
    const base = { suiteId: 'core.openwop.evals.x', suiteVersion: '1.0.0', taskCount: 1, modes: ['golden'] };
    const r = started({ ...base, fixtureRuns: { record: 'conformance-tenant/0123456789abcdef0123456789abcdef' } });
    expect(r.ok, req(ID_SHAPE, DOC, `eval.started with fixtureRuns MUST validate: ${r.errors}`)).toBe(true);
    expect(started({ ...base, fixtureRuns: {} }).ok, req(ID_SHAPE, DOC, 'an empty fixtureRuns MUST be refused')).toBe(false);
    expect(started({ ...base, fixtureRuns: { record: 42 } }).ok, req(ID_SHAPE, DOC, 'a fixtureRuns value MUST be a runId')).toBe(false);
    const api = readFileSync(join(API_DIR, 'v2', 'openapi.yaml'), 'utf8');
    const at = api.indexOf('operationId: createRun');
    const next = api.indexOf('operationId:', at + 1);
    const block = at < 0 ? '' : api.slice(at, next < 0 ? undefined : next);
    expect(block, req(ID_SHAPE, DOC, 'createRun MUST carry fixtureRuns, a non-empty map onto runIds')).toMatch(/fixtureRuns:\s*\n\s*type: object\s*\n\s*minProperties: 1[\s\S]*?additionalProperties:\s*\n\s*\$ref: \.\.\/\.\.\/schemas\/v2\/ids\.schema\.json#\/\$defs\/runId/);
  });
});

describe('v2 RFC 0252 — an eval task takes its fixtures from a recorded run (host)', () => {
  it('the replay is served the source run\'s recorded answers and never reaches the live tool', async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_REPLAYED, judgeEchoed(r.replay.events, { [TASK]: r.source.runId }));
    expectVerdict(ID_REPLAYED, judgeReplayed(r.source.calls, r.replay.calls, recordTask(r.replay.summary), r.probe.calls));
  });

  it('a call the source never made misses, fails the task, and never runs live', async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const task = recordTask(r.drift.summary);
    expectVerdict(ID_DRIFT, judgeDriftFailsClosed(r.source.calls, task, task?.['passed'], r.probe.calls));
  });

  it('an unknown source, and a run that never invoked the agent, are refused without the id', async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const unknownId = unknownBeside(r.source.runId);
    const unknown = await create(REPLAY, { fixtureRuns: { [TASK]: unknownId } });
    if (unknown === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expectAll(ID_REFUSED, judgeRefused(answer(unknown), unknownId, 'an unknown source run'));
    // The second case needs a workflow run of the scripted fixture; without conformance-noop only the unknown id is judged.
    const wf = isFixtureAdvertised('conformance-noop') ? await http(() => driver.post(PROFILE.runsPath, { workflowId: 'conformance-noop' })) : null;
    const wfId = wf && isRecord(wf.json) && typeof wf.json['runId'] === 'string' ? wf.json['runId'] : undefined;
    if (wfId !== undefined) {
      await pollTerminal(PROFILE, wfId, { timeoutMs: 30_000 });
      const noAgent = await create(REPLAY, { fixtureRuns: { [TASK]: wfId } });
      if (noAgent !== null) expectAll(ID_REFUSED, judgeRefused(answer(noAgent), wfId, 'a source run that never invoked the agent'));
    }
  });

  it("another tenant's run is refused exactly as an id that never existed", async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const tenantB = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (!tenantB) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set');
    if (tenantB === process.env['OPENWOP_API_KEY']) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant');
    const foreign = await create(SOURCE, {}, { Authorization: `Bearer ${tenantB}` });
    const foreignId = foreign && isRecord(foreign.json) && typeof foreign.json['runId'] === 'string' ? foreign.json['runId'] : undefined;
    if (foreignId === undefined) return softSkip('blocked', `tenant B's createRun of ${SOURCE} answered ${foreign?.status ?? 'nothing'}`);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const unknown = await create(REPLAY, { fixtureRuns: { [TASK]: unknownBeside(r.source.runId) } });
    const viaForeign = await create(REPLAY, { fixtureRuns: { [TASK]: foreignId } });
    if (unknown === null || viaForeign === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expectAll(ID_UNIFORM, judgeUniform(answer(unknown), answer(viaForeign), foreignId));
  });

  it('a key naming no task, a target with its own fixtures, and fixtureRuns without mode are refused', async () => {
    const g = await gate();
    if (g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const map = { [TASK]: r.source.runId };
    const noTask = await create(REPLAY, { fixtureRuns: { nope: r.source.runId } });
    const ownFixtures = await create(SOURCE, { fixtureRuns: map });
    if (noTask === null || ownFixtures === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expectAll(ID_FIELDS, judgeRefused(answer(noTask), undefined, 'a fixtureRuns key naming no task of the suite'));
    expectAll(ID_FIELDS, judgeRefused(answer(ownFixtures), undefined, 'a named task whose suite fixtures carry toolResponses or onMiss'));
    // A workflow create needs a workflow the host holds, or its 404 would answer first.
    const noMode = isFixtureAdvertised('conformance-noop') ? await http(() => driver.post(PROFILE.runsPath, { workflowId: 'conformance-noop', fixtureRuns: map })) : null;
    if (noMode !== null) expectAll(ID_FIELDS, judgeRefused(answer(noMode), undefined, 'fixtureRuns without mode eval'));
  });
});
