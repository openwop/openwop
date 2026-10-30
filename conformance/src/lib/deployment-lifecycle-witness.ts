/**
 * RFC 0082 at major 2: the deployment lifecycle. Pure judges for
 * `v2-deployment-lifecycle.test.ts`, over answers from `listAgentDeployments`
 * and `transitionAgentDeployment` and over the event logs of the
 * `conformance-agent-channel-dispatch` fixture's runs.
 *
 * The rules are the `agents.deployment` facet description in
 * `spec/v2/facets/agents.schema.json`, `schemas/v2/agent-deployment.schema.json`
 * (the record and its legal transitions), `agent-deployment-transition.schema.json`
 * and the two operations in `api/v2/openapi.yaml`, with the transition rules
 * RFC 0254 adds to that facet text. Each judge returns findings and asserts
 * nothing; the scenario maps them to `req()` ids.
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md §B, §C, §E, §F
 * @see RFCS/0254-deployment-transitions-at-v2.md
 */

import { readErrorCode } from './error-envelope.js';

export interface DeployFinding { readonly ok: boolean; readonly message: string }
export interface Answer {
  readonly status: number;
  readonly json: unknown;
  /** The `WWW-Authenticate` header, when the answer carried one. */
  readonly wwwAuthenticate?: string | undefined;
}
export type Validate = (doc: unknown) => { ok: boolean; errors: string };
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, message: string): DeployFinding => ({ ok, message });
const shown = (a: Answer | null): string => (a === null ? 'no answer' : `${a.status} ${readErrorCode(a.json) ?? ''}`.trim());

/** The forward promotion path `agent-deployment.schema.json` names. */
export const PROMOTION_PATH = ['draft', 'test', 'staged', 'active'] as const;
export const ALL_STATES = ['draft', 'test', 'staged', 'active', 'paused', 'deprecated', 'rolled-back'] as const;

/**
 * The promotion path over the advertised states: absent `states` means all
 * seven, and over a subset `promote` moves to the next advertised state in
 * draft→test→staged→active order (RFC 0254).
 */
export function promotionPath(states: readonly string[] | null): string[] {
  return PROMOTION_PATH.filter((s) => states === null || states.includes(s));
}

/** `details` of an error body: the canonical root `details`, else the legacy nested `error.details`. */
export function errorDetails(body: unknown): Rec {
  if (!isRec(body)) return {};
  if (isRec(body['details'])) return body['details'];
  return isRec(body['error']) && isRec(body['error']['details']) ? body['error']['details'] : {};
}

/** The record for `version` in a list body, or undefined. */
export function recordOf(list: unknown, version: string): Rec | undefined {
  return Array.isArray(list) ? list.find((r): r is Rec => isRec(r) && r['version'] === version) : undefined;
}

/** The versions listed `active` with `channel` in `channels`. */
export function activeOn(list: unknown, channel: string): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter((r): r is Rec => isRec(r) && r['state'] === 'active' && Array.isArray(r['channels']) && (r['channels'] as unknown[]).includes(channel) && typeof r['version'] === 'string')
    .map((r) => r['version'] as string);
}

/** The first `draft` record's version, or undefined. */
export function pickDraft(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const r = list.find((x): x is Rec => isRec(x) && x['state'] === 'draft' && typeof x['version'] === 'string');
  return r === undefined ? undefined : (r['version'] as string);
}

/** `listAgentDeployments` answers 200 with an array of valid records of the agent. */
export function judgeList(a: Answer | null, agentId: string, validate: Validate): DeployFinding[] {
  if (a === null || a.status !== 200) return [f(false, `GET /agents/{agentId}/deployments MUST answer 200 for an advertised facet (got ${shown(a)})`)];
  if (!Array.isArray(a.json)) return [f(false, 'the 200 body MUST be an array of deployment records')];
  const out: DeployFinding[] = [f(a.json.length > 0, 'the fixture agent MUST have at least one listed deployment record')];
  a.json.forEach((r, i) => {
    const v = validate(r);
    out.push(f(v.ok, `record [${i}] MUST validate against agent-deployment.schema.json (${v.errors})`));
    out.push(f(isRec(r) && r['agentId'] === agentId, `record [${i}] MUST belong to ${agentId} (got ${JSON.stringify(isRec(r) ? r['agentId'] : r)})`));
  });
  return out;
}

const KEPT = ['state', 'channels', 'canaryPercent', 'rollbackPointer'] as const;
function unchanged(before: Rec, after: unknown, why: string): DeployFinding[] {
  const version = String(before['version']);
  const now = recordOf(after, version);
  if (now === undefined) return [f(false, `the record for ${version} MUST still be listed after ${why}`)];
  return KEPT.map((k) => f(JSON.stringify(before[k]) === JSON.stringify(now[k]), `${why} MUST NOT change ${k} (was ${JSON.stringify(before[k])}, now ${JSON.stringify(now[k])})`));
}

