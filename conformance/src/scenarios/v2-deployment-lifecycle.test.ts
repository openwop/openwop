/**
 * v2 — the agent deployment lifecycle on the wire (RFC 0082 §B, §C, §E, §F).
 * The rules are the `agents.deployment` facet description in
 * `spec/v2/facets/agents.schema.json`, `schemas/v2/agent-deployment.schema.json`
 * (the record and its legal transitions), `agent-deployment-transition.schema.json`
 * and `listAgentDeployments` / `transitionAgentDeployment` in `api/v2/openapi.yaml`.
 *
 * Gated on `agents.deployment` and on the fixture `conformance-agent-channel-dispatch`
 * in discovery `fixtures`. At major 2, listing it states that the host holds an
 * `active` record of `core.conformance.channel-agent` on `stable` and a `draft`
 * one, and that the conformance credential's transitions of that agent pass no
 * approval or eval gate (contract in `conformance/fixtures.md`). The suite then,
 * once per worker:
 *   list → run the fixture (R1) → unscoped promote → illegal pause / deprecate →
 *   a transition into an unadvertised state → promote draft→test→staged→active on
 *   `stable` at 100 → run the fixture again (R2) → replay R1 → adjust-canary →
 *   rollback → list.
 * Judges in `lib/deployment-lifecycle-witness.ts`.
 *   - `0082.list-valid` — the list is 200 and every record validates.
 *   - `0082.pin-recorded` — R1's `agent.invocation-started` carries
 *     `resolvedChannel: stable` and a version active on it.
 *   - `0082.scope-fail-closed` — `OPENWOP_TEST_LOW_SCOPE_KEY` (no `deploy:*`)
 *     is refused 403 and the record does not move. Unset key: `blocked`.
 *   - `0082.transition-illegal-refused` — `pause` and `deprecate` of a draft
 *     (both are defined from `active` only) are refused 4xx, record unchanged.
 *   - `0082.state-unadvertised-refused` — an otherwise legal transition into a
 *     state outside `states` (promote a draft to `test`, or pause, deprecate or
 *     roll back the incumbent) is `400 validation_error`, record unchanged.
 *     Every state advertised: `inapplicable`.
 *   - `0082.transition-legal` — each step of the walk is 200 with a valid record
 *     in the target state, and the version ends `active` on `stable`.
 *   - `0082.replay-pin-reread` — after the walk moved `stable` (R2 resolves the
 *     new version), a replay of R1 still records R1's version.
 *   - `0082.canary-adjusted` / `0082.canary-unsupported-refused` — by `canary`.
 *   - `0082.rollback-pointer` — with `rollback`, the version ends `rolled-back`
 *     and its `rollbackPointer` names a version listed `active`.
 *
 * Not witnessed here: the `deployment.*` events and `authorization.decided`
 * (they live on the deployment-management run, which no operation names).
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPRequestInit } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isRecord, pollTerminal, readEvents } from '../lib/fixture-run-observer.js';
import {
  ALL_STATES, PROMOTION_PATH, activeOn, firstInvocation, judgeBound, judgeCanaryAdjusted, judgeIllegalRefused, judgeList,
  judgePinned, judgeReplayPinned, judgeRolledBack, judgeScopeRefused, judgeStep, judgeValidationRefused, pickDraft, recordOf,
  type Answer, type DeployFinding,
} from '../lib/deployment-lifecycle-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'agents.schema.json §deployment, agent-deployment.schema.json, transitionAgentDeployment (RFC 0082)';
const FIXTURE = 'conformance-agent-channel-dispatch';
const AGENT = 'core.conformance.channel-agent';
const CHANNEL = 'stable';
const CANARY = 50;
const DEPLOYMENTS = `/agents/${encodeURIComponent(AGENT)}/deployments`;
const INVOCATION_STARTED = PROFILE.eventType('agent.invocation.started') ?? 'agent.invocation-started';
const ID_LIST = 'openwop.requirement.0082.list-valid';
const ID_PIN = 'openwop.requirement.0082.pin-recorded';
const ID_SCOPE = 'openwop.requirement.0082.scope-fail-closed';
const ID_ILLEGAL = 'openwop.requirement.0082.transition-illegal-refused';
const ID_UNADVERTISED = 'openwop.requirement.0082.state-unadvertised-refused';
const ID_LEGAL = 'openwop.requirement.0082.transition-legal';
const ID_REPLAY = 'openwop.requirement.0082.replay-pin-reread';
const ID_CANARY = 'openwop.requirement.0082.canary-adjusted';
const ID_CANARY_REFUSED = 'openwop.requirement.0082.canary-unsupported-refused';
const ID_ROLLBACK = 'openwop.requirement.0082.rollback-pointer';

type Rec = Record<string, unknown>;
type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
interface Gate { facet: Rec; states: readonly string[] | null; replay: boolean }
/** A refusal and the list read after it. */
interface Refusal { readonly before: Rec; readonly answer: Answer | null; readonly after: unknown }

