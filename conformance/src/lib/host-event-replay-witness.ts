/**
 * RFC 0250 — pure judges for `v2-host-event-strict-replay.test.ts`. The
 * scenario emits durable and ephemeral host events through the RFC 0241
 * trigger, reconnects with `replay=required`, and records what came back;
 * these functions decide each leg, so the self-tests can fail every wrong
 * host answer without a host.
 *
 * The rules are the `hostEvents.replay` description in
 * `spec/v2/facets/hostEvents.schema.json` (normative text of the `hostEvents`
 * family) and `events.md` §Host events.
 *
 * @see RFCS/0250-opt-in-host-event-replay-and-resync.md
 */

import { readErrorCode } from './error-envelope.js';

export interface ReplayFinding { readonly ok: boolean; readonly message: string }

/** One SSE frame as the stream delivered it. */
export interface ReplayFrame { readonly id: string | null; readonly event: string; readonly data: string }

/** One HTTP answer to a `replay=required` request. `null`: no answer arrived (a stream that opened and never ended). */
export type RefusalAnswer = { readonly status: number; readonly contentType: string | null; readonly text: string; readonly json: unknown } | null;

const f = (ok: boolean, message: string): ReplayFinding => ({ ok, message });
export const RESYNC = 'host_event_resync_required';

/**
 * Resume: after cursor `d1`, exactly `after` (in emit order) arrives, never `d1` itself.
 * Frames the suite did not cause (heartbeats, other tests' events) are ignored; only the
 * ids the scenario knows are judged.
 */
export function judgeResume(frames: readonly ReplayFrame[], d1: string, after: readonly string[], ephemeral: string): ReplayFinding[] {
  const known = new Set([d1, ephemeral, ...after]);
  const seen = frames.map((x) => x.id).filter((id): id is string => id !== null && known.has(id));
  const durable = seen.filter((id) => id !== ephemeral && id !== d1);
  return [
    f(!seen.includes(d1), `the cursor event MUST NOT be replayed (eventId ${d1} came back)`),
    f(after.every((id) => durable.includes(id)), `every durable event after the cursor MUST be replayed or delivered live (missing: ${after.filter((id) => !durable.includes(id)).join(', ') || 'none'})`),
    f(durable.length === after.length, `each durable event MUST arrive exactly once (got ${durable.length} for ${after.length})`),
    f(JSON.stringify(durable) === JSON.stringify(after), `durable events MUST arrive in commit order, then live (got [${durable.join(', ')}], want [${after.join(', ')}])`),
  ];
}

/**
 * No ephemeral event is replayed. An ephemeral frame has no `id:` line (events.md §Host events),
 * so it is found by the `eventId` inside its `data:` envelope, never by `id:`.
 */
export function judgeNoEphemeralReplay(frames: readonly ReplayFrame[], ephemeral: string): ReplayFinding[] {
  return [f(!frames.some((x) => x.id === ephemeral || x.data.includes(ephemeral)), `an ephemeral event MUST NOT be replayed (eventId ${ephemeral} came back)`)];
}

/** An unresumable cursor is refused 409 host_event_resync_required, before any SSE byte. */
export function judgeRefused(a: RefusalAnswer, what: string): ReplayFinding[] {
  if (a === null) return [f(false, `${what}: the host opened a stream instead of refusing — a cursor it cannot resume MUST be refused 409 before any SSE byte`)];
  return [
    f(a.status === 409, `${what}: MUST be refused 409 (got ${a.status})`),
    f(readErrorCode(a.json) === RESYNC, `${what}: the refusal MUST carry ${RESYNC} (got ${String(readErrorCode(a.json))})`),
    f(!(a.contentType ?? '').includes('text/event-stream'), `${what}: the refusal MUST come before any SSE byte (content-type ${a.contentType ?? 'none'})`),
  ];
}

/**
 * An unauthenticated `replay=required` naming a real cursor is never resumed: the host answers
 * its authentication failure (401) or the uniform refusal (409), never a stream of that tenant's
 * events. Found by openwop-app (ADR 0973): an unauthenticated caller resolved to a default tenant.
 */
export function judgeUnauthenticatedNotResumed(a: RefusalAnswer): ReplayFinding[] {
  if (a === null) return [f(false, 'an unauthenticated replay=required with a real cursor opened a stream — it MUST be refused (401, or the uniform 409)')];
  return [f((a.status === 401 || a.status === 409) && !(a.contentType ?? '').includes('text/event-stream'), `an unauthenticated replay=required with a real cursor MUST be refused 401 or 409, never resumed (got ${a.status})`)];
}

/** Every refusal is byte-identical, so a refusal is not an oracle for another tenant's events. */
export function judgeUniform(answers: ReadonlyArray<{ what: string; a: RefusalAnswer }>): ReplayFinding[] {
  const base = answers[0];
  if (base === undefined) return [f(false, 'no refusal was recorded')];
  return answers.slice(1).map(({ what, a }) => f(
    a !== null && base.a !== null && a.status === base.a.status && a.text === base.a.text,
    `${what} MUST be answered byte-identically to ${base.what} (status ${a?.status ?? 'stream'} vs ${base.a?.status ?? 'stream'}; bodies ${a !== null && base.a !== null && a.text === base.a.text ? 'equal' : 'differ'})`,
  ));
}

/** Without `replay=required`, an unknown cursor keeps its old answer: not the new refusal. */
export function judgeLegacy(status: number | null): ReplayFinding[] {
  return [f(status !== null && status !== 409, `without replay=required an unknown Last-Event-ID MUST keep its existing behaviour, not ${RESYNC} (got ${status ?? 'no answer'})`)];
}
