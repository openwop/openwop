/**
 * The `core.dispatch` witnesses, fixture ports through `POST /runs` and
 * `events/poll`. No seam.
 *
 * Input mapping (`spec/v2/facets/agents.schema.json` `dispatchMapping`;
 * `schemas/v2/dispatch-config.schema.json` `inputMapping`), on
 * `conformance-dispatch-input-mapping[-no-default]` →
 * `conformance-dispatch-input-mapping-child`. A host advertising
 * `agents.dispatchMapping: true` honors `inputMapping`, "building child inputs
 * from parent variables before dispatch": the child receives
 * `inputs[childKey] = parentVariables[parentKey]`.
 *   projection  the child's `inputs.childGreeting` is the parent's
 *               `parentName` ("Alice");
 *   unset       an unset `parentName` projects to undefined — the child's
 *               `inputs.childGreeting` is absent, never `null` or a placeholder.
 *
 * Supervisor loop (`execution.md` §`multiAgent`, level 1 and level 5), on
 * `conformance-dispatch-loop`:
 *   terminates  the run completes; each turn records a decision as
 *               `runOrchestrator.decided` (`orchestrator.decided` at major 2),
 *               and the last is `terminate` — `terminate` completes the run,
 *               so no decision follows it;
 *   decisions   every decision payload is well-formed (the decision checked
 *               branch by branch — see {@link decisionBranchValidator}), and
 *               its `agentId` is the same for the run's lifetime;
 *   iteration   at `executionModel.version >= 5`, every decision carries
 *               `iteration`, 1-based, incremented by exactly 1 per turn.
 *
 * The drivers observe and assert nothing; the judges are pure, proven in
 * `dispatch-witness.test.ts`.
 */

import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';
import {
  completionsOf, finding, isRecord, observed, observeRun, readRun, runCompleted, skip,
  type Ev, type Finding, type ObservedRun, type ObserveOpts, type Outcome, type RunRead, type Skip, type Validate,
} from './fixture-run-observer.js';

export const DISPATCH_PARENT_FIXTURE = 'conformance-dispatch-input-mapping';
export const DISPATCH_NO_DEFAULT_FIXTURE = 'conformance-dispatch-input-mapping-no-default';
export const DISPATCH_CHILD_FIXTURE = 'conformance-dispatch-input-mapping-child';
export const DISPATCH_NODE = 'dispatch';
export const LOOP_FIXTURE = 'conformance-dispatch-loop';

const DOC_MAP = 'agents.schema.json dispatchMapping; dispatch-config.schema.json inputMapping';
const DOC_LOOP = 'execution.md §multiAgent';

export interface DispatchObservation {
  readonly parent: ObservedRun;
  /** How the child was found: the parent's `node.dispatched`, or the dispatch node's `node.completed` outputs. */
  readonly childRunId: string | undefined;
  readonly child: RunRead | undefined;
}

/** `agents.dispatchMapping: true`, the parent fixture and the child fixture. */
export function dispatchMappingGate(profile: MajorProfile, doc: unknown, fixture: string): Skip | null {
  const agents = profile.family(doc, 'agents');
  if (agents === null) return skip('inapplicable', 'the host does not advertise agents');
  if (agents['dispatchMapping'] !== true) return skip('inapplicable', 'the host does not advertise agents.dispatchMapping: true, so inputMapping does not bind it (it must refuse the field at registration instead)');
  for (const id of [fixture, DISPATCH_CHILD_FIXTURE]) if (!isFixtureAdvertised(id)) return skip('inapplicable', `fixture ${id} is not advertised — the fixture is the opt-in`);
  return null;
}

/** Find the dispatched child: `node.dispatched` naming the child workflow, else the dispatch node's outputs. */
export function locateChild(profile: MajorProfile, events: readonly Ev[], childWorkflowId: string): string | undefined {
  const dispatchedType = profile.eventType('node.dispatched') ?? 'node.dispatched';
  const d = events.find((e) => e.type === dispatchedType && e.payload['childWorkflowId'] === childWorkflowId && typeof e.payload['childRunId'] === 'string');
  if (d !== undefined) return d.payload['childRunId'] as string;
  for (const c of completionsOf(events, DISPATCH_NODE)) {
    const out = c.payload['outputs'];
    if (isRecord(out) && typeof out['childRunId'] === 'string' && out['childRunId'].length > 0) return out['childRunId'];
  }
  return undefined;
}