interface Drive {
  readonly list0: Answer | null;
  readonly draft?: string | undefined;
  readonly activeAtR1: readonly string[];
  readonly r1?: { runId: string; pin: Rec | undefined } | string | undefined;
  readonly scope?: Refusal | string | undefined;
  readonly illegal?: Array<{ label: string } & Refusal> | undefined;
  readonly unadvertised?: ({ state: string } & Refusal) | string | undefined;
  readonly walk?: { steps: Array<{ toState: string; answer: Answer | null }>; after: unknown } | string | undefined;
  readonly replay?: { source: string; moved: string; pin: Rec | undefined } | string | undefined;
  readonly canary?: { answer: Answer | null; before: Rec; after: unknown } | string | undefined;
  readonly rollback?: { answer: Answer | null; after: unknown } | string | undefined;
}

async function ask(method: string, path: string, body?: unknown, bearer?: string): Promise<Answer | null> {
  const init: OpenWOPRequestInit = {
    ...(body === undefined ? {} : { body }),
    ...(bearer === undefined ? {} : { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } }),
  };
  try {
    const r = await driver.request(method, path, init);
    return { status: r.status, json: r.json };
  } catch {
    return null;
  }
}
const list = async (): Promise<unknown> => { const a = await ask('GET', DEPLOYMENTS); return a?.status === 200 ? a.json : undefined; };
const transition = (body: Rec, bearer?: string): Promise<Answer | null> => ask('POST', DEPLOYMENTS, body, bearer);

async function gate(): Promise<Skip | Gate> {
  let doc: Rec | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0'] };
  const agents = doc['agents'];
  if (!isRecord(agents) || !isRecord(agents['deployment'])) return { skip: ['inapplicable', 'the host does not advertise agents.deployment'] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['inapplicable', `the host does not advertise fixture ${FIXTURE}`] };
  const facet = agents['deployment'];
  const states = Array.isArray(facet['states']) ? facet['states'].filter((s): s is string => typeof s === 'string') : null;
  const replay = isRecord(doc['replay']) && Array.isArray(doc['replay']['modes']) && (doc['replay']['modes'] as unknown[]).includes('replay');
  return { facet, states, replay };
}

/** Why the forward walk cannot run on this host, or null. */
function walkInapplicable(g: Gate): string | null {
  const states = g.states;
  if (states === null) return 'agents.deployment.states is not advertised, so the suite cannot tell which transitions the host implements';
  const missing = PROMOTION_PATH.filter((s) => !states.includes(s));
  if (missing.length > 0) return `agents.deployment.states omits ${missing.join(', ')}, so the draft→test→staged→active path is not the host's`;
  const channels = Array.isArray(g.facet['channels']) ? g.facet['channels'] : [];
  if (!channels.includes(CHANNEL)) return `agents.deployment.channels does not list ${CHANNEL}`;
  return null;
}
const rollbackServed = (g: Gate): boolean => g.facet['rollback'] === true && g.states !== null && g.states.includes('rolled-back');

/**
 * A transition that the state machine allows but whose target state is not
 * advertised, so the only ground for refusing it is `states`: promote a draft
 * into `test`, or pause, deprecate or roll back the active incumbent.
 */
