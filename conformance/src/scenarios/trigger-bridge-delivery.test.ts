/**
 * Durable trigger bridge — delivery model (RFC 0083 §C) — behavioral.
 *
 * Profile-gated on `openwop-trigger-bridge` (derived from the live discovery
 * doc per RFC 0083 §D). Soft-skips when the profile isn't derived / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives
 * in `trigger-bridge-shape.test.ts`.
 *
 * Seven legs, each its own requirement (RFC 0230 split the one combined `it`;
 * RFC 0232 split the fourth; 2.45.12 added 2b and 2c):
 *
 *   1. DEDUP (§C-1) — a repeated delivery is effectively-once.
 *   2. DEAD-LETTER (§C-2 + RFC 0053) — an exhausted/refused delivery starts no run.
 *   2b. STALE TIMESTAMP (RFC 0230 §C) — under `required`, a `webhook-timestamp`
 *      more than 300 s off, either way, answers `401 signature_invalid`, starts
 *      no run and leaves the subscription `active`.
 *   2c. SECRET ONCE (RFC 0230 §B, SR-1) — a re-read of the subscription carries
 *      no `signingSecret` and no `whsec_` value.
 *   Legs 2b and 2c have only the normative-surface path: they are
 *   `inapplicable` on a host that does not advertise `inboundSigning`.
 *   3. CAUSATION (§C / RFC 0040) — a delivered run carries the delivery as
 *      `run.started.causationId`.
 *   4a. RUN-LESS ATTEMPT (SR-1) — a dead-lettered `trigger.delivery.attempted`
 *      carries no inbound content.
 *   4b. RUN-LESS STATE CHANGE (SR-1) — a `trigger.subscription.state.changed`
 *      carries no inbound content.
 *
 * TWO WITNESS PATHS, and a host is measured on EVERY path it offers (2.45.8).
 * The SEAM path drives `POST /v1/host/sample/trigger-bridge/deliver` and reads
 * the test event-log seam; it runs whenever the host serves the seams. The
 * NORMATIVE-SURFACE path of RFC 0230 registers a webhook subscription and POSTs
 * Standard-Webhooks-signed bodies to its `ingestUrl` with no OpenWOP credential;
 * legs 1–3 run it whenever the host advertises
 * `triggerBridge.ingestion.inboundSigning: ["standard-webhooks-1"]`. A host that
 * offers both must pass both, and each row notes which ran (`observed:`).
 *
 * Until 2.45.8 the normative-surface path ran only when the seams were absent.
 * That left it unwitnessable on a certified bundle: with the seams mounted it
 * never ran, and without them leg 4 (seam-only) is red, the profile does not
 * certify, and an uncertified bundle supplies no acceptance evidence
 * (RFC 0174 §B.1).
 *
 * The run-less events are on no run's log. Leg 4a's normative-surface path is
 * RFC 0232's read: on a host advertising `inboundSigning` AND
 * `triggerBridge.deadLetter`, it posts a canary with a bad signature and reads
 * the subscription's dead letters (`lib/trigger-dead-letter-witness.ts`).
 * Leg 4b has no such path: no wire surface causes a subscription state change
 * (a refused post must not change state; nothing pauses a subscription), so it
 * is seam-witnessed and, on a host without the seam, records `inapplicable`
 * (RFC 0232 Unresolved question 1, decided (a)). Both stay in the floor.
 *
 * Spec references:
 *   - spec/v1/trigger-bridge.md (§C, §F.2, §F.6)
 *   - RFCS/0083-durable-trigger-and-channel-bridge-profile.md, RFCS/0230-inbound-webhook-ingest-contract.md,
 *     RFCS/0232-trigger-dead-letter-read.md
 *   - spec/v1/profiles.md (§openwop-trigger-bridge)
 */

