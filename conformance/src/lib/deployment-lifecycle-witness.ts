/**
 * RFC 0082 at major 2: the deployment lifecycle. Pure judges for
 * `v2-deployment-lifecycle.test.ts`, over answers from `listAgentDeployments`
 * and `transitionAgentDeployment` and over the event logs of the
 * `conformance-agent-channel-dispatch` fixture's runs.
 *
 * The rules are the `agents.deployment` facet description in
 * `spec/v2/facets/agents.schema.json`, `schemas/v2/agent-deployment.schema.json`
 * (the record and its legal transitions), `agent-deployment-transition.schema.json`
 * and the two operations in `api/v2/openapi.yaml`. Each judge returns findings
 * and asserts nothing; the scenario maps them to `req()` ids.
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md §B, §C, §E, §F
 */

import { readErrorCode } from './error-envelope.js';

export interface DeployFinding { readonly ok: boolean; readonly message: string }
export interface Answer { readonly status: number; readonly json: unknown }
export type Validate = (doc: unknown) => { ok: boolean; errors: string };
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, message: string): DeployFinding => ({ ok, message });
const shown = (a: Answer | null): string => (a === null ? 'no answer' : `${a.status} ${readErrorCode(a.json) ?? ''}`.trim());

/** The forward promotion path `agent-deployment.schema.json` names. */
export const PROMOTION_PATH = ['draft', 'test', 'staged', 'active'] as const;
export const ALL_STATES = ['draft', 'test', 'staged', 'active', 'paused', 'deprecated', 'rolled-back'] as const;

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

/** A transition the record's state machine does not allow is refused and moves nothing. */
export function judgeIllegalRefused(label: string, a: Answer | null, before: Rec, after: unknown): DeployFinding[] {
  const refused = a !== null && a.status >= 400 && a.status < 500;
  return [
    f(refused, `${label} is not a legal transition from ${JSON.stringify(before['state'])} and MUST be refused with a 4xx (got ${shown(a)})`),
    ...unchanged(before, after, `the refused ${label}`),
  ];
}

/** A transition by a principal without `deploy:*` is refused 403 and moves nothing. */
export function judgeScopeRefused(a: Answer | null, before: Rec, after: unknown): DeployFinding[] {
  return [
    f(a?.status === 403, `a transition by a principal without the deploy:* scope MUST be refused 403, fail-closed (got ${shown(a)})`),
    ...unchanged(before, after, 'the unauthorized transition'),
  ];
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

/** A rollback leaves the version `rolled-back`, pointing at a different version now `active`. */
export function judgeRolledBack(a: Answer | null, version: string, after: unknown, validate: Validate): DeployFinding[] {
  if (a === null || a.status !== 200) return [f(false, `rollback of active ${version} on a rollback host MUST answer 200 (got ${shown(a)})`)];
  const v = validate(a.json);
  const r = isRec(a.json) ? a.json : {};
  const ptr = r['rollbackPointer'];
  const restored = typeof ptr === 'string' ? recordOf(after, ptr) : undefined;
  return [
    f(v.ok, `the rolled-back record MUST validate against agent-deployment.schema.json (${v.errors})`),
    f(r['state'] === 'rolled-back', `the returned record MUST be rolled-back (got ${JSON.stringify(r['state'])})`),
    f(typeof ptr === 'string' && ptr !== version, `rollbackPointer MUST name the version restored in its place (got ${JSON.stringify(ptr)})`),
    f(restored?.['state'] === 'active', `the version rollbackPointer names MUST be listed active (got ${JSON.stringify(restored?.['state'])})`),
    f(recordOf(after, version)?.['state'] === 'rolled-back', `the list MUST then show ${version} rolled-back (got ${JSON.stringify(recordOf(after, version)?.['state'])})`),
  ];
}