const PROBES = [
  { state: 'test', on: 'draft', transition: 'promote' },
  { state: 'paused', on: 'active', transition: 'pause' },
  { state: 'deprecated', on: 'active', transition: 'deprecate' },
  { state: 'rolled-back', on: 'active', transition: 'rollback' },
] as const;
function unadvertisedProbe(states: readonly string[] | null): (typeof PROBES)[number] | undefined {
  return states === null ? undefined : PROBES.find((p) => !states.includes(p.state));
}

async function runFixture(): Promise<{ runId: string; pin: Rec | undefined } | string> {
  const created = await ask('POST', PROFILE.runsPath, { workflowId: FIXTURE });
  const runId = isRecord(created?.json) && typeof created.json['runId'] === 'string' ? created.json['runId'] : undefined;
  if ((created?.status !== 201 && created?.status !== 202) || runId === undefined) return `createRun of ${FIXTURE} answered ${created?.status ?? 'nothing'}`;
  const end = await pollTerminal(PROFILE, runId, { timeoutMs: 30_000 });
  if (end.snapshot['status'] !== 'completed') return `run ${runId} of ${FIXTURE} ended ${String(end.snapshot['status'])}, not completed`;
  return { runId, pin: firstInvocation(await readEvents(PROFILE, runId), INVOCATION_STARTED) };
}

async function replayOf(runId: string): Promise<Rec | undefined | string> {
  const fork = await ask('POST', `${PROFILE.runsPath}/${PROFILE.idSegment(runId)}:fork`, { mode: 'replay' });
  const forkId = isRecord(fork?.json) && typeof fork.json['runId'] === 'string' ? fork.json['runId'] : undefined;
  if (fork?.status !== 201 || forkId === undefined) return `POST /runs/{runId}:fork {mode: replay} answered ${fork?.status ?? 'nothing'}`;
  await pollTerminal(PROFILE, forkId, { timeoutMs: 30_000 });
  return firstInvocation(await readEvents(PROFILE, forkId), INVOCATION_STARTED);
}

async function refuse(version: string, body: Rec, bearer?: string): Promise<Refusal | string> {
  const before = recordOf(await list(), version);
  if (before === undefined) return `the record for ${version} is no longer listed`;
  const answer = await transition(body, bearer);
  return { before, answer, after: await list() };
}

let once: Promise<Drive> | undefined;
/** One lifecycle per worker: every leg judges a slice of it. */
function lifecycle(g: Gate): Promise<Drive> {
  once ??= drive(g);
  return once;
}

