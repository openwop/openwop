/**
 * The budget exhaustion-facet witness (RFC 0231), shared by every major that
 * gives a budget a run wire surface (`major-profile.ts` `runBudget`).
 *
 * A host that lists `budget.onExhaustion` serves exactly those values. The
 * suite reads the list, and where it leaves out `interrupt` posts one create
 * that asks for it. The answer must be `422 capability_not_provided`.
 *
 * Unaided: one discovery read and one create. Nothing is spent, because a
 * conforming host creates no run.
 *
 * Two halves, as in `budget-witness.ts`: {@link drive} observes and asserts
 * nothing; {@link judge} is pure.
 *
 * Not witnessed here: a host that lists `interrupt` and serves it. The resume
 * that extends a budget has no specified shape (RFC 0231 gap G2), so no suite
 * can drive it.
 */

import { driver, type OpenWOPResponse } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import { getAdvertisedFixtures, isFixtureAdvertised } from './fixtures.js';
import { BUDGET_FIXTURE } from './budget-witness.js';
import type { MajorProfile } from './major-profile.js';

/** A valid policy whose only unserved part is the exhaustion behaviour. */
export const UNSERVED_POLICY = { maxToolCalls: 2, onExhaustion: 'interrupt' } as const;
const SERVED = new Set(['fail', 'interrupt']);

export interface FacetObservation {
  /** The advertised list, as the host sent it. */
  readonly facet: unknown;
  /** The answer to a create asking for `interrupt`, or `undefined` when the list serves it and none was sent. */
  readonly create: { readonly status: number; readonly code: string | undefined } | undefined;
}
export type FacetRun =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly observation: FacetObservation };

export interface FacetFinding {
  readonly rule: 'contains-fail' | 'refused';
  readonly ok: boolean;
  readonly doc: string;
  readonly message: string;
}

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** A workflow the host says it has, so the create is valid apart from the exhaustion behaviour. */
function advertisedWorkflow(): string | undefined {
  if (isFixtureAdvertised(BUDGET_FIXTURE)) return BUDGET_FIXTURE;
  return [...(getAdvertisedFixtures() ?? [])].sort()[0];
}

/** Read the facet and, where it leaves out `interrupt`, ask for it once. Asserts nothing. */
export async function drive(profile: MajorProfile, doc: unknown): Promise<FacetRun> {
  const family = profile.family(doc, 'budget');
  if (family === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise budget' };
  const facet = family['onExhaustion'];
  if (facet === undefined) return { kind: 'skip', disposition: 'inapplicable', reason: 'budget.onExhaustion is not advertised — the host is taken to serve both values' };
  if (family['enforce'] !== 'hard') return { kind: 'skip', disposition: 'inapplicable', reason: 'budget.enforce is not hard — no exhaustion behaviour applies, and a consumer ignores the list' };

  if (!Array.isArray(facet) || facet.includes('interrupt')) return { kind: 'observed', observation: { facet, create: undefined } };

  const fragment = profile.runBudget(UNSERVED_POLICY);
  if (fragment === null) return { kind: 'skip', disposition: 'inapplicable', reason: `major ${profile.major} gives a run budget no createRun surface` };
  const workflowId = advertisedWorkflow();
  if (workflowId === undefined) return { kind: 'skip', disposition: 'inapplicable', reason: 'no fixture is advertised — the suite has no workflow to name in an otherwise valid create' };

  const res = await http(() => driver.post(profile.runsPath, { workflowId, ...fragment }));
  if (res === null) return { kind: 'skip', disposition: 'blocked', reason: `POST ${profile.runsPath} unreachable (fetch failed)` };
  if (res.status === 429) return { kind: 'skip', disposition: 'blocked', reason: `POST ${profile.runsPath} answered 429 — the run budget of the host, not the wire` };

  // A host that accepted the create started a run. Stop it, so a failing row leaves none behind.
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (typeof runId === 'string') await http(() => driver.post(`${profile.runsPath}/${encodeURIComponent(runId)}/cancel`, {}));

  return { kind: 'observed', observation: { facet, create: { status: res.status, code: readErrorCode(res.json) ?? undefined } } };
}

/** What the list and the answer must show. Pure. */
export function judge(profile: MajorProfile, o: FacetObservation): FacetFinding[] {
  const home = profile.major === 1 ? 'spec/v1/budget-policy.md §D' : `${profile.specRoot}/runs.md §Refusals`;
  const out: FacetFinding[] = [];
  const list = Array.isArray(o.facet) ? o.facet : null;
  const wellFormed = list !== null && list.length > 0 && list.every((v) => typeof v === 'string' && SERVED.has(v));
  out.push({
    rule: 'contains-fail',
    ok: wellFormed && list.includes('fail'),
    doc: 'schemas/capabilities.schema.json §budget.onExhaustion',
    message: `an advertised budget.onExhaustion MUST be a non-empty list of fail and interrupt that contains fail (got ${JSON.stringify(o.facet)})`,
  });
  if (o.create !== undefined) {
    out.push({
      rule: 'refused',
      ok: o.create.status === 422 && o.create.code === 'capability_not_provided',
      doc: home,
      message: `a host whose budget.onExhaustion does not list interrupt MUST reject a create asking for it with 422 capability_not_provided and create no run (got ${o.create.status} ${o.create.code ?? ''})`.trim(),
    });
  }
  return out;
}
