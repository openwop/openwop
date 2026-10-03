/**
 * The trigger-bridge delivery witness on the normative surface (RFC 0230's
 * signed ingest, RFC 0232's dead-letter read), shared by every major that
 * serves it. What differs between majors — the subscription path, how an id
 * becomes a path segment, event names, the page schema — is the profile row
 * in `major-profile.ts`.
 *
 * Each leg OBSERVES and returns findings; it asserts nothing. The scenario file
 * maps findings to requirement ids, and `trigger-delivery-witness.test.ts`
 * proves every leg against a scratch double with one defect turned on.
 *
 * There is no seam path here. At major 2 no seam drives a trigger delivery, so
 * a leg whose only surface is a seam is `inapplicable` (no party can cause the
 * condition), never `blocked`.
 *
 * Today only `v2-trigger-bridge-delivery` and `v2-trigger-dead-letter-read` use
 * it; the major-1 files keep their own inline legs, which the production hosts
 * have already witnessed.
 */

import { driver } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import type { MajorProfile } from './major-profile.js';
import { freshWebhookId, standardWebhooksSignature } from './triggerBridge.js';
import { freshCanary, judge as judgeDeadLetters, type DeadLetterRead } from './trigger-dead-letter-witness.js';

export interface TriggerFinding {
  readonly ok: boolean;
  readonly doc: string;
  readonly message: string;
}
export type LegOutcome =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly findings: readonly TriggerFinding[]; readonly note?: string };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const f = (ok: boolean, doc: string, message: string): TriggerFinding => ({ ok, doc, message });

/** What the host advertises for the trigger bridge at this major. */
export interface TriggerAdverts {
  readonly family: Record<string, unknown> | null;
  readonly inboundSigning: boolean;
  readonly deadLetter: { readonly retentionDays: number; readonly maxPageSize: number } | null;
}

export function adverts(profile: MajorProfile, doc: unknown): TriggerAdverts {
  const family = profile.family(doc, 'triggerBridge');
  const ingestion = isRecord(family?.['ingestion']) ? family!['ingestion'] as Record<string, unknown> : undefined;
  const signing = ingestion?.['inboundSigning'];
  const dl = isRecord(family?.['deadLetter']) ? family!['deadLetter'] as Record<string, unknown> : undefined;
  return {
    family,
    inboundSigning: Array.isArray(signing) && signing.includes('standard-webhooks-1'),
    deadLetter: dl !== undefined && typeof dl['retentionDays'] === 'number' && typeof dl['maxPageSize'] === 'number'
      ? { retentionDays: dl['retentionDays'] as number, maxPageSize: dl['maxPageSize'] as number }
      : null,
  };
}

/** The gate every signed-path leg shares. */
export function signedGate(a: TriggerAdverts): LegOutcome | null {
  if (a.family === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise triggerBridge' };
  if (!a.inboundSigning) return { kind: 'skip', disposition: 'inapplicable', reason: 'triggerBridge.ingestion.inboundSigning does not list standard-webhooks-1, and no other wire surface delivers a trigger event at this major' };
  return null;
}

export interface Sub { readonly subscriptionId: string; readonly ingestUrl: string; readonly signingSecret: string }

async function register(profile: MajorProfile, mode: 'none' | 'required'): Promise<Sub | string> {
  const res = await driver.post(profile.triggerSubscriptionsPath, { source: 'webhook', workflowId: 'conformance-noop', verification: { mode } });
  const body = res.json as { subscription?: { subscriptionId?: unknown }; binding?: { ingestUrl?: unknown; signingSecret?: unknown } } | undefined;
  const subscriptionId = body?.subscription?.subscriptionId;
  const ingestUrl = body?.binding?.ingestUrl;
  const signingSecret = body?.binding?.signingSecret;
  if (res.status !== 201 || typeof subscriptionId !== 'string' || typeof ingestUrl !== 'string' || typeof signingSecret !== 'string') {
    return `POST ${profile.triggerSubscriptionsPath} answered ${res.status} without the binding (subscriptionId, ingestUrl, signingSecret)`;
  }
  return { subscriptionId, ingestUrl, signingSecret };
}

async function ingest(sub: Sub, body: string, opts: { webhookId?: string; signature?: string } = {}): Promise<{ status: number; json: Record<string, unknown> | undefined }> {
  const id = opts.webhookId ?? freshWebhookId();
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = opts.signature ?? standardWebhooksSignature(sub.signingSecret, id, ts, body);
  const res = await driver.post(sub.ingestUrl, body, {
    authenticated: false,
    headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig },
  });
  return { status: res.status, json: isRecord(res.json) ? res.json : undefined };
}

export const BAD_SIGNATURE = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const DOC_INGEST = 'webhooks.md §Inbound triggers';