import { describe, it, expect } from 'vitest';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import {
  isTriggerBridgeProfileAdvertised,
  driveDelivery,
  DELIVERY_OUTCOMES,
  SUBSCRIPTION_STATES,
  freshDedupKey,
  inboundSigningAdvertised,
  registerSignedWebhook,
  signedIngest,
  freshWebhookId,
} from '../lib/triggerBridge.js';
import { queryTestEvents, requireEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { noteObservation } from '../lib/row-observation.js';
import { driver } from '../lib/driver.js';
import { deadLetterFacet, freshCanary, judge as judgeDeadLetters, readDeadLetters } from '../lib/trigger-dead-letter-witness.js';

const R_DEDUP = 'openwop.requirement.0083.trigger-delivery.dedup';
const R_DEAD_LETTER = 'openwop.requirement.0083.trigger-delivery.dead-letter';
const R_STALE_TIMESTAMP = 'openwop.requirement.0230.stale-timestamp-refused';
const R_SECRET_ONCE = 'openwop.requirement.0230.signing-secret-once';
const R_CAUSATION = 'openwop.requirement.0083.trigger-delivery.causation';
const R_RUNLESS_ATTEMPT = 'openwop.requirement.0083.trigger-delivery.runless-attempt-content-free';
const R_RUNLESS_STATE = 'openwop.requirement.0083.trigger-delivery.runless-state-change-content-free';

/** How far off the skew probes are: twice the 300 s bound, so ordinary clock drift cannot pass or fail them. */
const SKEW_PROBE_SECONDS = 600;
const NO_SIGNING = 'the host does not advertise triggerBridge.ingestion.inboundSigning ["standard-webhooks-1"]: this rule binds only the RFC 0230 signed ingest, and no seam path witnesses it';

/** True when `v` holds a `signingSecret` key at any depth. */
function hasSecretKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasSecretKey);
  if (v === null || typeof v !== 'object') return false;
  return Object.entries(v as Record<string, unknown>).some(([k, x]) => k === 'signingSecret' || hasSecretKey(x));
}

/** The bad signature every refused-post probe sends. */
const BAD_SIGNATURE = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const CONTENT_FREE_FORBIDDEN = ['body', 'headers', 'payload', 'secret', 'credentials', 'token', 'apiKey'];

function expectContentFree(id: string, payload: Record<string, unknown>, where: string): void {
  for (const f of CONTENT_FREE_FORBIDDEN) {
    expect(!(f in payload), req(id, 'RFC 0083 §C (SR-1)', `${where} MUST be content-free (no ${f})`)).toBe(true);
  }
}

/** The witness paths this host offers. Both are run when both are offered. */
async function witnessPaths(): Promise<{ seam: boolean; normative: boolean }> {
  return { seam: await isEventLogSeamAvailable(), normative: await inboundSigningAdvertised() };
}

/** `ran`, or `absent` when the delivery seam turned out to be unwired; the leg then records it with `seamAbsent`. */
const SEAM_UNWIRED = 'host advertises openwop-trigger-bridge but the delivery seam is unwired';
type SeamLeg = 'ran' | 'absent';

function notePaths(seam: boolean, normative: boolean, extra = ''): void {
  noteObservation([seam ? 'seam path' : '', normative ? 'normative-surface path (RFC 0230)' : ''].filter((x) => x !== '').join(' + ') + extra);
}

const NO_PATH = 'host advertises openwop-trigger-bridge but neither the event-log seam nor an RFC 0230 inboundSigning ingest is available';

/** The bare opaque id of a (possibly tenant-bound) runId — the v1 read path. */
function bareRunId(runId: string): string {
  return runId.includes('/') ? runId.slice(runId.lastIndexOf('/') + 1) : runId;
}

/** The seam witness path (primary when the host serves the seams). */
async function dedupViaSeam(): Promise<SeamLeg> {
    // The dedupKey is MINTED PER EXERCISE, and that is load-bearing (2.37.0):
    // §C-1's dedup window is a ≥24h floor, so a literal key collides with an
    // earlier run the same day and convicts a conformant host. The repetition
    // §C-1 is about happens INSIDE `driveDelivery`'s `scenario: 'dedup'`.
    const dedupKey = freshDedupKey('queue');
    const dedup = await driveDelivery({ scenario: 'dedup', dedupKey, source: 'queue' });
    if (dedup === null) return 'absent';
    const dedupEvents = requireEvents(
      await queryTestEvents(dedup.runId ?? '__dedup__', { type: 'trigger.delivery.attempted' }),
      'trigger.delivery.attempted (dedup)',
    );
    const deliveredForKey = dedupEvents.filter((e) => e.payload.dedupKey === dedupKey && e.payload.outcome === 'delivered');
    expect(deliveredForKey.length === 1, req(R_DEDUP, 'trigger-bridge.md §C-1', 'a repeated dedupKey MUST be effectively-once — EXACTLY one delivered attempt (not zero, not two)')).toBe(true);
    for (const e of dedupEvents) {
      expect(typeof e.payload.outcome === 'string' && DELIVERY_OUTCOMES.includes(e.payload.outcome as string), req(R_DEDUP, 'run-event-payloads.schema.json#triggerDeliveryAttempted', 'outcome MUST be delivered|retrying|dead-lettered')).toBe(true);
      expectContentFree(R_DEDUP, e.payload, 'trigger.delivery.attempted');
    }
    await resetTestSeam();
  return 'ran';
}

