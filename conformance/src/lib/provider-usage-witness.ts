/**
 * The `provider.usage` emission witness (`events.md` §`providerUsage`): "A
 * host advertising `providerUsage` MUST emit exactly one `provider.usage` per
 * LLM provider invocation, before that node's `node.completed`."
 *
 * Driven on `conformance-context-budget-live` — a supervisor on the host's LIVE
 * model (the fixture's catalog entry forbids a mock), so a completed run made
 * at least one provider invocation. From outside, the number of invocations
 * is unknowable, so "exactly one per invocation" is NOT asserted; what is:
 *   emitted   at least one `provider.usage` is on the log;
 *   ordering  each one precedes a `node.completed` of the node it names (or,
 *             when it names none, some `node.completed`);
 *   payload   each payload validates against the v2 `providerUsage` def (whose
 *             closed shape also keeps credential refs and prompt text out).
 *
 * {@link driveUsage} observes and asserts nothing; {@link judgeUsage} is pure,
 * proven in `provider-usage-witness.test.ts`.
 */

import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';
import { finding, observed, observeRun, skip, type ObservedRun, type ObserveOpts, type Outcome, type Skip, type Validate } from './fixture-run-observer.js';

export const LIVE_FIXTURE = 'conformance-context-budget-live';
const DOC = 'events.md §providerUsage';

export interface UsageObservation { readonly run: ObservedRun; readonly usageType: string }

/** The `providerUsage` record, the live fixture, and this major's event name. */
export function usageGate(profile: MajorProfile, doc: unknown): Skip | { usageType: string } {
  if (profile.family(doc, 'providerUsage') === null) return skip('inapplicable', 'the host does not advertise providerUsage');
  if (!isFixtureAdvertised(LIVE_FIXTURE)) return skip('inapplicable', `fixture ${LIVE_FIXTURE} is not advertised — the fixture is the opt-in (a host whose supervisor has no live model must not advertise it)`);
  const usageType = profile.eventType('provider.usage');
  if (usageType === undefined) return skip('blocked', 'the event codemap is not on disk in this layout — the suite will not guess an event name');
  return { usageType };
}

/** Run the live fixture. Asserts nothing. */
export async function driveUsage(profile: MajorProfile, doc: unknown, opts: ObserveOpts = {}): Promise<Skip | UsageObservation> {
  const g = usageGate(profile, doc);
  if ('kind' in g) return g;
  return { run: await observeRun(profile, LIVE_FIXTURE, { timeoutMs: 300_000, pollMs: 1000, ...opts }), ...g };
}

/** Emission, ordering and payload shape. Pure. */
export function judgeUsage(o: UsageObservation, validate: Validate): Outcome {
  const usage = o.run.events.filter((e) => e.type === o.usageType);
  const completions = o.run.events.filter((e) => e.type === 'node.completed');
  if (o.run.createStatus !== 201 && o.run.createStatus !== 202) {
    return observed([finding(false, 'runs.md createRun', `createRun of ${LIVE_FIXTURE} MUST be accepted (got ${o.run.createStatus})`)]);
  }
  if (usage.length === 0 && o.run.terminalStatus !== 'completed') {
    return skip('blocked', `the live run ended ${String(o.run.terminalStatus)} with no ${o.usageType} — no provider invocation is shown to have happened`);
  }
  return observed([
    finding(usage.length > 0, DOC, `a completed run of a live-model supervisor MUST carry at least one ${o.usageType} (got none)`),
    ...usage.map((u) => {
      const after = completions.some((c) => c.sequence > u.sequence && (u.nodeId === undefined || c.nodeId === u.nodeId));
      return finding(after, DOC, `${o.usageType} (seq ${u.sequence}${u.nodeId === undefined ? '' : `, node ${u.nodeId}`}) MUST precede that node's node.completed`);
    }),
    ...usage.map((u) => { const v = validate(u.payload); return finding(v.ok, 'schemas run-event-payloads providerUsage', `every ${o.usageType} payload MUST validate (seq ${u.sequence}): ${v.errors}`); }),
  ]);
}