/** A registration that did not yield the binding is a host defect on an advertised surface. */
function bindingFinding(reason: string): LegOutcome {
  return { kind: 'observed', findings: [f(false, DOC_INGEST, `a host advertising inboundSigning MUST return the binding on webhook registration: ${reason}`)] };
}

/** Leg 1: a repeated `webhook-id` is effectively-once. */
export async function dedupLeg(profile: MajorProfile, a: TriggerAdverts): Promise<LegOutcome> {
  const gate = signedGate(a); if (gate) return gate;
  const sub = await register(profile, 'none'); if (typeof sub === 'string') return bindingFinding(sub);
  const body = JSON.stringify({ conformance: 'dedup' });
  const webhookId = freshWebhookId();
  const first = await ingest(sub, body, { webhookId });
  const runId = first.json?.['runId'];
  const again = await ingest(sub, body, { webhookId });
  return { kind: 'observed', findings: [
    f(first.status === 202, DOC_INGEST, `a signed delivery MUST answer 202 (got ${first.status})`),
    f(typeof runId === 'string' && runId.length > 0, DOC_INGEST, 'a 202 MUST carry the started runId'),
    f(again.status === 200, DOC_INGEST, `a repeated webhook-id MUST answer 200, starting no new run (got ${again.status})`),
    f(again.json?.['outcome'] === 'duplicate', DOC_INGEST, `the dedup no-op MUST say outcome "duplicate" (got ${String(again.json?.['outcome'])})`),
    f(again.json?.['runId'] === runId, DOC_INGEST, 'a dedup no-op MUST return the prior runId'),
  ] };
}

/** Leg 2: a refused post starts no run and does not change the subscription's state. */
export async function refusedLeg(profile: MajorProfile, a: TriggerAdverts): Promise<LegOutcome> {
  const gate = signedGate(a); if (gate) return gate;
  const sub = await register(profile, 'required'); if (typeof sub === 'string') return bindingFinding(sub);
  const body = JSON.stringify({ conformance: 'dead-letter' });
  const bad = await ingest(sub, body, { signature: BAD_SIGNATURE });
  const read = await driver.get(`${profile.triggerSubscriptionsPath}/${profile.idSegment(sub.subscriptionId)}`);
  const state = (read.json as { subscription?: { state?: unknown } } | undefined)?.subscription?.state;
  const ok = await ingest(sub, body);
  return { kind: 'observed', findings: [
    f(bad.status === 401, DOC_INGEST, `a bad signature under required verification MUST answer 401 (got ${bad.status})`),
    f(readErrorCode(bad.json) === 'signature_invalid', DOC_INGEST, `the refusal MUST carry signature_invalid (got ${String(readErrorCode(bad.json))})`),
    f(bad.json?.['runId'] === undefined, DOC_INGEST, 'a failed required check MUST NOT start a run'),
    f(state === 'active', DOC_INGEST, `a refused event MUST NOT change the subscription's state (read answered ${read.status}, state ${String(state)})`),
    f(ok.status === 202, DOC_INGEST, `after a refused post the subscription MUST still deliver a correctly signed one (got ${ok.status})`),
  ] };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Leg 3: the delivered run's `run.started` carries the delivery as `causationId`. */
export async function causationLeg(profile: MajorProfile, a: TriggerAdverts, opts: { pollMs?: number; pollTries?: number } = {}): Promise<LegOutcome> {
  const gate = signedGate(a); if (gate) return gate;
  const sub = await register(profile, 'none'); if (typeof sub === 'string') return bindingFinding(sub);
  const res = await ingest(sub, JSON.stringify({ conformance: 'causation' }));
  const runId = res.json?.['runId'];
  if (res.status !== 202 || typeof runId !== 'string' || runId.length === 0) {
    return { kind: 'observed', findings: [f(false, DOC_INGEST, `a signed delivery MUST answer 202 with the started runId (got ${res.status} ${JSON.stringify(res.json ?? null).slice(0, 200)})`)] };
  }
  const startedType = profile.eventType('run.started');
  const attemptType = profile.eventType('trigger.delivery.attempted');
  if (startedType === undefined || attemptType === undefined) return { kind: 'skip', disposition: 'blocked', reason: 'the event codemap is not on disk in this layout, so this major\'s event names are unknown' };
  let events: Array<Record<string, unknown>> = [];
  let pollStatus = 0;
  for (let i = 0; i < (opts.pollTries ?? 10); i++) {
    const poll = await driver.get(`${profile.runsPath}/${profile.idSegment(runId)}/events/poll`);
    pollStatus = poll.status;
    events = ((poll.json as { events?: unknown } | undefined)?.events as Array<Record<string, unknown>> | undefined) ?? [];
    if (events.some((e) => e['type'] === startedType)) break;
    await sleep(opts.pollMs ?? 500);
  }
  const started = events.find((e) => e['type'] === startedType);
  const causationId = started?.['causationId'];
  const delivered = events.find((e) => e['type'] === attemptType && isRecord(e['payload']) && (e['payload'] as Record<string, unknown>)['outcome'] === 'delivered');
  const findings = [
    f(started !== undefined, 'webhooks.md §Inbound triggers', `a delivered run MUST emit ${startedType} (poll answered ${pollStatus}; saw ${events.map((e) => String(e['type'])).join(',') || 'none'})`),
    f(typeof causationId === 'string' && causationId.length > 0, 'webhooks.md §Inbound triggers', `${startedType} MUST carry the delivery id as causationId`),
  ];
  if (delivered !== undefined) findings.push(f(causationId === delivered['eventId'], 'webhooks.md §Inbound triggers', `${startedType}.causationId MUST equal the delivered attempt's eventId`));
  return { kind: 'observed', findings, note: delivered === undefined ? 'the delivered attempt event is not on the run log, so equality was not checked' : 'causationId equals the delivered attempt' };
}

/** GET one page of a subscription's dead letters at this major. Asserts nothing. */
export async function readDeadLettersAt(profile: MajorProfile, subscriptionId: string, query: { limit?: number; cursor?: string } = {}, headers?: Record<string, string>): Promise<DeadLetterRead> {
  const qs = new URLSearchParams();
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor !== undefined) qs.set('cursor', query.cursor);
  const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
  const res = await driver.get(`${profile.triggerSubscriptionsPath}/${profile.idSegment(subscriptionId)}/dead-letters${suffix}`, headers ? { headers } : {});
  return { status: res.status, json: res.json };
}