/**
 * A transition the record's state allows no edge for, or a `promote` past the
 * next state: `409 deployment_state_conflict` naming the current state and the
 * transition, and the record does not move (RFC 0254).
 */
export function judgeStateConflict(label: string, transition: string, a: Answer | null, before: Rec, after: unknown): DeployFinding[] {
  const d = errorDetails(a?.json);
  return [
    f(a?.status === 409, `${label} is not a legal edge from ${JSON.stringify(before['state'])} and MUST be refused 409 (got ${shown(a)})`),
    f(readErrorCode(a?.json) === 'deployment_state_conflict', `${label} MUST carry deployment_state_conflict (got ${JSON.stringify(readErrorCode(a?.json))})`),
    f(d['state'] === before['state'], `details.state MUST be the record's current state ${JSON.stringify(before['state'])} (got ${JSON.stringify(d['state'])})`),
    f(d['transition'] === transition, `details.transition MUST name the refused transition ${JSON.stringify(transition)} (got ${JSON.stringify(d['transition'])})`),
    ...unchanged(before, after, `the refused ${label}`),
  ];
}

/** The scopes a `WWW-Authenticate` challenge names in `scope="…"`, or undefined when it names none. */
export function challengeScopes(header: string): string[] | undefined {
  const m = /\bscope="([^"]*)"/i.exec(header);
  return m === null ? undefined : (m[1] ?? '').split(/\s+/).filter((x) => x.length > 0);
}

/**
 * A transition by a principal without `deploy:*` is refused `403 forbidden`
 * and moves nothing. `deploy:*` is one literal scope: a `WWW-Authenticate`
 * challenge, when present, names it in `scope=` (RFC 0254).
 */
export function judgeScopeRefused(a: Answer | null, before: Rec, after: unknown): DeployFinding[] {
  const out = [
    f(a?.status === 403, `a transition by a principal without the deploy:* scope MUST be refused 403, fail-closed (got ${shown(a)})`),
    f(readErrorCode(a?.json) === 'forbidden', `the 403 MUST carry forbidden (got ${JSON.stringify(readErrorCode(a?.json))})`),
  ];
  const h = a?.wwwAuthenticate;
  if (typeof h === 'string' && h.length > 0) {
    const scopes = challengeScopes(h);
    out.push(f(scopes !== undefined && scopes.includes('deploy:*'), `a WWW-Authenticate challenge on the 403 MUST name scope="deploy:*" (got ${JSON.stringify(h)})`));
  }
  return [...out, ...unchanged(before, after, 'the unauthorized transition')];
}

/** `400 validation_error`, the record unchanged: a transition the advertised `states` or `canary` cannot satisfy. */
export function judgeValidationRefused(label: string, a: Answer | null, before: Rec, after: unknown): DeployFinding[] {
  return [
    f(a?.status === 400, `${label} MUST be refused 400 (got ${shown(a)})`),
    f(readErrorCode(a?.json) === 'validation_error', `${label} MUST carry validation_error (got ${JSON.stringify(readErrorCode(a?.json))})`),
    ...unchanged(before, after, `the refused ${label}`),
  ];
}

/** One legal step answers 200 with the valid record in the target state. */
export function judgeStep(a: Answer | null, version: string, toState: string, validate: Validate): DeployFinding[] {
  if (a === null || a.status !== 200) return [f(false, `promote ${version} to ${toState} is a legal transition and MUST answer 200 (got ${shown(a)})`)];
  const v = validate(a.json);
  const r = isRec(a.json) ? a.json : {};
  return [
    f(v.ok, `the record returned for ${toState} MUST validate against agent-deployment.schema.json (${v.errors})`),
    f(r['version'] === version, `the returned record MUST be version ${version} (got ${JSON.stringify(r['version'])})`),
    f(r['state'] === toState, `the returned record MUST be in ${toState} (got ${JSON.stringify(r['state'])})`),
  ];
}

/** After the walk the list shows the version `active` on the channel the last promote named. */
export function judgeBound(after: unknown, version: string, channel: string): DeployFinding[] {
  const r = recordOf(after, version);
  return [
    f(r?.['state'] === 'active', `after the walk ${version} MUST be listed active (got ${JSON.stringify(r?.['state'])})`),
    f(Array.isArray(r?.['channels']) && (r['channels'] as unknown[]).includes(channel), `a promote naming channel ${channel} MUST bind it (channels ${JSON.stringify(r?.['channels'])})`),
  ];
}

/** The payload of the first `agent.invocation-started`, or undefined. */
export function firstInvocation(events: ReadonlyArray<{ type: string; payload: Rec }>, type: string): Rec | undefined {
  return events.find((e) => e.type === type)?.payload;
}