/** The seam witness path (primary when the host serves the seams). */
async function deadLetterViaSeam(): Promise<SeamLeg> {
    const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
    if (exhaust === null) return 'absent';
    const exKey = exhaust.runId ?? '__exhaust__';
    const exhaustEvents = requireEvents(await queryTestEvents(exKey, { type: 'trigger.delivery.attempted' }), 'trigger.delivery.attempted (exhaust)');
    expect(exhaustEvents.length >= 1, req(R_DEAD_LETTER, 'trigger-bridge.md §C-2', 'an exhausted delivery MUST emit ≥1 trigger.delivery.attempted')).toBe(true);
    const terminal = exhaustEvents.sort((a, b) => a.sequence - b.sequence)[exhaustEvents.length - 1]!;
    expect(terminal.payload.outcome === 'dead-lettered', req(R_DEAD_LETTER, 'trigger-bridge.md §C-2', 'an exhausted retry policy MUST terminate in a dead-lettered delivery')).toBe(true);
    const stateEvents = requireEvents(await queryTestEvents(exKey, { type: 'trigger.subscription.state.changed' }), 'trigger.subscription.state.changed (exhaust)');
    expect(stateEvents.length >= 1, req(R_DEAD_LETTER, 'trigger-bridge.md §B', 'exhaustion MUST emit ≥1 trigger.subscription.state.changed')).toBe(true);
    expect(stateEvents.some((e) => e.payload.toState === 'dead-lettered'), req(R_DEAD_LETTER, 'trigger-bridge.md §B', 'the subscription MUST transition to dead-lettered on exhaustion')).toBe(true);
    for (const e of stateEvents) {
      expect(typeof e.payload.toState === 'string' && SUBSCRIPTION_STATES.includes(e.payload.toState as string), req(R_DEAD_LETTER, 'trigger-bridge.md §B', 'toState MUST be in the four-state vocabulary')).toBe(true);
    }
    await resetTestSeam();
  return 'ran';
}

/** The seam witness path (primary when the host serves the seams). */
async function causationViaSeam(): Promise<SeamLeg> {
    const delivered = await driveDelivery({ scenario: 'deliver', source: 'schedule' });
    expect(delivered !== null && typeof delivered.runId === 'string' && (delivered.runId as string).length > 0, req(R_CAUSATION, 'trigger-bridge.md §C', 'a successful delivery MUST create a run')).toBe(true);
    const deliveredRunId = delivered!.runId as string;
    const attemptEvents = requireEvents(await queryTestEvents(deliveredRunId, { type: 'trigger.delivery.attempted' }), 'trigger.delivery.attempted (deliver)');
    const deliveredEvent = attemptEvents.find((e) => e.payload.outcome === 'delivered');
    expect(deliveredEvent !== undefined, req(R_CAUSATION, 'trigger-bridge.md §C-1', 'a successful delivery MUST emit a trigger.delivery.attempted{outcome:delivered}')).toBe(true);
    const runStartedEvents = requireEvents(await queryTestEvents(deliveredRunId, { type: 'run.started' }), 'run.started (deliver)');
    expect(runStartedEvents.length >= 1, req(R_CAUSATION, 'trigger-bridge.md §C', 'a delivered run MUST emit run.started')).toBe(true);
    const runStarted = runStartedEvents.sort((a, b) => a.sequence - b.sequence)[0]!;
    expect(
      typeof runStarted.causationId === 'string' && (runStarted.causationId as string).length > 0 && runStarted.causationId === deliveredEvent!.eventId,
      req(R_CAUSATION, 'trigger-bridge.md §C / RFC 0040', 'run.started.causationId MUST EQUAL the delivery id (the trigger.delivery.attempted{delivered} eventId) — resolvable via /ancestry'),
    ).toBe(true);
    await resetTestSeam();
  return 'ran';
}