/** Leg 4a: a dead-lettered (run-less) attempt is content-free, read through RFC 0232's read. */
export async function runlessAttemptLeg(profile: MajorProfile, a: TriggerAdverts, validate: (page: unknown) => { ok: boolean; errors: string }): Promise<LegOutcome> {
  const gate = signedGate(a); if (gate) return gate;
  if (a.deadLetter === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'a dead-lettered attempt is on no run\'s log, and the host does not advertise triggerBridge.deadLetter, the only surface that reads it at this major' };
  const sub = await register(profile, 'required'); if (typeof sub === 'string') return bindingFinding(sub);
  const canary = freshCanary();
  const bad = await ingest(sub, JSON.stringify({ conformance: 'runless-attempt', canary }), { signature: BAD_SIGNATURE });
  const read = await readDeadLettersAt(profile, sub.subscriptionId);
  const findings = [f(bad.status === 401, DOC_INGEST, `a bad signature under required verification MUST answer 401 (got ${bad.status})`)];
  for (const j of judgeDeadLetters(read, { subscriptionId: sub.subscriptionId, canary, signature: BAD_SIGNATURE, signingSecret: sub.signingSecret, retentionDays: a.deadLetter.retentionDays }, validate)) {
    findings.push(f(j.ok, DOC_INGEST, j.message));
  }
  return { kind: 'observed', findings, note: 'RFC 0232 dead-letter read' };
}

