/**
 * The `core.subWorkflow` witness (`execution.md` §`subWorkflow`), a fixture
 * port through `POST /runs` and `events/poll`. No seam.
 *
 * Linkage, on `conformance-subworkflow-parent` → `conformance-subworkflow-child`:
 *   output         the parent's `node.completed` for `subwf-call` carries
 *                  `outputs.childRunId` and `outputs.childStatus`
 *                  (`completed | failed | cancelled`), and the status names the
 *                  child's real terminal status;
 *   outputMapping  after the child completes, the mapped variable is copied
 *                  into the parent (`childOutcome` ← child `childResult`);
 *   ancestry       where `getRunAncestry` is served (advertised by
 *                  `multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`),
 *                  the child's `parent` is the parent run with
 *                  `cause: "core.subWorkflow"`.
 * The v1 `parentRunId`/`parentNodeId` child-linkage leg is RETIRED at v2
 * (`spec/v1/migrations.json` C4.18): `parentRunId` is fork lineage, not this link.
 *
 * Input mapping, on `conformance-subworkflow-input-mapping[-no-default]` →
 * `conformance-subworkflow-input-mapping-child` (child default `receivedPrdId: "baked-in"`):
 *   seed      the child's variable bag is seeded: `receivedPrdId` is present;
 *   override  the mapping lands after and over the default: `"prd-1"`;
 *   unset     an unset parent variable arrives undefined, never an error or
 *             `null` (the run completes; the child's value is absent or its
 *             own default).
 *
 * The drivers observe and assert nothing; the judges are pure, proven in
 * `subworkflow-witness.test.ts`.
 */

import { driver } from './driver.js';
import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';
import {
  completionsOf, finding, isRecord, observed, observeRun, readRun, runCompleted, skip,
  type Finding, type ObservedRun, type ObserveOpts, type Outcome, type RunRead, type Skip, type Validate,
} from './fixture-run-observer.js';

export const PARENT_FIXTURE = 'conformance-subworkflow-parent';
export const CHILD_FIXTURE = 'conformance-subworkflow-child';
export const IM_PARENT_FIXTURE = 'conformance-subworkflow-input-mapping';
export const IM_NO_DEFAULT_FIXTURE = 'conformance-subworkflow-input-mapping-no-default';
export const IM_CHILD_FIXTURE = 'conformance-subworkflow-input-mapping-child';
export const SUBWF_NODE = 'subwf-call';

const DOC = 'execution.md §subWorkflow';
const CHILD_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** The child a `core.subWorkflow` node started, as its `node.completed` names it. */
export interface ChildLink {
  readonly outputs: Record<string, unknown> | undefined;
  readonly childRunId: string | undefined;
  readonly child: RunRead | undefined;
}

export interface LinkageObservation extends ChildLink {
  readonly parent: ObservedRun;
  /** `undefined`: the host does not advertise `getRunAncestry`, so the leg does not bind. */
  readonly ancestry: { readonly status: number; readonly json: unknown } | undefined;
}
export interface MappingObservation extends ChildLink { readonly parent: ObservedRun }

/** Whether the host advertises `getRunAncestry` (`runs.md` §Surface gate). */
export function ancestryAdvertised(profile: MajorProfile, doc: unknown): boolean {
  const ma = profile.family(doc, 'multiAgent');
  const em = isRecord(ma?.['executionModel']) ? ma['executionModel'] : undefined;
  const chc = isRecord(em?.['crossHostCausation']) ? em['crossHostCausation'] : undefined;
  return chc?.['ancestryEndpointSupported'] === true;
}

function fixturesGate(...ids: string[]): Skip | null {
  for (const id of ids) if (!isFixtureAdvertised(id)) return skip('inapplicable', `fixture ${id} is not advertised — the fixture is the opt-in`);
  return null;
}

