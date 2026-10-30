/**
 * v2 — the agent deployment lifecycle on the wire (RFC 0082 §B, §C, §E, §F;
 * the transition rules of RFC 0254). The rules are the `agents.deployment`
 * facet description in `spec/v2/facets/agents.schema.json` ("Transitions
 * (RFC 0254)"), `schemas/v2/agent-deployment.schema.json`,
 * `agent-deployment-transition.schema.json`, `listAgentDeployments` /
 * `transitionAgentDeployment` in `api/v2/openapi.yaml` and the registered
 * `409 deployment_state_conflict` in `spec/v2/errors.json`.
 *
 * Gated on `agents.deployment` and on the fixture `conformance-agent-channel-dispatch`
 * in discovery `fixtures`. At major 2, listing it states that the host holds an
 * `active` record of `core.conformance.channel-agent` on `stable` and a `draft`
 * one, and that the conformance credential's transitions of that agent pass no
 * approval or eval gate (contract in `conformance/fixtures.md`). Absent `states`
 * means all seven. The suite then, once per worker:
 *   list → run the fixture (R1) → unscoped promote → illegal pause / deprecate →
 *   promote draft straight to active → a transition into an unadvertised state →
 *   promote one step at a time to active on `stable` at 100 (the first step
 *   without `toState`) → run the fixture again (R2) → replay R1 → adjust-canary →
 *   rollback → pause and resume the version active on `stable` → read each
 *   accepted transition's management run.
 * Judges in `lib/deployment-lifecycle-witness.ts`.
 *   - `0082.list-valid` — the list is 200 and every record validates.
 *   - `0082.pin-recorded` — R1's `agent.invocation-started` carries
 *     `resolvedChannel: stable` and a version active on it.
 *   - `0082.scope-fail-closed` — `OPENWOP_TEST_LOW_SCOPE_KEY` (no `deploy:*`)
 *     is refused `403 forbidden`, a `WWW-Authenticate` challenge if present
 *     names `scope="deploy:*"`, and the record does not move. Unset key: `blocked`.
 *   - `0082.transition-illegal-refused` — `pause` and `deprecate` of a draft
 *     (each when its target state is advertised; else `adjust-canary` at 100)
 *     are `409 deployment_state_conflict` with `details.state` and
 *     `details.transition`, record unchanged.
 *   - `0082.promote-skip-refused` — promote of the draft with `toState: active`
 *     when `active` is not the next state is the same 409, record unchanged.
 *   - `0082.state-unadvertised-refused` — an otherwise legal transition into a
 *     state outside `states` is `400 validation_error`, record unchanged.
 *     Every state advertised, or `states` absent: `inapplicable`.
 *   - `0082.transition-legal` — each step over the advertised states is 200
 *     with a valid record in the next state, and the version ends `active` on
 *     `stable`. An advertised subset without `draft` and `active` fails here.
 *   - `0082.replay-pin-reread` — after the walk moved `stable` (R2 resolves the
 *     new version), a replay of R1 still records R1's version.
 *   - `0082.canary-adjusted` / `0082.canary-unsupported-refused` — by `canary`.
 *   - `0082.rollback-pointer` — with `rollback`, the version ends `rolled-back`
 *     and its `rollbackPointer` names the incumbent, listed `active` again.
 *   - `0082.resume-from-paused` — with `paused`, a pause then a `promote` of the
 *     version active on `stable` (the incumbent after a rollback) each answer
 *     200, ending `paused` then `active`.
 *   - `0082.transition-run-linked` — every 200 transition record carries
 *     `transitionRunId`.
 *   - `0082.transition-event-recorded` — that run's events include the
 *     transition's `deployment.*` event, valid against `run-event-payloads`
 *     (content-free: SECURITY `deployment-event-no-content-leak`).
 *
 * Not witnessed here: `authorization.decided` on the management run, the 202 of
 * a gated transition (no gated fixture), that a refused transition creates no
 * run (not portably observable), and a rollback with no prior version.
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md
 * @see RFCS/0254-deployment-transitions-at-v2.md
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPRequestInit } from '../lib/driver.js';
import { v2Discovery, v2RefValidator, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isRecord, pollTerminal, readEvents, type Ev } from '../lib/fixture-run-observer.js';
import {
  ALL_STATES, activeOn, expectedEvents, firstInvocation, judgeBound, judgeCanaryAdjusted, judgeEventRecorded, judgeList,
  judgePinned, judgeReplayPinned, judgeResumed, judgeRolledBack, judgeRunLinked, judgeScopeRefused, judgeStateConflict, judgeStep,
  judgeValidationRefused, pickDraft, promotionPath, recordOf, runIdOf, type Accepted, type Answer, type DeployFinding, type Validate,
} from '../lib/deployment-lifecycle-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'agents.schema.json §deployment, agent-deployment.schema.json, transitionAgentDeployment (RFC 0082, RFC 0254)';
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
const ID_SKIP = 'openwop.requirement.0082.promote-skip-refused';
const ID_UNADVERTISED = 'openwop.requirement.0082.state-unadvertised-refused';
const ID_LEGAL = 'openwop.requirement.0082.transition-legal';
const ID_REPLAY = 'openwop.requirement.0082.replay-pin-reread';
const ID_CANARY = 'openwop.requirement.0082.canary-adjusted';
const ID_CANARY_REFUSED = 'openwop.requirement.0082.canary-unsupported-refused';
const ID_ROLLBACK = 'openwop.requirement.0082.rollback-pointer';
const ID_RESUME = 'openwop.requirement.0082.resume-from-paused';
const ID_RUN_LINKED = 'openwop.requirement.0082.transition-run-linked';
const ID_EVENT = 'openwop.requirement.0082.transition-event-recorded';

type Rec = Record<string, unknown>;
type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
interface Gate { facet: Rec; states: readonly string[] | null; replay: boolean }
/** A refusal and the list read after it. */
interface Refusal { readonly before: Rec; readonly answer: Answer | null; readonly after: unknown }