describe('trigger-bridge-delivery (RFC 0083 §C)', () => {
  it('de-dups by dedupKey: a repeated delivery is effectively-once', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const paths = await witnessPaths();
    if (!paths.seam && !paths.normative) return seamAbsent(NO_PATH);

    if (paths.seam && (await dedupViaSeam()) === 'absent') return seamAbsent(SEAM_UNWIRED);
    if (!paths.normative) return notePaths(true, false);

    // Normative-surface path (RFC 0230 §C Identity + §D).
    const sub = await registerSignedWebhook('none');
    if ('reason' in sub) throw new Error(req(R_DEDUP, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
    const body = JSON.stringify({ conformance: 'dedup' });
    const webhookId = freshWebhookId();
    const first = await signedIngest(sub, body, { webhookId });
    expect(first.status, req(R_DEDUP, 'trigger-bridge.md §F.6', `a signed delivery MUST answer 202 (got ${first.status} ${JSON.stringify(first.json)})`)).toBe(202);
    const runId = first.json?.runId;
    expect(typeof runId === 'string' && runId.length > 0, req(R_DEDUP, 'trigger-bridge.md §F.6', 'a 202 MUST carry the started runId')).toBe(true);
    const again = await signedIngest(sub, body, { webhookId });
    expect(again.status, req(R_DEDUP, 'trigger-bridge.md §F.6 / §C-1', `a repeated webhook-id MUST answer 200 duplicate, starting no new run (got ${again.status})`)).toBe(200);
    expect(again.json?.outcome, req(R_DEDUP, 'trigger-bridge.md §F.6', 'the dedup no-op MUST say outcome "duplicate"')).toBe('duplicate');
    expect(again.json?.runId, req(R_DEDUP, 'trigger-bridge.md §F.4', 'a dedup no-op MUST return the PRIOR runId')).toBe(runId);
    notePaths(paths.seam, true);
  });

  it('dead-letters an exhausted or refused delivery without starting a run', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const paths = await witnessPaths();
    if (!paths.seam && !paths.normative) return seamAbsent(NO_PATH);

    if (paths.seam && (await deadLetterViaSeam()) === 'absent') return seamAbsent(SEAM_UNWIRED);
    if (!paths.normative) return notePaths(true, false);

    // Normative-surface path (RFC 0230 §C Verification + §C.1).
    const sub = await registerSignedWebhook('required');
    if ('reason' in sub) throw new Error(req(R_DEAD_LETTER, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
    const body = JSON.stringify({ conformance: 'dead-letter' });
    const bad = await signedIngest(sub, body, { signature: BAD_SIGNATURE });
    expect(bad.status, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6', `a bad signature under required verification MUST answer 401 (got ${bad.status})`)).toBe(401);
    expect(bad.json?.runId, req(R_DEAD_LETTER, 'trigger-bridge.md §F.2', 'a required-verification failure MUST NOT start a run')).toBeUndefined();
    const read = await driver.get(`/v1/trigger-subscriptions/${encodeURIComponent(sub.subscriptionId)}`);
    const state = (read.json as { subscription?: { state?: unknown } } | undefined)?.subscription?.state;
    expect(state, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6 (RFC 0230 §C.1)', `a refused post MUST NOT change the subscription's state (got ${String(state)})`)).toBe('active');
    const ok = await signedIngest(sub, body);
    expect(ok.status, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6 (RFC 0230 §C.1)', `after a refused post the subscription MUST still deliver a correctly signed one (got ${ok.status})`)).toBe(202);
    notePaths(paths.seam, true);
  });

  it('refuses a webhook-timestamp more than 300 s off without starting a run', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    if (!(await inboundSigningAdvertised())) return softSkip('inapplicable', NO_SIGNING);
    const sub = await registerSignedWebhook('required');
    if ('reason' in sub) throw new Error(req(R_STALE_TIMESTAMP, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
    const body = JSON.stringify({ conformance: 'stale-timestamp' });
    const now = Math.floor(Date.now() / 1000);
    for (const [label, ts] of [['stale', now - SKEW_PROBE_SECONDS], ['future', now + SKEW_PROBE_SECONDS]] as const) {
      // Correctly signed over the skewed timestamp: only the skew can refuse it.
      const res = await signedIngest(sub, body, { timestamp: String(ts) });
      expect(res.status, req(R_STALE_TIMESTAMP, 'trigger-bridge.md §F.6', `a ${label} webhook-timestamp (${SKEW_PROBE_SECONDS} s off) under required verification MUST answer 401 (got ${res.status})`)).toBe(401);
      expect((res.json as { error?: unknown } | undefined)?.error, req(R_STALE_TIMESTAMP, 'trigger-bridge.md §F.6', `the ${label}-timestamp refusal MUST carry signature_invalid`)).toBe('signature_invalid');
      expect(res.json?.runId, req(R_STALE_TIMESTAMP, 'trigger-bridge.md §F.6', `a ${label}-timestamp post MUST NOT start a run`)).toBeUndefined();
    }
    const read = await driver.get(`/v1/trigger-subscriptions/${encodeURIComponent(sub.subscriptionId)}`);
    const state = (read.json as { subscription?: { state?: unknown } } | undefined)?.subscription?.state;
    expect(state, req(R_STALE_TIMESTAMP, 'trigger-bridge.md §F.6 (RFC 0230 §C.1)', `a skewed post MUST NOT change the subscription's state (read answered ${read.status}, state ${String(state)})`)).toBe('active');
    const ok = await signedIngest(sub, body);
    expect(ok.status, req(R_STALE_TIMESTAMP, 'trigger-bridge.md §F.6', `after the skewed posts the subscription MUST still deliver a current, correctly signed one (got ${ok.status})`)).toBe(202);
    notePaths(false, true);
  });

  it('returns the signing secret once: a re-read carries no whsec_ value', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    if (!(await inboundSigningAdvertised())) return softSkip('inapplicable', NO_SIGNING);
    const sub = await registerSignedWebhook('none');
    if ('reason' in sub) throw new Error(req(R_SECRET_ONCE, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
    const read = await driver.get(`/v1/trigger-subscriptions/${encodeURIComponent(sub.subscriptionId)}`);
    if (read.status === 404 || read.status === 405) {
      return softSkip('inapplicable', `the host serves no re-read of a trigger subscription (GET answered ${read.status}), so no re-read can return the secret`);
    }
    const keyBytes = sub.signingSecret.replace(/^whsec_/, '');
    expect(read.status, req(R_SECRET_ONCE, 'trigger-bridge.md §F.6', `the re-read of a subscription just registered MUST answer 200 when the host serves it (got ${read.status})`)).toBe(200);
    expect(hasSecretKey(read.json), req(R_SECRET_ONCE, 'trigger-bridge.md §F.6 (SR-1)', 'a re-read MUST NOT carry signingSecret')).toBe(false);
    expect(read.text.includes(sub.signingSecret) || (keyBytes.length >= 8 && read.text.includes(keyBytes)), req(R_SECRET_ONCE, 'trigger-bridge.md §F.6 (SR-1)', 'a re-read MUST NOT carry the secret\'s value')).toBe(false);
    expect(read.text.includes('whsec_'), req(R_SECRET_ONCE, 'trigger-bridge.md §F.6 (SR-1)', 'a re-read MUST NOT carry any whsec_ secret')).toBe(false);
    notePaths(false, true);
  });

  it('links delivery→run causation on run.started', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const paths = await witnessPaths();
    if (!paths.seam && !paths.normative) return seamAbsent(NO_PATH);

    if (paths.seam && (await causationViaSeam()) === 'absent') return seamAbsent(SEAM_UNWIRED);
    if (!paths.normative) return notePaths(true, false);

    // Normative-surface path: a signed delivery, then the run's own event log.
    const sub = await registerSignedWebhook('none');
    if ('reason' in sub) throw new Error(req(R_CAUSATION, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
    const res = await signedIngest(sub, JSON.stringify({ conformance: 'causation' }));
    expect(res.status, req(R_CAUSATION, 'trigger-bridge.md §F.6', `a signed delivery MUST answer 202 (got ${res.status})`)).toBe(202);
    const runId = res.json?.runId;
    expect(typeof runId === 'string' && runId.length > 0, req(R_CAUSATION, 'trigger-bridge.md §F.6', 'a 202 MUST carry the started runId')).toBe(true);
    const poll = await driver.get(`/v1/runs/${encodeURIComponent(bareRunId(String(runId)))}/events/poll`);
    const events = ((poll.json as { events?: Array<Record<string, unknown>> } | undefined)?.events ?? []);
    const started = events.find((e) => e.type === 'run.started');
    expect(started !== undefined, req(R_CAUSATION, 'trigger-bridge.md §C', `a delivered run MUST emit run.started (poll answered ${poll.status}; saw ${events.map((e) => e.type).join(',') || 'none'})`)).toBe(true);
    const causationId = started?.causationId;
    expect(typeof causationId === 'string' && causationId.length > 0, req(R_CAUSATION, 'trigger-bridge.md §C / RFC 0040', 'run.started MUST carry the delivery id as causationId')).toBe(true);
    const deliveredEvent = events.find((e) => e.type === 'trigger.delivery.attempted' && (e.payload as Record<string, unknown> | undefined)?.outcome === 'delivered');
    if (deliveredEvent !== undefined) {
      expect(causationId, req(R_CAUSATION, 'trigger-bridge.md §C / RFC 0040', 'run.started.causationId MUST EQUAL the delivered attempt event id')).toBe(deliveredEvent.eventId);
      expectContentFree(R_CAUSATION, (deliveredEvent.payload ?? {}) as Record<string, unknown>, 'trigger.delivery.attempted');
    }
    notePaths(paths.seam, true, deliveredEvent === undefined ? '; on the normative-surface path the delivered attempt event is not on the run log, so equality was not checked there' : '');
  });

  it('keeps a dead-lettered run-less attempt content-free', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const seam = await isEventLogSeamAvailable();
    const disco = await driver.get('/.well-known/openwop');
    const facet = disco.status === 200 ? deadLetterFacet(disco.json) : null;
    const normative = facet !== null && (await inboundSigningAdvertised());
    if (!seam && !normative) return seamAbsent('a dead-lettered attempt is on no run\'s log; it is readable through the event-log seam or the RFC 0232 read (triggerBridge.deadLetter with inboundSigning), and the host offers neither');

    if (seam) {
      const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
      if (exhaust === null) return seamAbsent(SEAM_UNWIRED);
      const exKey = exhaust.runId ?? '__exhaust__';
      const attempts = requireEvents(await queryTestEvents(exKey, { type: 'trigger.delivery.attempted' }), 'trigger.delivery.attempted (exhaust)');
      for (const e of attempts) expectContentFree(R_RUNLESS_ATTEMPT, e.payload, 'trigger.delivery.attempted');
      await resetTestSeam();
    }
    if (!normative) return notePaths(true, false);

    // Normative-surface path (RFC 0232 §E): cause a dead letter unaided, then read it.
    const sub = await registerSignedWebhook('required');
    if ('reason' in sub) throw new Error(req(R_RUNLESS_ATTEMPT, 'trigger-bridge.md §F.6', `an inboundSigning host MUST return the §B binding on webhook registration: ${sub.reason}`));
    const canary = freshCanary();
    const bad = await signedIngest(sub, JSON.stringify({ conformance: 'runless-attempt', canary }), { signature: BAD_SIGNATURE });
    expect(bad.status, req(R_RUNLESS_ATTEMPT, 'trigger-bridge.md §F.6', `a bad signature under required verification MUST answer 401 (got ${bad.status})`)).toBe(401);
    const read = await readDeadLetters(sub.subscriptionId);
    for (const f of judgeDeadLetters(read, { subscriptionId: sub.subscriptionId, canary, signature: BAD_SIGNATURE, signingSecret: sub.signingSecret, retentionDays: facet!.retentionDays })) {
      expect(f.ok, req(R_RUNLESS_ATTEMPT, 'trigger-bridge.md §C (RFC 0232 §B–§C)', f.message)).toBe(true);
    }
    notePaths(seam, true, ' (RFC 0232 dead-letter read)');
  });

  it('keeps a run-less subscription state change content-free', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    // Seam-only. No wire surface causes a subscription state change: a refused
    // post MUST NOT change state, retry exhaustion needs a delivery the host
    // fails repeatedly, and nothing pauses a subscription (RFC 0232 G2). On a
    // host without the seam no party can cause the condition, so the row is
    // `inapplicable`, not a defect (RFC 0232 Unresolved question 1, decided (a)).
    if (!(await isEventLogSeamAvailable())) {
      return softSkip('inapplicable', 'no wire surface causes a trigger subscription state change on a host without the event-log seam (RFC 0232 §E, gap G2)');
    }
    const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
    if (exhaust === null) return seamAbsent(SEAM_UNWIRED);
    const exKey = exhaust.runId ?? '__exhaust__';
    const changes = requireEvents(await queryTestEvents(exKey, { type: 'trigger.subscription.state.changed' }), 'trigger.subscription.state.changed (exhaust)');
    expect(changes.length >= 1, req(R_RUNLESS_STATE, 'trigger-bridge.md §B', 'exhaustion MUST record ≥1 trigger.subscription.state.changed')).toBe(true);
    for (const e of changes) expectContentFree(R_RUNLESS_STATE, e.payload, 'trigger.subscription.state.changed');
    await resetTestSeam();
  });
});