async function followChild(profile: MajorProfile, parent: ObservedRun): Promise<ChildLink> {
  const done = completionsOf(parent.events, SUBWF_NODE)[0];
  const outputs = isRecord(done?.payload['outputs']) ? done.payload['outputs'] : undefined;
  const childRunId = typeof outputs?.['childRunId'] === 'string' && outputs['childRunId'].length > 0 ? outputs['childRunId'] : undefined;
  return { outputs, childRunId, child: childRunId === undefined ? undefined : await readRun(profile, childRunId) };
}

/** Run the linkage fixture and follow it to the child. Asserts nothing. */
export async function driveLinkage(profile: MajorProfile, doc: unknown, opts: ObserveOpts = {}): Promise<Skip | LinkageObservation> {
  const g = fixturesGate(PARENT_FIXTURE, CHILD_FIXTURE);
  if (g) return g;
  const parent = await observeRun(profile, PARENT_FIXTURE, opts);
  const link = await followChild(profile, parent);
  let ancestry: LinkageObservation['ancestry'];
  if (ancestryAdvertised(profile, doc) && link.childRunId !== undefined) {
    const r = await driver.get(`${profile.runsPath}/${profile.idSegment(link.childRunId)}/ancestry`);
    ancestry = { status: r.status, json: r.json };
  }
  return { parent, ...link, ancestry };
}

/** Run an input-mapping fixture and follow it to the child. Asserts nothing. */
export async function driveInputMapping(profile: MajorProfile, fixture: string, opts: ObserveOpts = {}): Promise<Skip | MappingObservation> {
  const g = fixturesGate(fixture, IM_CHILD_FIXTURE);
  if (g) return g;
  const parent = await observeRun(profile, fixture, opts);
  return { parent, ...(await followChild(profile, parent)) };
}

/** Leg: `node.completed` carries `outputs.childRunId` and `outputs.childStatus`. Pure. */
export function judgeOutput(o: LinkageObservation): Outcome {
  const out: Finding[] = runCompleted(o.parent);
  const status = o.outputs?.['childStatus'];
  const childStatus = o.child?.snapshot['status'];
  out.push(
    finding(completionsOf(o.parent.events, SUBWF_NODE).length > 0, `${DOC} (Output)`, `the parent log MUST carry node.completed for the core.subWorkflow node ${SUBWF_NODE}`),
    finding(o.childRunId !== undefined, `${DOC} (Output)`, `node.completed MUST carry outputs.childRunId (got ${JSON.stringify(o.outputs?.['childRunId'])})`),
    finding(typeof status === 'string' && CHILD_STATUSES.has(status), `${DOC} (Output)`, `node.completed MUST carry outputs.childStatus, one of completed | failed | cancelled (got ${JSON.stringify(status)})`),
  );
  if (o.child !== undefined) {
    out.push(
      finding(o.child.status === 200, `${DOC} (Output)`, `outputs.childRunId MUST name a readable run (GET answered ${o.child.status})`),
      finding(o.child.status !== 200 || status === childStatus, `${DOC} (Output)`, `outputs.childStatus MUST be the child's terminal status (got ${JSON.stringify(status)}, child is ${JSON.stringify(childStatus)})`),
    );
  }
  return observed(out);
}

/** Leg: the mapped child variable is copied into the parent. Pure. */
export function judgeOutputMapping(o: LinkageObservation): Outcome {
  const vars = isRecord(o.parent.snapshot['variables']) ? o.parent.snapshot['variables'] : {};
  return observed([
    ...runCompleted(o.parent),
    finding(vars['childOutcome'] === 'child-completed', `${DOC} (outputMapping)`, `after the child completes, the host MUST copy childResult into the parent's childOutcome ("child-completed"; got ${JSON.stringify(vars['childOutcome'])})`),
  ]);
}

