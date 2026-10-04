/**
 * The model-capability refusal witness (`host-services.md` §modelCapabilities;
 * RFC 0031 §B step 4 + §D), shared by every major that serves the
 * `conformance-model-capability-insufficient` fixture.
 *
 * The fixture's one node declares `requiredModelCapabilities:
 * ['nonexistent-capability-9b3f']` and no `fallbackModel`, so no model can meet
 * it and no substitution is possible. A host advertising `modelCapabilities`
 * MUST then "emit `model.capability-insufficient` and fail the run with
 * `capability_not_provided`", and MUST NOT dispatch.
 *
 * Two legs over ONE run:
 *   refusal      the run ends `failed` / `capability_not_provided`; the log
 *                carries the insufficient event, before `node.failed`, with a
 *                payload valid against `run-event-payloads#/$defs/modelCapabilityInsufficient`
 *                and `fallbackAttempted` not `true` (no fallback was declared);
 *   no-dispatch  the log carries no `node.completed`, `provider.usage` or
 *                envelope-reliability event — the node never ran.
 *
 * Two halves: {@link drive} observes and asserts nothing; {@link judgeRefusal}
 * and {@link judgeNoDispatch} are pure, proven in
 * `model-capability-insufficient-witness.test.ts`.
 */

import { driver } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';
import { v2RefValidator } from './v2.js';

