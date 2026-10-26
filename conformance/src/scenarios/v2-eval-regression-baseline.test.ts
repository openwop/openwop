/**
 * v2 — an eval run names its modes and its regression baseline (RFC 0251;
 * the rules are the `agents.evalSuite.baselineSelection` facet description in
 * `spec/v2/facets/agents.schema.json` and the `createRun` `evalModes` /
 * `baselineRunId` descriptions), and RFC 0244 §F pairing, which a
 * client-named baseline makes causable.
 *
 * Server-free leg:
 *   1. `0251.shape` — the facet member is a boolean, and the derived
 *      `createRun` eval body carries `evalModes` (closed mode enum, non-empty,
 *      distinct) and `baselineRunId`.
 *
 * Host legs — gated on `baselineSelection`, `regression` in `modes`, and both
 * `conformance-eval-regression-base` and `-candidate` in discovery `fixtures`.
 * One base run (`evalModes: [golden]`), then one candidate run
 * (`evalModes: [golden, regression]`, the base run as baseline). The two
 * fixtures share a `suiteId`; every paired score is equal while the
 * aggregates differ by 1/3. Judges in `lib/eval-regression-witness.ts`.
 *   2. `0251.baseline-echoed` — `eval.started.baselineRunId` and
 *      `regression.baselineRunId` name the base run; `scoreDelta` is the
 *      aggregate difference.
 *   3. `0244.regression-paired` — `pairedTaskCount` is 2 (needs
 *      `regressionVerdict`).
 *   4. `0244.regression-no-false-verdict` — the verdict is present and is
 *      neither `improved` nor `regressed` (needs `regressionVerdict`).
 *   5. `0251.baseline-refused` — an unknown id, and a completed run of
 *      another suite (`conformance-eval-trajectory`, when listed), are refused
 *      `400 validation_error` without the id.
 *   6. `0251.baseline-uniform` — tenant B's run
 *      (`OPENWOP_TEST_TENANT_B_API_KEY`) is refused exactly as the unknown id.
 *   7. `0251.fields-refused` — `baselineRunId` without `regression` in
 *      `evalModes`, and `regression` without a baseline, are refused.
 *
 * @see RFCS/0251-eval-run-mode-and-baseline-selection.md
 * @see RFCS/0244-eval-trajectories-trials-and-recorded-fixtures.md §F
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
import { judgeBaselineEchoed, judgeNoFalseVerdict, judgePaired, judgeRefused, judgeUniform, type Answer, type RegressionFinding } from '../lib/eval-regression-witness.js';

const PROFILE = majorProfile(2);
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const DOC = 'agents.schema.json §evalSuite.baselineSelection, createRun evalModes / baselineRunId (RFC 0251)';
const DOC_F = 'eval-summary.schema.json regression (RFC 0244 §F)';
const AGENT = 'core.conformance.agents.scripted';
const SUITE_URI = (id: string) => `https://conformance.openwop.dev/eval-suites/${id}`;
const BASE = 'conformance-eval-regression-base';
const CANDIDATE = 'conformance-eval-regression-candidate';
const OTHER = 'conformance-eval-trajectory';
const ID_SHAPE = 'openwop.requirement.0251.shape';
const ID_ECHOED = 'openwop.requirement.0251.baseline-echoed';
const ID_PAIRED = 'openwop.requirement.0244.regression-paired';
const ID_NO_FALSE = 'openwop.requirement.0244.regression-no-false-verdict';
const ID_REFUSED = 'openwop.requirement.0251.baseline-refused';
const ID_UNIFORM = 'openwop.requirement.0251.baseline-uniform';
const ID_FIELDS = 'openwop.requirement.0251.fields-refused';

type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
type Done = { runId: string; events: Ev[]; summary: Record<string, unknown> };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
const answer = (r: OpenWOPResponse): Answer => ({ status: r.status, json: r.json, text: r.text });
const expectAll = (id: string, doc: string, findings: readonly RegressionFinding[]): void => {
  for (const x of findings) expect(x.ok, req(id, doc, x.message)).toBe(true);
};

async function evalSuiteFacet(): Promise<Record<string, unknown> | null | undefined> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { return undefined; }
  const agents = doc?.['agents'];
  return isRecord(agents) && isRecord(agents['evalSuite']) ? agents['evalSuite'] : null;
}

/** The gate every host leg shares. */
async function gate(): Promise<Skip | { facet: Record<string, unknown> }> {
  const facet = await evalSuiteFacet();
  if (facet === undefined) return { skip: ['blocked', UNREADABLE] };
  if (facet === null || facet['baselineSelection'] !== true) return { skip: ['inapplicable', 'the host does not advertise agents.evalSuite.baselineSelection'] };
  if (!Array.isArray(facet['modes']) || !facet['modes'].includes('regression')) return { skip: ['inapplicable', 'the host does not advertise regression in agents.evalSuite.modes'] };
  for (const id of [BASE, CANDIDATE]) if (!isFixtureAdvertised(id)) return { skip: ['inapplicable', `the host does not advertise fixture ${id}`] };
  return { facet };
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
  return { runId, events: await readEvents(PROFILE, runId), summary: s.json };
}