/** Run a dispatch input-mapping fixture and follow it to the child. Asserts nothing. */
export async function driveDispatchMapping(profile: MajorProfile, doc: unknown, fixture: string, opts: ObserveOpts = {}): Promise<Skip | DispatchObservation> {
  const g = dispatchMappingGate(profile, doc, fixture);
  if (g) return g;
  const parent = await observeRun(profile, fixture, opts);
  const childRunId = locateChild(profile, parent.events, DISPATCH_CHILD_FIXTURE);
  return { parent, childRunId, child: childRunId === undefined ? undefined : await readRun(profile, childRunId) };
}

function childInputs(o: DispatchObservation): Skip | { inputs: Record<string, unknown>; reached: Finding[] } {
  if (o.parent.createStatus !== 201 && o.parent.createStatus !== 202) return { inputs: {}, reached: runCompleted(o.parent) };
  if (o.childRunId === undefined) return skip('inapplicable', `no v2 rule requires a host to expose the dispatched child, and this one does not: the parent log names no ${DISPATCH_CHILD_FIXTURE} run (no node.dispatched, no dispatch-node outputs.childRunId), so its inputs cannot be read`);
  const c = o.child;
  return {
    inputs: c !== undefined && isRecord(c.snapshot['inputs']) ? c.snapshot['inputs'] : {},
    reached: [
      ...runCompleted(o.parent),
      finding(c?.status === 200, 'runs.md getRun', `the dispatched child run MUST be readable (GET answered ${String(c?.status)})`),
      finding(c?.snapshot['status'] === 'completed', `fixtures.md ${DISPATCH_CHILD_FIXTURE}`, `the child run MUST end completed (got ${JSON.stringify(c?.snapshot['status'])})`),
    ],
  };
}

/** Leg: the child's inputs carry the parent's projected variable. Pure. */
export function judgeProjection(o: DispatchObservation): Outcome {
  const c = childInputs(o);
  if ('kind' in c) return c;
  return observed([
    ...c.reached,
    finding(c.inputs['childGreeting'] === 'Alice', DOC_MAP, `the child MUST receive inputs.childGreeting = parentVariables.parentName ("Alice"; got ${JSON.stringify(c.inputs['childGreeting'])})`),
  ]);
}

/** Leg: an unset parent variable projects to undefined — absent, never null. Pure. */
export function judgeUnsetProjection(o: DispatchObservation): Outcome {
  const c = childInputs(o);
  if ('kind' in c) return c;
  return observed([
    ...c.reached,
    finding(c.inputs['childGreeting'] !== null, `${DOC_MAP} (mirrors execution.md §subWorkflow inputMapping: never null)`, 'an unset parent variable MUST NOT project as null'),
    finding(!('childGreeting' in c.inputs), DOC_MAP, `inputs[childKey] = parentVariables[parentKey] is undefined for an unset parent variable: inputs.childGreeting MUST be absent (got ${JSON.stringify(c.inputs['childGreeting'])})`),
  ]);
}

export interface LoopObservation { readonly run: ObservedRun; readonly decidedType: string; readonly version: number }

/** `multiAgent.executionModel.version >= 1`, the fixture, and this major's event name. */
export function loopGate(profile: MajorProfile, doc: unknown): Skip | { decidedType: string; version: number } {
  const ma = profile.family(doc, 'multiAgent');
  const em = isRecord(ma?.['executionModel']) ? ma['executionModel'] : undefined;
  const version = em?.['version'];
  if (typeof version !== 'number' || version < 1) return skip('inapplicable', 'the host does not advertise multiAgent.executionModel (version >= 1), so the supervisor loop does not bind it');
  if (!isFixtureAdvertised(LOOP_FIXTURE)) return skip('inapplicable', `fixture ${LOOP_FIXTURE} is not advertised — the fixture is the opt-in`);
  const decidedType = profile.eventType('runOrchestrator.decided');
  if (decidedType === undefined) return skip('blocked', 'the event codemap is not on disk in this layout — the suite will not guess an event name');
  return { decidedType, version };
}

/** Run the loop fixture. Asserts nothing. */
export async function driveLoop(profile: MajorProfile, doc: unknown, opts: ObserveOpts = {}): Promise<Skip | LoopObservation> {
  const g = loopGate(profile, doc);
  if ('kind' in g) return g;
  return { run: await observeRun(profile, LOOP_FIXTURE, opts), ...g };
}

const decisions = (o: LoopObservation): Ev[] => o.run.events.filter((e) => e.type === o.decidedType);
const kindOf = (e: Ev): unknown => (isRecord(e.payload['decision']) ? e.payload['decision']['kind'] : undefined);