export const INSUFFICIENT_FIXTURE = 'conformance-model-capability-insufficient';
const DOC = 'host-services.md §modelCapabilities';
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface InsufficientFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export interface InsufficientSkip { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
export interface ObservedEvent { readonly type: string; readonly sequence: number; readonly payload: Record<string, unknown> | undefined }
export interface InsufficientObservation {
  readonly createStatus: number;
  readonly createCode: string | undefined;
  readonly terminalStatus: string | undefined;
  readonly errorCode: string | undefined;
  /** The run's events, ordered by `sequence`. */
  readonly events: readonly ObservedEvent[];
}

/** This major's name for an era-1 event; the era-1 name when the codemap has no row (the judge then looks for both). */
const nameAt = (profile: MajorProfile, era1: string): string => profile.eventType(era1) ?? era1;

/** One fixture run, observed. Asserts nothing. */
export async function drive(profile: MajorProfile, discovery: unknown, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<InsufficientSkip | InsufficientObservation> {
  if (profile.family(discovery, 'modelCapabilities') === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise modelCapabilities — the dispatch gate binds only a host that does' };
  if (!isFixtureAdvertised(INSUFFICIENT_FIXTURE)) return { kind: 'skip', disposition: 'inapplicable', reason: `fixture ${INSUFFICIENT_FIXTURE} is not advertised — the host claims no workflow whose node requires a capability no model offers` };
  const created = await driver.post(profile.runsPath, { workflowId: INSUFFICIENT_FIXTURE });
  const runId = isRecord(created.json) ? created.json['runId'] : undefined;
  if ((created.status !== 201 && created.status !== 202) || typeof runId !== 'string') {
    return { createStatus: created.status, createCode: readErrorCode(created.json), terminalStatus: undefined, errorCode: undefined, events: [] };
  }
  const base = `${profile.runsPath}/${profile.idSegment(runId)}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let snap: Record<string, unknown> = {};
  for (;;) {
    const r = await driver.get(base);
    snap = isRecord(r.json) ? r.json : {};
    if (['completed', 'failed', 'cancelled'].includes(String(snap['status'])) || Date.now() > deadline) break;
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 500));
  }
  const poll = await driver.get(`${base}/events/poll?timeout=1`);
  const raw = isRecord(poll.json) && Array.isArray(poll.json['events']) ? (poll.json['events'] as unknown[]) : [];
  const events = raw.filter(isRecord).map((e) => ({
    type: String(e['type']),
    sequence: typeof e['sequence'] === 'number' ? e['sequence'] : Number.MAX_SAFE_INTEGER,
    payload: isRecord(e['payload']) ? e['payload'] : undefined,
  })).sort((a, b) => a.sequence - b.sequence);
  const err = isRecord(snap['error']) ? snap['error'] : undefined;
  return {
    createStatus: created.status,
    createCode: undefined,
    terminalStatus: typeof snap['status'] === 'string' ? snap['status'] : undefined,
    errorCode: typeof err?.['code'] === 'string' ? err['code'] : undefined,
    events,
  };
}

const f = (ok: boolean, message: string): InsufficientFinding => ({ ok, doc: DOC, message });

/** Leg 1, refusal. Pure. */
export function judgeRefusal(profile: MajorProfile, o: InsufficientObservation): InsufficientFinding[] {
  const created = f(o.createStatus === 201 || o.createStatus === 202, `a create of the advertised fixture MUST be accepted; the refusal is at dispatch, not at create (got ${o.createStatus}${o.createCode ? ` ${o.createCode}` : ''})`);
  if (!created.ok) return [created];
  const insufficientType = nameAt(profile, 'model.capability.insufficient');
  const nodeFailedType = nameAt(profile, 'node.failed');
  const idx = o.events.findIndex((e) => e.type === insufficientType);
  const failedIdx = o.events.findIndex((e) => e.type === nodeFailedType);
  const ev = idx >= 0 ? o.events[idx] : undefined;
  const out = [
    created,
    f(o.terminalStatus === 'failed', `a run whose node requires a capability no model offers MUST end failed (got ${String(o.terminalStatus)})`),
    f(o.errorCode === 'capability_not_provided', `the run's error.code MUST be capability_not_provided (got ${String(o.errorCode)})`),
    f(ev !== undefined, `the host MUST emit ${insufficientType} (types seen: ${JSON.stringify(o.events.map((e) => e.type))})`),
  ];
  if (ev === undefined) return out;
  out.push(f(failedIdx < 0 || idx < failedIdx, `${insufficientType} MUST precede ${nodeFailedType} (cause before effect; at ${idx} vs ${failedIdx})`));
  if (profile.major >= 2) {
    const r = v2RefValidator('run-event-payloads.schema.json#/$defs/modelCapabilityInsufficient')(ev.payload ?? {});
    out.push(f(r.ok, `the ${insufficientType} payload MUST validate against run-event-payloads#/$defs/modelCapabilityInsufficient${r.ok ? '' : ` (${r.errors})`}`));
  }
  out.push(f(ev.payload?.['fallbackAttempted'] !== true, `fallbackAttempted MUST NOT be true: the fixture declares no fallbackModel, so no fallback was attempted (got ${JSON.stringify(ev.payload?.['fallbackAttempted'])})`));
  return out;
}

/** What a refused dispatch MUST NOT emit, by era-1 name. */
export const NOT_AFTER_REFUSAL = ['node.completed', 'provider.usage', 'envelope.retry.attempted', 'envelope.retry.exhausted', 'envelope.refusal', 'envelope.truncated', 'envelope.nlToFormat.engaged', 'envelope.recovery.applied'] as const;

/** Leg 2, no-dispatch. Pure. Looks for each event by this major's name AND its era-1 name. */
export function judgeNoDispatch(profile: MajorProfile, o: InsufficientObservation): InsufficientFinding[] {
  if (o.createStatus !== 201 && o.createStatus !== 202) return [f(false, `a create of the advertised fixture MUST be accepted (got ${o.createStatus})`)];
  const forbidden = new Set<string>(NOT_AFTER_REFUSAL.flatMap((n) => [n, nameAt(profile, n)]));
  const leaked = o.events.filter((e) => forbidden.has(e.type)).map((e) => e.type);
  return [f(leaked.length === 0, `a refused dispatch MUST NOT emit node completion, provider usage or envelope-reliability events — the node never ran (got ${JSON.stringify(leaked)})`)];
}