let pair: Promise<Skip | { base: Done; cand: Done }> | undefined;
/** Base, then candidate against it, once per worker: the host legs read the same two runs. */
function runs(): Promise<Skip | { base: Done; cand: Done }> {
  pair ??= (async () => {
    const base = await complete(BASE, { evalModes: ['golden'] });
    if ('skip' in base) return base;
    const cand = await complete(CANDIDATE, { evalModes: ['golden', 'regression'], baselineRunId: base.runId });
    if ('skip' in cand) return cand;
    return { base, cand };
  })();
  return pair;
}

/** An id in the caller's own tenant, with the runId grammar, that the host never minted. */
const unknownBeside = (runId: string): string => `${runId.split('/')[0]}/${randomBytes(16).toString('hex')}`;

describe('v2 RFC 0251 — wire shape (server-free)', () => {
  it('the baselineSelection member and the createRun eval properties are in the derived contract', () => {
    const v = v2RefValidator('capabilities.schema.json#/properties/agents/properties/evalSuite/properties/baselineSelection');
    expect(v(true).ok, req(ID_SHAPE, DOC, 'baselineSelection: true MUST validate')).toBe(true);
    expect(v('yes').ok, req(ID_SHAPE, DOC, 'baselineSelection MUST be a boolean')).toBe(false);
    const api = readFileSync(join(API_DIR, 'v2', 'openapi.yaml'), 'utf8');
    const at = api.indexOf('operationId: createRun');
    const next = api.indexOf('operationId:', at + 1);
    const block = at < 0 ? '' : api.slice(at, next < 0 ? undefined : next);
    expect(block, req(ID_SHAPE, DOC, 'createRun MUST carry evalModes over the RFC 0081 §D modes')).toMatch(/evalModes:[\s\S]*?enum:\s*\n?\s*-?\s*\[?\s*golden/);
    expect(block, req(ID_SHAPE, DOC, 'evalModes MUST be non-empty and distinct')).toMatch(/evalModes:\s*\n\s*type: array\s*\n\s*minItems: 1\s*\n\s*uniqueItems: true/);
    expect(block, req(ID_SHAPE, DOC, 'createRun MUST carry baselineRunId as a runId')).toMatch(/baselineRunId:\s*\n\s*\$ref: \.\.\/\.\.\/schemas\/v2\/ids\.schema\.json#\/\$defs\/runId/);
  });
});

describe('v2 RFC 0251 — a client-named regression baseline (host)', () => {
  it('the candidate run names the baseline it was given, and scoreDelta is the aggregate difference', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_ECHOED, DOC, judgeBaselineEchoed(r.base.runId, r.cand.events, r.cand.summary, r.base.summary));
  });

  it('only the tasks in both runs are paired (RFC 0244 §F)', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['regressionVerdict'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.regressionVerdict');
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_PAIRED, DOC_F, judgePaired(r.cand.summary));
  });

  it('equal paired scores never yield improved or regressed (RFC 0244 §F)', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['regressionVerdict'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.evalSuite.regressionVerdict');
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_NO_FALSE, DOC_F, judgeNoFalseVerdict(r.cand.summary));
  });

  it('an unknown baseline, and a run of another suite, are refused without the id', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const unknownId = unknownBeside(r.base.runId);
    const unknown = await create(CANDIDATE, { evalModes: ['golden', 'regression'], baselineRunId: unknownId });
    if (unknown === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expectAll(ID_REFUSED, DOC, judgeRefused(answer(unknown), unknownId, 'an unknown baselineRunId'));
    const other = isFixtureAdvertised(OTHER) ? await complete(OTHER, {}) : undefined;
    const res = other !== undefined && !('skip' in other) ? await create(CANDIDATE, { evalModes: ['golden', 'regression'], baselineRunId: other.runId }) : null;
    if (other !== undefined && !('skip' in other) && res !== null) expectAll(ID_REFUSED, DOC, judgeRefused(answer(res), other.runId, 'a baseline that ran another suite'));
  });

  it("another tenant's run is refused exactly as an id that never existed", async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const tenantB = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (!tenantB) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set');
    if (tenantB === process.env['OPENWOP_API_KEY']) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant');
    const foreign = await create(BASE, { evalModes: ['golden'] }, { Authorization: `Bearer ${tenantB}` });
    const foreignId = foreign && isRecord(foreign.json) && typeof foreign.json['runId'] === 'string' ? foreign.json['runId'] : undefined;
    if (foreignId === undefined) return softSkip('blocked', `tenant B's createRun of ${BASE} answered ${foreign?.status ?? 'nothing'}`);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const unknown = await create(CANDIDATE, { evalModes: ['golden', 'regression'], baselineRunId: unknownBeside(r.base.runId) });
    const viaForeign = await create(CANDIDATE, { evalModes: ['golden', 'regression'], baselineRunId: foreignId });
    if (unknown === null || viaForeign === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expectAll(ID_UNIFORM, DOC, judgeUniform(answer(unknown), answer(viaForeign), foreignId));
  });

  it('a baseline without regression, and regression without a baseline, are refused', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const r = await runs();
    if ('skip' in r) return softSkip(...r.skip);
    const noMode = await create(CANDIDATE, { evalModes: ['golden'], baselineRunId: r.base.runId });
    const noBase = await create(CANDIDATE, { evalModes: ['golden', 'regression'] });
    if (noMode === null || noBase === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expectAll(ID_FIELDS, DOC, judgeRefused(answer(noMode), undefined, 'baselineRunId without regression in evalModes'));
    expectAll(ID_FIELDS, DOC, judgeRefused(answer(noBase), undefined, 'regression in evalModes without baselineRunId'));
  });
});