async function drive(g: Gate): Promise<Drive> {
  const list0 = await ask('GET', DEPLOYMENTS);
  const records = list0?.status === 200 ? list0.json : undefined;
  const draft = pickDraft(records);
  const activeAtR1 = activeOn(records, CHANNEL);
  const r1 = activeAtR1.length === 0 ? `the host lists ${FIXTURE} but no ${AGENT} record is active on ${CHANNEL}` : await runFixture();
  if (draft === undefined) return { list0, activeAtR1, r1 };
  const noDraft = `the record for ${draft} is no longer listed`;

  const low = process.env['OPENWOP_TEST_LOW_SCOPE_KEY']?.trim();
  const scope = !low
    ? 'OPENWOP_TEST_LOW_SCOPE_KEY (a key without any deploy:* scope) is not set'
    : await refuse(draft, { version: draft, transition: 'promote', toState: 'test' }, low);

  const illegal: Array<{ label: string } & Refusal> = [];
  for (const t of ['pause', 'deprecate'] as const) {
    const r = await refuse(draft, { version: draft, transition: t });
    if (typeof r !== 'string') illegal.push({ label: `${t} of a draft`, ...r });
  }

  const probe = unadvertisedProbe(g.states);
  let unadvertised: Drive['unadvertised'];
  if (probe !== undefined) {
    const version = probe.on === 'draft' ? draft : activeAtR1[0];
    if (version === undefined) unadvertised = `no ${AGENT} record is active on ${CHANNEL} to ${probe.transition}`;
    else {
      const r = await refuse(version, { version, transition: probe.transition, ...(probe.on === 'draft' ? { toState: probe.state } : {}) });
      unadvertised = typeof r === 'string' ? r : { state: probe.state, ...r };
    }
  }

  const why = walkInapplicable(g);
  if (why !== null) return { list0, draft, activeAtR1, r1, scope, illegal, unadvertised, walk: why };
  if (recordOf(await list(), draft)?.['state'] !== 'draft') return { list0, draft, activeAtR1, r1, scope, illegal, unadvertised, walk: `${draft} is no longer listed as a draft` };
  const steps: Array<{ toState: string; answer: Answer | null }> = [];
  for (const toState of PROMOTION_PATH.slice(1)) {
    const last = toState === 'active';
    const answer = await transition({ version: draft, transition: 'promote', toState, ...(last ? { channel: CHANNEL, canaryPercent: 100 } : {}) });
    steps.push({ toState, answer });
    if (answer?.status !== 200) break;
  }
  const walk = { steps, after: await list() };
  if (steps.length < 3 || steps.some((s) => s.answer?.status !== 200)) return { list0, draft, activeAtR1, r1, scope, illegal, unadvertised, walk };

  let replay: Drive['replay'];
  if (!g.replay) replay = 'the host does not advertise replay.modes including "replay"';
  else if (typeof r1 === 'string') replay = r1;
  else if (typeof r1.pin?.['resolvedAgentVersion'] !== 'string') replay = 'R1 recorded no resolvedAgentVersion to re-read';
  else {
    const source = r1.pin['resolvedAgentVersion'] as string;
    const r2 = await runFixture();
    const moved = typeof r2 === 'string' ? undefined : r2.pin?.['resolvedAgentVersion'];
    if (typeof r2 === 'string') replay = r2;
    else if (moved !== draft || moved === source) replay = `the channel move is not observable: a fresh run resolved ${JSON.stringify(moved)} after ${draft} went active on ${CHANNEL} at 100`;
    else {
      const pin = await replayOf(r1.runId);
      replay = typeof pin === 'string' ? pin : { source, moved: draft, pin };
    }
  }

  const beforeCanary = recordOf(await list(), draft);
  let canary: Drive['canary'];
  if (beforeCanary === undefined) canary = noDraft;
  else {
    const answer = await transition({ version: draft, transition: 'adjust-canary', canaryPercent: CANARY });
    canary = { answer, before: beforeCanary, after: await list() };
  }

  let rollback: Drive['rollback'];
  const priorActive = activeOn(await list(), CHANNEL).filter((v) => v !== draft);
  if (!rollbackServed(g)) rollback = 'the host does not advertise agents.deployment.rollback with rolled-back in states';
  else if (priorActive.length === 0) rollback = `no version other than ${draft} is active on ${CHANNEL}, so there is nothing to restore`;
  else {
    const answer = await transition({ version: draft, transition: 'rollback', reason: 'conformance' });
    rollback = { answer, after: await list() };
  }
  return { list0, draft, activeAtR1, r1, scope, illegal, unadvertised, walk, replay, canary, rollback };
}

function expectAll(id: string, findings: readonly DeployFinding[]): void {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
}
const NO_DRAFT = `the host lists ${FIXTURE} but holds no draft record of ${AGENT}`;
const record = v2Validator('agent-deployment');