/** A channel-bound run records the channel and a version active on it when the run started. */
export function judgePinned(payload: Rec | undefined, channel: string, activeVersions: readonly string[]): DeployFinding[] {
  if (payload === undefined) return [f(false, 'a channel-bound agent run MUST emit agent.invocation-started')];
  const v = payload['resolvedAgentVersion'];
  return [
    f(payload['resolvedChannel'] === channel, `agent.invocation-started MUST carry resolvedChannel ${JSON.stringify(channel)} (got ${JSON.stringify(payload['resolvedChannel'])})`),
    f(typeof v === 'string' && activeVersions.includes(v), `resolvedAgentVersion MUST be a version active on ${channel} at run start, ${JSON.stringify(activeVersions)} (got ${JSON.stringify(v)})`),
  ];
}

/** A replay of the source run re-reads its recorded version, not the moved channel. */
export function judgeReplayPinned(source: string, moved: string, payload: Rec | undefined): DeployFinding[] {
  if (payload === undefined) return [f(false, 'the replay MUST emit agent.invocation-started')];
  const v = payload['resolvedAgentVersion'];
  return [f(v === source, `a replay MUST re-read the recorded resolvedAgentVersion ${source}, not re-resolve the channel now serving ${moved} (got ${JSON.stringify(v)})`)];
}

/** `adjust-canary` answers 200 with the record at the requested share, and the list agrees. */
export function judgeCanaryAdjusted(a: Answer | null, version: string, percent: number, after: unknown, validate: Validate): DeployFinding[] {
  if (a === null || a.status !== 200) return [f(false, `adjust-canary of active ${version} to ${percent} on a canary host MUST answer 200 (got ${shown(a)})`)];
  const v = validate(a.json);
  const r = isRec(a.json) ? a.json : {};
  return [
    f(v.ok, `the adjusted record MUST validate against agent-deployment.schema.json (${v.errors})`),
    f(r['canaryPercent'] === percent, `the returned record MUST carry canaryPercent ${percent} (got ${JSON.stringify(r['canaryPercent'])})`),
    f(recordOf(after, version)?.['canaryPercent'] === percent, `the list MUST then show canaryPercent ${percent} (got ${JSON.stringify(recordOf(after, version)?.['canaryPercent'])})`),
  ];
}

/**
 * A rollback leaves the version `rolled-back`, and restores the version that
 * was `active` on the channel immediately before it: the incumbent, which
 * `rollbackPointer` names and which is listed `active` afterwards (RFC 0254).
 */
export function judgeRolledBack(a: Answer | null, version: string, incumbent: readonly string[], after: unknown, validate: Validate): DeployFinding[] {
  if (a === null || a.status !== 200) return [f(false, `rollback of active ${version} on a rollback host MUST answer 200 (got ${shown(a)})`)];
  const v = validate(a.json);
  const r = isRec(a.json) ? a.json : {};
  const ptr = r['rollbackPointer'];
  const restored = typeof ptr === 'string' ? recordOf(after, ptr) : undefined;
  return [
    f(v.ok, `the rolled-back record MUST validate against agent-deployment.schema.json (${v.errors})`),
    f(r['state'] === 'rolled-back', `the returned record MUST be rolled-back (got ${JSON.stringify(r['state'])})`),
    f(typeof ptr === 'string' && incumbent.includes(ptr), `rollbackPointer MUST name the version active on the channel immediately before ${version}, ${JSON.stringify(incumbent)} (got ${JSON.stringify(ptr)})`),
    f(restored?.['state'] === 'active', `the version rollbackPointer names MUST be listed active (got ${JSON.stringify(restored?.['state'])})`),
    f(recordOf(after, version)?.['state'] === 'rolled-back', `the list MUST then show ${version} rolled-back (got ${JSON.stringify(recordOf(after, version)?.['state'])})`),
  ];
}

/** A `pause` then a `promote` of a paused version: each 200, ending `paused` then `active` (RFC 0254). */
export function judgeResumed(pause: Answer | null, resume: Answer | null, version: string, after: unknown, validate: Validate): DeployFinding[] {
  if (pause === null || pause.status !== 200) return [f(false, `pause of active ${version} is a legal edge and MUST answer 200 (got ${shown(pause)})`)];
  const p = isRec(pause.json) ? pause.json : {};
  const vp = validate(pause.json);
  const out = [
    f(vp.ok, `the paused record MUST validate against agent-deployment.schema.json (${vp.errors})`),
    f(p['state'] === 'paused', `the pause MUST return the record paused (got ${JSON.stringify(p['state'])})`),
  ];
  if (resume === null || resume.status !== 200) return [...out, f(false, `promote of paused ${version} is the paused→active edge and MUST answer 200 (got ${shown(resume)})`)];
  const r = isRec(resume.json) ? resume.json : {};
  const vr = validate(resume.json);
  return [
    ...out,
    f(vr.ok, `the resumed record MUST validate against agent-deployment.schema.json (${vr.errors})`),
    f(r['state'] === 'active', `promote of a paused version MUST return it active (got ${JSON.stringify(r['state'])})`),
    f(recordOf(after, version)?.['state'] === 'active', `the list MUST then show ${version} active (got ${JSON.stringify(recordOf(after, version)?.['state'])})`),
  ];
}