interface Drive {
  list0: Answer | null;
  draft?: string | undefined;
  activeAtR1: readonly string[];
  r1?: { runId: string; pin: Rec | undefined } | string | undefined;
  scope?: Refusal | string | undefined;
  illegal?: Array<{ label: string; transition: string } & Refusal> | undefined;
  skip?: Refusal | string | undefined;
  unadvertised?: ({ state: string } & Refusal) | string | undefined;
  walk?: { steps: Array<{ toState: string; answer: Answer | null }>; after: unknown } | string | undefined;
  replay?: { source: string; moved: string; pin: Rec | undefined } | string | undefined;
  canary?: { answer: Answer | null; before: Rec; after: unknown } | string | undefined;
  rollback?: { answer: Answer | null; after: unknown } | string | undefined;
  resume?: { version: string; pause: Answer | null; resume: Answer | null; after: unknown } | string | undefined;
  /** Every transition answered 200, in order. */
  accepted: Accepted[];
}

async function ask(method: string, path: string, body?: unknown, bearer?: string): Promise<Answer | null> {
  const init: OpenWOPRequestInit = {
    ...(body === undefined ? {} : { body }),
    ...(bearer === undefined ? {} : { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } }),
  };
  try {
    const r = await driver.request(method, path, init);
    return { status: r.status, json: r.json, wwwAuthenticate: r.headers.get('www-authenticate') ?? undefined };
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

/** Absent `states` means all seven (RFC 0254 §B). */
const advertises = (g: Gate, state: string): boolean => g.states === null || g.states.includes(state);

/** The §B violation of an advertised subset without `draft` and `active`, or null. */
function subsetInvalid(g: Gate): string | null {
  const missing = ['draft', 'active'].filter((s) => !advertises(g, s));
  return missing.length === 0 ? null : `agents.deployment.states ${JSON.stringify(g.states)} omits ${missing.join(' and ')}; an advertised subset MUST include draft and active`;
}

/** Why the forward walk cannot run on this host, or null. */
function walkInapplicable(g: Gate): string | null {
  const invalid = subsetInvalid(g);
  if (invalid !== null) return invalid;
  const channels = Array.isArray(g.facet['channels']) ? g.facet['channels'] : [];
  if (!channels.includes(CHANNEL)) return `agents.deployment.channels does not list ${CHANNEL}`;
  return null;
}
const rollbackServed = (g: Gate): boolean => g.facet['rollback'] === true && advertises(g, 'rolled-back');
/** The state a promote of a draft moves to over the advertised states. */
const nextAfterDraft = (g: Gate): string | undefined => promotionPath(g.states)[1];

/**
 * Transitions a draft has no edge for, whose target the host advertises (an
 * unadvertised target is the 400 checked first): `pause` and `deprecate`, or,
 * when neither state is advertised, `adjust-canary` at 100.
 */
function illegalProbes(g: Gate): Array<{ label: string; body: { transition: string } & Rec }> {
  const out = (['pause', 'deprecate'] as const)
    .filter((t) => advertises(g, t === 'pause' ? 'paused' : 'deprecated'))
    .map((t) => ({ label: `${t} of a draft`, body: { transition: t } }));
  return out.length > 0 ? out : [{ label: 'adjust-canary of a draft', body: { transition: 'adjust-canary', canaryPercent: 100 } }];
}

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

const typeOf = (v1: string): string => PROFILE.eventType(v1) ?? v1;

/** A management run's events, read until the transition's `deployment.*` event appears or 10 s pass. */
async function managementEvents(x: Accepted, runId: string): Promise<Ev[] | undefined> {
  const want = expectedEvents(x);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const r = await ask('GET', `${PROFILE.runsPath}/${PROFILE.idSegment(runId)}/events/poll`);
    if (r?.status !== 200) return undefined;
    const events = await readEvents(PROFILE, runId);
    if (want.some((w) => events.some((e) => e.type === typeOf(w.v1) && w.matches(e.payload))) || Date.now() > deadline) return events;
    await new Promise((res) => setTimeout(res, 250));
  }
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
  const activeAtR1 = activeOn(records, CHANNEL);
  const d: Drive = { list0, draft: pickDraft(records), activeAtR1, accepted: [] };
  d.r1 = activeAtR1.length === 0 ? `the host lists ${FIXTURE} but no ${AGENT} record is active on ${CHANNEL}` : await runFixture();

  /** Send a transition by the conformance credential; a 200 joins `accepted`. */
  const send = async (label: string, body: Rec & { version: string; transition: string }): Promise<Answer | null> => {
    const fromState = recordOf(await list(), body.version)?.['state'];
    const answer = await transition(body);
    if (answer?.status === 200) d.accepted.push({ label, transition: body.transition, version: body.version, fromState: String(fromState), answer });
    return answer;
  };

  if (d.draft !== undefined) await forward(g, d, d.draft, send);
  d.resume = await resume(g, d, send);
  return d;
}