/** Leg: the child's ancestry names the parent with `cause: "core.subWorkflow"`. Pure. */
export function judgeAncestry(o: LinkageObservation, validate: Validate): Outcome {
  if (o.childRunId === undefined) return skip('blocked', 'the child run id is unobserved (node.completed carried no outputs.childRunId — the output leg convicts that), so its ancestry cannot be read');
  if (o.ancestry === undefined) return skip('inapplicable', 'the host does not advertise multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported, so getRunAncestry is not served');
  const body = o.ancestry.json;
  const parent = isRecord(body) && isRecord(body['parent']) ? body['parent'] : undefined;
  const v = validate(body);
  return observed([
    finding(o.ancestry.status === 200, `${DOC} (Parent link); runs.md §Diff and ancestry`, `getRunAncestry of the child MUST answer 200 (got ${o.ancestry.status})`),
    finding(v.ok, 'schemas run-ancestry-response', `the ancestry body MUST validate: ${v.errors}`),
    finding(parent !== undefined && parent['runId'] === o.parent.runId, `${DOC} (Parent link)`, `the child's parent MUST be the parent run ${String(o.parent.runId)} (got ${JSON.stringify(parent?.['runId'] ?? (isRecord(body) ? body['parent'] : undefined))})`),
    finding(parent?.['cause'] === 'core.subWorkflow', `${DOC} (Parent link)`, `the child's parent.cause MUST be core.subWorkflow (got ${JSON.stringify(parent?.['cause'])})`),
  ]);
}

const childVars = (o: MappingObservation): Record<string, unknown> | undefined =>
  o.child !== undefined && o.child.status === 200 ? (isRecord(o.child.snapshot['variables']) ? o.child.snapshot['variables'] : {}) : undefined;

function childReached(o: MappingObservation): Finding[] {
  return [
    ...runCompleted(o.parent),
    finding(o.childRunId !== undefined, `${DOC} (Output)`, `the parent's node.completed for ${SUBWF_NODE} MUST carry outputs.childRunId`),
    finding(o.child?.status === 200, `${DOC} (Output)`, `outputs.childRunId MUST name a readable run (GET answered ${String(o.child?.status)})`),
    finding(o.child?.snapshot['status'] === 'completed', `fixtures.md ${IM_CHILD_FIXTURE}`, `the child run MUST end completed (got ${JSON.stringify(o.child?.snapshot['status'])})`),
  ];
}

/** Leg: the child's variable bag is seeded at creation — `receivedPrdId` is present. Pure. */
export function judgeSeed(o: MappingObservation): Outcome {
  const v = childVars(o)?.['receivedPrdId'];
  return observed([
    ...childReached(o),
    finding(v !== undefined && v !== null, `${DOC} (inputMapping: defaultValue MUST seed first)`, `the child's receivedPrdId MUST be seeded at creation (got ${JSON.stringify(v)})`),
  ]);
}

/** Leg: the mapping lands after and over the child's default. Pure. */
export function judgeOverride(o: MappingObservation): Outcome {
  const vars = childVars(o);
  if (vars === undefined) return skip('blocked', 'the child run is unread (no outputs.childRunId, or GET failed — the seed leg convicts that)');
  const v = vars['receivedPrdId'];
  return observed([
    finding(v !== 'baked-in', `${DOC} (inputMapping: after and over defaultValue)`, 'the child\'s defaultValue "baked-in" MUST NOT win over the mapped parent value'),
    finding(v === 'prd-1', `${DOC} (inputMapping)`, `the child's receivedPrdId MUST be the parent's currentPrdId projection "prd-1" (got ${JSON.stringify(v)})`),
  ]);
}

/** Leg: an unset parent variable arrives undefined — no error, no `null`. Pure. */
export function judgeUnset(o: MappingObservation): Outcome {
  const vars = childVars(o);
  const out = childReached(o);
  if (vars !== undefined) {
    const v = vars['receivedPrdId'];
    out.push(
      finding(v !== null, `${DOC} (inputMapping: never null)`, 'an unset parent variable MUST NOT arrive as null'),
      finding(!('receivedPrdId' in vars) || v === 'baked-in', `${DOC} (inputMapping: arrives undefined)`, `an unset parent variable MUST arrive undefined: the child's value is absent or its own default (got ${JSON.stringify(v)})`),
    );
  }
  return observed(out);
}