/** One transition the host accepted with 200: what was asked, and the record it returned. */
export interface Accepted {
  readonly label: string;
  readonly transition: string;
  readonly version: string;
  /** The record's state before the transition. */
  readonly fromState: string;
  readonly answer: Answer;
}

/** Every 200 transition answer names its deployment-management run in `transitionRunId` (RFC 0254). */
export function judgeRunLinked(accepted: readonly Accepted[]): DeployFinding[] {
  return accepted.map((x) => {
    const id = isRec(x.answer.json) ? x.answer.json['transitionRunId'] : undefined;
    return f(typeof id === 'string' && id.length > 0, `the record ${x.label} returned MUST carry transitionRunId naming its deployment-management run (got ${JSON.stringify(id)})`);
  });
}

/** The `transitionRunId` of an accepted answer, or undefined. */
export function runIdOf(x: Accepted): string | undefined {
  const id = isRec(x.answer.json) ? x.answer.json['transitionRunId'] : undefined;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** A `deployment.*` event the transition must have recorded: its v1 name (the codemap key), its payload $def, and how it names this transition. */
export interface Expected { readonly v1: string; readonly def: string; readonly matches: (p: Rec) => boolean }

/**
 * The `deployment.*` events a transition may record, any one of which
 * witnesses it. A resume (`promote` of a paused version) is the one transition
 * the corpus names two events for: `deployment.state.changed` describes pause
 * and resume, and the transition is a `promote`.
 */
export function expectedEvents(x: Accepted): Expected[] {
  const r = isRec(x.answer.json) ? x.answer.json : {};
  const state = r['state'];
  const promoted: Expected = { v1: 'deployment.promoted', def: 'deploymentPromoted', matches: (p) => p['toVersion'] === x.version && p['toState'] === state };
  const changed: Expected = { v1: 'deployment.state.changed', def: 'deploymentStateChanged', matches: (p) => p['version'] === x.version && p['fromState'] === x.fromState && p['toState'] === state };
  switch (x.transition) {
    case 'promote': return x.fromState === 'paused' ? [promoted, changed] : [promoted];
    case 'pause':
    case 'deprecate': return [changed];
    case 'adjust-canary': return [{ v1: 'deployment.canary.adjusted', def: 'deploymentCanaryAdjusted', matches: (p) => p['version'] === x.version && p['toPercent'] === r['canaryPercent'] }];
    case 'rollback': return [{ v1: 'deployment.rolled-back', def: 'deploymentRolledBack', matches: (p) => p['fromVersion'] === x.version && p['toVersion'] === r['rollbackPointer'] }];
    default: return [];
  }
}

/**
 * The management run's events include the `deployment.*` event matching the
 * transition, and its payload validates against its `run-event-payloads` $def.
 * `typeOf` maps a v1 name to the major's wire name; `validators` are keyed by $def.
 */
export function judgeEventRecorded(
  x: Accepted,
  events: ReadonlyArray<{ type: string; payload: Rec }> | undefined,
  typeOf: (v1: string) => string,
  validators: Readonly<Record<string, Validate>>,
): DeployFinding[] {
  const runId = runIdOf(x);
  if (runId === undefined) return [f(false, `${x.label}: no transitionRunId, so its deployment.* event cannot be read`)];
  if (events === undefined) return [f(false, `${x.label}: the events of management run ${runId} MUST be readable by a caller with runs:read in the same tenant`)];
  const want = expectedEvents(x);
  const names = want.map((w) => typeOf(w.v1));
  const hit = want.flatMap((w) => events.filter((e) => e.type === typeOf(w.v1) && w.matches(e.payload)).map((e) => ({ w, e })))[0];
  if (hit === undefined) {
    const seen = events.filter((e) => e.type.startsWith('deployment.')).map((e) => `${e.type} ${JSON.stringify(e.payload)}`);
    return [f(false, `${x.label}: management run ${runId} MUST record ${names.join(' or ')} for this transition (deployment.* seen: ${seen.length === 0 ? 'none' : seen.join('; ')})`)];
  }
  const validate = validators[hit.w.def];
  const v = validate === undefined ? { ok: false, errors: `no validator for ${hit.w.def}` } : validate(hit.e.payload);
  return [f(v.ok, `${x.label}: the ${hit.e.type} payload MUST validate against run-event-payloads#/$defs/${hit.w.def}, content-free (${v.errors})`)];
}