/** Leg: decisions are recorded, the last is `terminate`, and it completes the run. Pure. */
export function judgeLoopTerminates(o: LoopObservation): Outcome {
  const ds = decisions(o);
  const firstTerminate = ds.findIndex((e) => kindOf(e) === 'terminate');
  return observed([
    ...runCompleted(o.run),
    finding(ds.length > 0, `${DOC_LOOP} (level 1)`, `each turn MUST record its decision as ${o.decidedType} (got none)`),
    finding(ds.length > 0 && kindOf(ds[ds.length - 1]!) === 'terminate', `${DOC_LOOP} (level 1: terminate completes the run)`, `the completed loop's last decision MUST be terminate (got ${JSON.stringify(ds.map(kindOf))})`),
    finding(firstTerminate === -1 || firstTerminate === ds.length - 1, `${DOC_LOOP} (level 1: terminate completes the run)`, `no decision may follow a terminate (got ${JSON.stringify(ds.map(kindOf))})`),
  ]);
}

/**
 * A validator for one `OrchestratorDecision`, by its `oneOf` branches.
 *
 * `schemas/v2/orchestrator-decision.schema.json` closes its ROOT with
 * `additionalProperties: false` and declares no root `properties`, so the
 * schema as a whole rejects every decision, `kind` included (the v1 root is
 * open). Validating against it would convict every host. Until the corpus
 * fixes it, a decision is valid when exactly one branch accepts it.
 */
export function decisionBranchValidator(branch: (index: number) => Validate, branches = 3): Validate {
  const vs = Array.from({ length: branches }, (_, i) => branch(i));
  return (doc) => {
    const results = vs.map((v) => v(doc));
    const ok = results.filter((r) => r.ok).length === 1;
    return { ok, errors: ok ? '' : results.map((r, i) => `branch ${i}: ${r.errors || 'accepted'}`).join(' | ') };
  };
}

const PAYLOAD_KEYS = new Set(['agentId', 'decision', 'iteration', 'causationHostId']);
const AGENT_ID = /^[A-Za-z0-9._~:-]{1,128}$/;

/**
 * Leg: every decision payload is well-formed (the `runOrchestratorDecided`
 * def's closed key set and `agentId`; the decision by its branches), and the
 * deciding agent never changes. Pure.
 */
export function judgeDecisions(o: LoopObservation, validateDecision: Validate): Outcome {
  const ds = decisions(o);
  if (ds.length === 0) return skip('inapplicable', `the loop recorded no ${o.decidedType}, so there is nothing to judge here — the terminates leg convicts that`);
  const agents = new Set(ds.map((e) => e.payload['agentId']));
  const DEF = 'schemas run-event-payloads runOrchestratorDecided';
  return observed([
    ...ds.flatMap((e) => {
      const extra = Object.keys(e.payload).filter((k) => !PAYLOAD_KEYS.has(k));
      const agentId = e.payload['agentId'];
      const v = validateDecision(e.payload['decision']);
      return [
        finding(extra.length === 0, DEF, `a ${o.decidedType} payload carries only agentId, decision, iteration, causationHostId (seq ${e.sequence}; extra ${JSON.stringify(extra)})`),
        finding(typeof agentId === 'string' && AGENT_ID.test(agentId), `${DEF}.agentId`, `every ${o.decidedType} MUST carry agentId (seq ${e.sequence}; got ${JSON.stringify(agentId)})`),
        finding(v.ok, 'schemas orchestrator-decision', `every decision MUST be one OrchestratorDecision (seq ${e.sequence}): ${v.errors}`),
      ];
    }),
    finding(agents.size === 1, `${DEF}.agentId`, `orchestrator identity is set at the first decision and does not change (got ${JSON.stringify([...agents])})`),
  ]);
}

/** Leg: at version >= 5, `iteration` is 1-based and +1 per turn. Pure. */
export function judgeIteration(o: LoopObservation): Outcome {
  if (o.version < 5) return skip('inapplicable', `the host advertises multiAgent.executionModel.version ${o.version}; iteration binds from level 5`);
  const ds = decisions(o);
  if (ds.length === 0) return skip('inapplicable', `the loop recorded no ${o.decidedType}, so there is nothing to judge here — the terminates leg convicts that`);
  const its = ds.map((e) => e.payload['iteration']);
  return observed([
    finding(its.every((n, i) => n === i + 1), `${DOC_LOOP} (level 5)`, `every ${o.decidedType} MUST carry iteration, 1-based and incremented by exactly 1 per turn (got ${JSON.stringify(its)})`),
  ]);
}