let eventsOnce: Promise<Map<string, Ev[] | undefined>> | undefined;
/** The events of every accepted transition's management run, read concurrently, once. */
function managementRuns(d: Drive): Promise<Map<string, Ev[] | undefined>> {
  eventsOnce ??= (async () => {
    const linked = d.accepted.flatMap((x) => { const id = runIdOf(x); return id === undefined ? [] : [{ x, id }]; });
    const read = await Promise.all(linked.map(async ({ x, id }) => [id, await managementEvents(x, id)] as const));
    return new Map(read);
  })();
  return eventsOnce;
}

type Send = (label: string, body: Rec & { version: string; transition: string }) => Promise<Answer | null>;

/** The refusals, the walk, the replay, canary and rollback, on the fixture's draft. */
async function forward(g: Gate, d: Drive, draft: string, send: Send): Promise<void> {
  const low = process.env['OPENWOP_TEST_LOW_SCOPE_KEY']?.trim();
  d.scope = !low
    ? 'OPENWOP_TEST_LOW_SCOPE_KEY (a key without any deploy:* scope) is not set'
    : await refuse(draft, { version: draft, transition: 'promote' }, low);

  d.illegal = [];
  for (const p of illegalProbes(g)) {
    const r = await refuse(draft, { version: draft, ...p.body });
    if (typeof r !== 'string') d.illegal.push({ label: p.label, transition: p.body.transition, ...r });
  }

  if (walkInapplicable(g) === null && nextAfterDraft(g) !== 'active') {
    d.skip = await refuse(draft, { version: draft, transition: 'promote', toState: 'active' });
  }

  const probe = unadvertisedProbe(g.states);
  if (probe !== undefined) {
    const version = probe.on === 'draft' ? draft : d.activeAtR1[0];
    if (version === undefined) d.unadvertised = `no ${AGENT} record is active on ${CHANNEL} to ${probe.transition}`;
    else {
      const r = await refuse(version, { version, transition: probe.transition, ...(probe.on === 'draft' ? { toState: probe.state } : {}) });
      d.unadvertised = typeof r === 'string' ? r : { state: probe.state, ...r };
    }
  }

  const why = walkInapplicable(g);
  if (why !== null) { d.walk = why; return; }
  const current = recordOf(await list(), draft)?.['state'];
  if (current !== 'draft') { d.walk = `${draft} is no longer listed as a draft (now ${JSON.stringify(current)})`; return; }
  const path = promotionPath(g.states).slice(1);
  const steps: Array<{ toState: string; answer: Answer | null }> = [];
  for (const [i, toState] of path.entries()) {
    const last = toState === 'active';
    // The first step omits toState: absent means the next state.
    const body = { version: draft, transition: 'promote', ...(i === 0 ? {} : { toState }), ...(last ? { channel: CHANNEL, canaryPercent: 100 } : {}) };
    const answer = await send(`promote ${draft} to ${toState}`, body);
    steps.push({ toState, answer });
    if (answer?.status !== 200) break;
  }
  d.walk = { steps, after: await list() };
  if (steps.length < path.length || steps.some((s) => s.answer?.status !== 200)) return;

  if (!g.replay) d.replay = 'the host does not advertise replay.modes including "replay"';
  else if (typeof d.r1 !== 'object') d.replay = d.r1 ?? 'R1 did not run';
  else if (typeof d.r1.pin?.['resolvedAgentVersion'] !== 'string') d.replay = 'R1 recorded no resolvedAgentVersion to re-read';
  else {
    const source = d.r1.pin['resolvedAgentVersion'] as string;
    const r2 = await runFixture();
    const moved = typeof r2 === 'string' ? undefined : r2.pin?.['resolvedAgentVersion'];
    if (typeof r2 === 'string') d.replay = r2;
    else if (moved !== draft || moved === source) d.replay = `the channel move is not observable: a fresh run resolved ${JSON.stringify(moved)} after ${draft} went active on ${CHANNEL} at 100`;
    else {
      const pin = await replayOf(d.r1.runId);
      d.replay = typeof pin === 'string' ? pin : { source, moved: draft, pin };
    }
  }

  const beforeCanary = recordOf(await list(), draft);
  if (beforeCanary === undefined) d.canary = `the record for ${draft} is no longer listed`;
  else {
    const answer = await send(`adjust-canary of ${draft} to ${CANARY}`, { version: draft, transition: 'adjust-canary', canaryPercent: CANARY });
    d.canary = { answer, before: beforeCanary, after: await list() };
  }

  if (!rollbackServed(g)) d.rollback = 'the host does not advertise agents.deployment.rollback with rolled-back in states';
  else if (d.activeAtR1.length === 0) d.rollback = `no version was active on ${CHANNEL} before the walk, so there is nothing to restore`;
  else {
    const answer = await send(`rollback of ${draft}`, { version: draft, transition: 'rollback', reason: 'conformance' });
    d.rollback = { answer, after: await list() };
  }
}