/** Leg 4b: a run-less state change. No surface causes one without a seam, and no seam exists at this major. */
export function runlessStateChangeLeg(a: TriggerAdverts): LegOutcome {
  if (a.family === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise triggerBridge' };
  return { kind: 'skip', disposition: 'inapplicable', reason: 'no wire surface causes a trigger subscription state change, and no seam drives one at this major (RFC 0232 §E, gap G2)' };
}

// ---------------------------------------------------------------------------
// The read's own rules (RFC 0232 §B).
// ---------------------------------------------------------------------------

function readGate(a: TriggerAdverts): LegOutcome | null {
  if (a.family === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise triggerBridge' };
  if (a.deadLetter === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise triggerBridge.deadLetter' };
  if (!a.inboundSigning) return { kind: 'skip', disposition: 'inapplicable', reason: 'triggerBridge.deadLetter is advertised without inboundSigning, so the suite cannot cause a dead letter unaided' };
  return null;
}

async function refusedTwice(profile: MajorProfile, n: number): Promise<Sub | string> {
  const sub = await register(profile, 'required'); if (typeof sub === 'string') return sub;
  for (let i = 0; i < n; i++) await ingest(sub, JSON.stringify({ conformance: 'dead-letter-read', i }), { signature: BAD_SIGNATURE });
  return sub;
}
const deliveriesOf = (json: unknown): unknown[] => { const d = (json as { deliveries?: unknown } | undefined)?.deliveries; return Array.isArray(d) ? d : []; };
const cursorOf = (json: unknown): unknown => (json as { nextCursor?: unknown } | undefined)?.nextCursor;

export async function pagingLeg(profile: MajorProfile, a: TriggerAdverts): Promise<LegOutcome> {
  const gate = readGate(a); if (gate) return gate;
  const sub = await refusedTwice(profile, 2); if (typeof sub === 'string') return bindingFinding(sub);
  const first = await readDeadLettersAt(profile, sub.subscriptionId, { limit: 1 });
  const cursor = cursorOf(first.json);
  const second = typeof cursor === 'string' ? await readDeadLettersAt(profile, sub.subscriptionId, { limit: 1, cursor }) : undefined;
  const big = await readDeadLettersAt(profile, sub.subscriptionId, { limit: a.deadLetter!.maxPageSize + 1 });
  return { kind: 'observed', findings: [
    f(first.status === 200, DOC_INGEST, `a host advertising triggerBridge.deadLetter MUST serve the read (got ${first.status})`),
    f(deliveriesOf(first.json).length === 1, DOC_INGEST, `a page MUST NOT exceed limit (got ${deliveriesOf(first.json).length} for limit 1)`),
    f(typeof cursor === 'string' && cursor.length > 0, DOC_INGEST, 'with two dead letters and limit 1, the page MUST carry nextCursor'),
    f(second?.status === 200 && deliveriesOf(second.json).length === 1, DOC_INGEST, `the page's own cursor MUST continue to the second dead letter (got ${String(second?.status)})`),
    f(big.status === 200, DOC_INGEST, `a limit above maxPageSize MUST be clamped, not refused (got ${big.status})`),
  ] };
}

export async function cursorLeg(profile: MajorProfile, a: TriggerAdverts): Promise<LegOutcome> {
  const gate = readGate(a); if (gate) return gate;
  const subA = await refusedTwice(profile, 2); if (typeof subA === 'string') return bindingFinding(subA);
  const page = await readDeadLettersAt(profile, subA.subscriptionId, { limit: 1 });
  const cursor = cursorOf(page.json);
  if (typeof cursor !== 'string' || cursor.length === 0) {
    return { kind: 'observed', findings: [f(false, DOC_INGEST, `with two dead letters and limit 1, the page MUST carry nextCursor (read answered ${page.status})`)] };
  }
  const subB = await refusedTwice(profile, 1); if (typeof subB === 'string') return bindingFinding(subB);
  const cross = await readDeadLettersAt(profile, subB.subscriptionId, { cursor });
  return { kind: 'observed', findings: [
    f(cross.status === 400, DOC_INGEST, `a cursor minted for another subscription MUST be refused 400 (got ${cross.status})`),
    f(readErrorCode(cross.json) === 'validation_error', DOC_INGEST, `the refusal MUST carry validation_error (got ${String(readErrorCode(cross.json))})`),
  ] };
}

export async function tenantLeg(profile: MajorProfile, a: TriggerAdverts, otherTenantKey: string | undefined, ownKey: string): Promise<LegOutcome> {
  const gate = readGate(a); if (gate) return gate;
  if (!otherTenantKey) return { kind: 'skip', disposition: 'blocked', reason: 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-tenant read cannot run' };
  if (otherTenantKey.trim() === ownKey) return { kind: 'skip', disposition: 'blocked', reason: 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the second credential must resolve to a DIFFERENT tenant, or the leg measures nothing' };
  const sub = await refusedTwice(profile, 1); if (typeof sub === 'string') return bindingFinding(sub);
  const foreign = await readDeadLettersAt(profile, sub.subscriptionId, {}, { Authorization: `Bearer ${otherTenantKey}` });
  const unknown = await readDeadLettersAt(profile, `${sub.subscriptionId}-never-minted`);
  const noDisclosure = f(!JSON.stringify(foreign.json ?? null).includes('verification_failed'), DOC_INGEST, 'a foreign read MUST NOT disclose a record');
  const unknownFinding = f(unknown.status === 404, DOC_INGEST, `an id the host never minted MUST answer 404 (got ${unknown.status})`);
  if (profile.foreignTenantRead === 'id_tenant_mismatch') {
    // identity.md §5: a bound id whose tenant segment is not the caller's is
    // refused 403 id_tenant_mismatch, before any lookup, so it discloses nothing.
    return { kind: 'observed', findings: [
      f(foreign.status === 403, 'identity.md §5', `another tenant's bound id MUST be refused 403 (got ${foreign.status})`),
      f(readErrorCode(foreign.json) === 'id_tenant_mismatch', 'identity.md §5', `the refusal MUST carry id_tenant_mismatch (got ${String(readErrorCode(foreign.json))})`),
      noDisclosure,
      unknownFinding,
    ] };
  }
  return { kind: 'observed', findings: [
    f(foreign.status === 404, DOC_INGEST, `another tenant's read MUST answer 404 (got ${foreign.status})`),
    noDisclosure,
    unknownFinding,
    f(readErrorCode(foreign.json) === readErrorCode(unknown.json), DOC_INGEST, 'a foreign id MUST be answered exactly as an unknown one'),
  ] };
}