describe('v2 RFC 0082 — the agent deployment lifecycle (host)', () => {
  it('lists valid deployment records of the fixture agent', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    expectAll(ID_LIST, judgeList(d.list0, AGENT, record));
  });

  it('a channel-bound run records the channel and the version it resolved', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    if (d.r1 === undefined || typeof d.r1 === 'string') return softSkip('blocked', d.r1 ?? 'the fixture run did not start');
    expectAll(ID_PIN, judgePinned(d.r1.pin, CHANNEL, d.activeAtR1));
  });

  it('a transition without a deploy:* scope is refused and moves nothing', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.scope === undefined || typeof d.scope === 'string') return softSkip('blocked', d.scope ?? 'the unscoped transition was not sent');
    expectAll(ID_SCOPE, judgeScopeRefused(d.scope.answer, d.scope.before, d.scope.after));
  });

  it('a pause or deprecate of a draft is refused and moves nothing', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.illegal === undefined || d.illegal.length === 0) return softSkip('blocked', `the draft ${d.draft} was not listed when the illegal transitions were sent`);
    expectAll(ID_ILLEGAL, d.illegal.flatMap((x) => judgeIllegalRefused(x.label, x.answer, x.before, x.after)));
  });

  it('a transition into a state the host does not advertise is a validation_error', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const states = g.states;
    if (states === null) return softSkip('inapplicable', 'agents.deployment.states is not advertised');
    if (ALL_STATES.every((s) => states.includes(s))) return softSkip('inapplicable', 'the host advertises all seven states, so no state is unadvertised');
    if (unadvertisedProbe(states) === undefined) return softSkip('inapplicable', 'every unadvertised state is one no legal transition from a draft or the active incumbent enters, so a refusal could not be told apart from an illegal-transition refusal');
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.unadvertised === undefined || typeof d.unadvertised === 'string') return softSkip('blocked', d.unadvertised ?? 'the promote was not sent');
    expectAll(ID_UNADVERTISED, judgeValidationRefused(`a transition into unadvertised ${d.unadvertised.state}`, d.unadvertised.answer, d.unadvertised.before, d.unadvertised.after));
  });

  it('a draft promotes through test and staged to active on a channel', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', why);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.walk === undefined || typeof d.walk === 'string') return softSkip('blocked', d.walk ?? 'the walk did not run');
    const version = d.draft;
    const findings = d.walk.steps.flatMap((s) => judgeStep(s.answer, version, s.toState, record));
    const done = d.walk.steps.length === 3 && d.walk.steps.every((s) => s.answer?.status === 200);
    expectAll(ID_LEGAL, done ? [...findings, ...judgeBound(d.walk.after, version, CHANNEL)] : findings);
  });

  it('a replay re-reads the recorded version after the channel moved', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (!g.replay) return softSkip('inapplicable', 'the host does not advertise replay.modes including "replay"');
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', `the channel cannot be moved: ${why}`);
    const d = await lifecycle(g);
    if (d.replay === undefined || typeof d.replay === 'string') return softSkip('blocked', d.replay ?? (d.draft === undefined ? NO_DRAFT : 'the walk did not reach active, so the channel never moved'));
    expectAll(ID_REPLAY, judgeReplayPinned(d.replay.source, d.replay.moved, d.replay.pin));
  });

  it('adjust-canary sets the share on a canary host', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['canary'] !== true) return softSkip('inapplicable', 'the host does not advertise agents.deployment.canary');
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', `no active version to adjust: ${why}`);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.canary === undefined || typeof d.canary === 'string') return softSkip('blocked', d.canary ?? 'the walk did not reach active');
    expectAll(ID_CANARY, judgeCanaryAdjusted(d.canary.answer, d.draft, CANARY, d.canary.after, record));
  });

  it('a host without canary refuses a share below 100', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['canary'] === true) return softSkip('inapplicable', 'the host advertises agents.deployment.canary');
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', `no active version to adjust: ${why}`);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.canary === undefined || typeof d.canary === 'string') return softSkip('blocked', d.canary ?? 'the walk did not reach active');
    expectAll(ID_CANARY_REFUSED, judgeValidationRefused(`adjust-canary to ${CANARY} without canary`, d.canary.answer, d.canary.before, d.canary.after));
  });

  it('a rollback points at the version it restored to active', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (!rollbackServed(g)) return softSkip('inapplicable', 'the host does not advertise agents.deployment.rollback with rolled-back in states');
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', `no active version to roll back: ${why}`);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.rollback === undefined || typeof d.rollback === 'string') return softSkip('blocked', d.rollback ?? 'the walk did not reach active');
    expectAll(ID_ROLLBACK, judgeRolledBack(d.rollback.answer, d.draft, d.rollback.after, record));
  });
});