/**
 * Pause, then promote, the version active on `stable`: the incumbent when it
 * is active again (after a rollback, or never displaced), else the walked
 * version. Runs last, so no later leg depends on what it leaves.
 */
async function resume(g: Gate, d: Drive, send: Send): Promise<Drive['resume']> {
  if (!advertises(g, 'paused')) return 'agents.deployment.states does not advertise paused';
  const active = activeOn(await list(), CHANNEL);
  const version = active.find((v) => d.activeAtR1.includes(v)) ?? active[0];
  if (version === undefined) return `no ${AGENT} record is active on ${CHANNEL} to pause`;
  const pause = await send(`pause of ${version}`, { version, transition: 'pause' });
  const back = pause?.status === 200 ? await send(`promote of paused ${version}`, { version, transition: 'promote' }) : null;
  return { version, pause, resume: back, after: await list() };
}

function expectAll(id: string, findings: readonly DeployFinding[]): void {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
}
const NO_DRAFT = `the host lists ${FIXTURE} but holds no draft record of ${AGENT}`;
const record = v2Validator('agent-deployment');
const PAYLOADS: Record<string, Validate> = Object.fromEntries(
  ['deploymentPromoted', 'deploymentStateChanged', 'deploymentCanaryAdjusted', 'deploymentRolledBack']
    .map((def) => [def, v2RefValidator(`run-event-payloads.schema.json#/$defs/${def}`)]),
);

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

  it('a transition without the deploy:* scope is refused 403 forbidden and moves nothing', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.scope === undefined || typeof d.scope === 'string') return softSkip('blocked', d.scope ?? 'the unscoped transition was not sent');
    expectAll(ID_SCOPE, judgeScopeRefused(d.scope.answer, d.scope.before, d.scope.after));
  });

  it('a pause or deprecate of a draft is 409 deployment_state_conflict and moves nothing', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.illegal === undefined || d.illegal.length === 0) return softSkip('blocked', `the draft ${d.draft} was not listed when the illegal transitions were sent`);
    expectAll(ID_ILLEGAL, d.illegal.flatMap((x) => judgeStateConflict(x.label, x.transition, x.answer, x.before, x.after)));
  });

  it('a promote of a draft straight to active is 409 deployment_state_conflict and moves nothing', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', why);
    if (nextAfterDraft(g) === 'active') return softSkip('inapplicable', 'the host advertises neither test nor staged, so active is the next state after draft and the promote is legal');
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.skip === undefined || typeof d.skip === 'string') return softSkip('blocked', d.skip ?? 'the skipping promote was not sent');
    expectAll(ID_SKIP, judgeStateConflict('promote of a draft straight to active', 'promote', d.skip.answer, d.skip.before, d.skip.after));
  });

  it('a transition into a state the host does not advertise is a validation_error', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const states = g.states;
    if (states === null) return softSkip('inapplicable', 'agents.deployment.states is absent, which means all seven, so no state is unadvertised');
    if (ALL_STATES.every((s) => states.includes(s))) return softSkip('inapplicable', 'the host advertises all seven states, so no state is unadvertised');
    if (unadvertisedProbe(states) === undefined) return softSkip('inapplicable', 'every unadvertised state is one no legal transition from a draft or the active incumbent enters, so a refusal could not be told apart from an illegal-transition refusal');
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.unadvertised === undefined || typeof d.unadvertised === 'string') return softSkip('blocked', d.unadvertised ?? 'the probe was not sent');
    expectAll(ID_UNADVERTISED, judgeValidationRefused(`a transition into unadvertised ${d.unadvertised.state}`, d.unadvertised.answer, d.unadvertised.before, d.unadvertised.after));
  });

  it('a draft promotes one step at a time over the advertised states to active on a channel', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const invalid = subsetInvalid(g);
    expectAll(ID_LEGAL, invalid === null ? [] : [{ ok: false, message: invalid }]);
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', why);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.walk === undefined || typeof d.walk === 'string') return softSkip('blocked', d.walk ?? 'the walk did not run');
    const version = d.draft;
    const findings = d.walk.steps.flatMap((s) => judgeStep(s.answer, version, s.toState, record));
    const done = d.walk.steps.length === promotionPath(g.states).length - 1 && d.walk.steps.every((s) => s.answer?.status === 200);
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

  it('a rollback restores the incumbent and points at it', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (!rollbackServed(g)) return softSkip('inapplicable', 'the host does not advertise agents.deployment.rollback with rolled-back in states');
    const why = walkInapplicable(g);
    if (why !== null) return softSkip('inapplicable', `no active version to roll back: ${why}`);
    const d = await lifecycle(g);
    if (d.draft === undefined) return softSkip('blocked', NO_DRAFT);
    if (d.rollback === undefined || typeof d.rollback === 'string') return softSkip('blocked', d.rollback ?? 'the walk did not reach active');
    expectAll(ID_ROLLBACK, judgeRolledBack(d.rollback.answer, d.draft, d.activeAtR1, d.rollback.after, record));
  });

  it('a paused version resumes to active by promote', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (!advertises(g, 'paused')) return softSkip('inapplicable', 'agents.deployment.states does not advertise paused');
    const d = await lifecycle(g);
    if (d.resume === undefined || typeof d.resume === 'string') return softSkip('blocked', d.resume ?? 'the pause was not sent');
    expectAll(ID_RESUME, judgeResumed(d.resume.pause, d.resume.resume, d.resume.version, d.resume.after, record));
  });

  it('every accepted transition names its deployment-management run', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    if (d.accepted.length === 0) return softSkip('blocked', 'no transition answered 200, so no record to read transitionRunId from');
    expectAll(ID_RUN_LINKED, judgeRunLinked(d.accepted));
  });

  it('the management run records the transition\'s content-free deployment event', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const d = await lifecycle(g);
    const linked = d.accepted.filter((x) => runIdOf(x) !== undefined);
    if (linked.length === 0) return softSkip('blocked', 'no 200 transition record named a transitionRunId, so there is no management run to read');
    const events = await managementRuns(d);
    expectAll(ID_EVENT, linked.flatMap((x) => judgeEventRecorded(x, events.get(runIdOf(x) ?? ''), typeOf, PAYLOADS)));
  });
});
