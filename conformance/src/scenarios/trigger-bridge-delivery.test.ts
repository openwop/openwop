/**
 * Durable trigger bridge — delivery model (RFC 0083 §C) — behavioral.
 *
 * Profile-gated on `openwop-trigger-bridge` (derived from the live discovery
 * doc per RFC 0083 §D). Soft-skips when the profile isn't derived / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives
 * in `trigger-bridge-shape.test.ts`.
 *
 * Four legs, each its own requirement (RFC 0230 split the one combined `it`):
 *
 *   1. DEDUP (§C-1) — a repeated delivery is effectively-once.
 *   2. DEAD-LETTER (§C-2 + RFC 0053) — an exhausted/refused delivery starts no run.
 *   3. CAUSATION (§C / RFC 0040) — a delivered run carries the delivery as
 *      `run.started.causationId`.
 *   4. RUN-LESS CONTENT-FREENESS (SR-1) — the run-less `trigger.*` events
 *      (a dead-lettered attempt, `trigger.subscription.state.changed`) carry no
 *      inbound content.
 *
 * TWO WITNESS PATHS. The SEAM path (primary, whenever the host serves them)
 * drives `POST /v1/host/sample/trigger-bridge/deliver` and reads the test
 * event-log seam. When the seams are absent — as they are on every production
 * host — legs 1–3 run the NORMATIVE-SURFACE path of RFC 0230 if the host
 * advertises `triggerBridge.ingestion.inboundSigning: ["standard-webhooks-1"]`:
 * register a webhook subscription and POST Standard-Webhooks-signed bodies to its
 * `ingestUrl` with no OpenWOP credential. Each row notes which path ran
 * (`observed:`). Leg 4 has no normative-surface path — the run-less events are
 * on no run's log — so it stays seam-witnessed and records seam-absent
 * otherwise; it remains in the floor (the floor never narrows).
 *
 * Spec references:
 *   - spec/v1/trigger-bridge.md (§C, §F.2, §F.6)
 *   - RFCS/0083-durable-trigger-and-channel-bridge-profile.md, RFCS/0230-inbound-webhook-ingest-contract.md
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
  inboundSigningAdvertised,
  registerSignedWebhook,
  signedIngest,
  freshWebhookId,
} from '../lib/triggerBridge.js';
import { queryTestEvents, requireEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { noteObservation } from '../lib/row-observation.js';
import { driver } from '../lib/driver.js';

const R_DEDUP = 'openwop.requirement.0083.trigger-delivery.dedup';
const R_DEAD_LETTER = 'openwop.requirement.0083.trigger-delivery.dead-letter';
const R_CAUSATION = 'openwop.requirement.0083.trigger-delivery.causation';
const R_RUNLESS = 'openwop.requirement.0083.trigger-delivery.runless-content-free';

const CONTENT_FREE_FORBIDDEN = ['body', 'headers', 'payload', 'secret', 'credentials', 'token', 'apiKey'];

function expectContentFree(id: string, payload: Record<string, unknown>, where: string): void {
  for (const f of CONTENT_FREE_FORBIDDEN) {
    expect(!(f in payload), req(id, 'RFC 0083 §C (SR-1)', `${where} MUST be content-free (no ${f})`)).toBe(true);
  }
}

type Path = 'seam' | 'normative' | null;

/** Which witness path this host supports: the seams when present, else RFC 0230's. */
async function witnessPath(): Promise<Path> {
  if (await isEventLogSeamAvailable()) return 'seam';
  if (await inboundSigningAdvertised()) return 'normative';
  return null;
}

const NO_PATH = 'host advertises openwop-trigger-bridge but neither the event-log seam nor an RFC 0230 inboundSigning ingest is available';

/** The bare opaque id of a (possibly tenant-bound) runId — the v1 read path. */
function bareRunId(runId: string): string {
  return runId.includes('/') ? runId.slice(runId.lastIndexOf('/') + 1) : runId;
}

describe('trigger-bridge-delivery (RFC 0083 §C)', () => {
  it('de-dups by dedupKey: a repeated delivery is effectively-once', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const path = await witnessPath();
    if (path === null) return seamAbsent(NO_PATH);

    if (path === 'seam') {
      const dedup = await driveDelivery({ scenario: 'dedup', dedupKey: 'conformance-dedup-key', source: 'queue' });
      if (dedup === null) return seamAbsent('host advertises openwop-trigger-bridge but the delivery seam is unwired');
      const dedupEvents = requireEvents(
        await queryTestEvents(dedup.runId ?? '__dedup__', { type: 'trigger.delivery.attempted' }),
        'trigger.delivery.attempted (dedup)',
      );
      const deliveredForKey = dedupEvents.filter((e) => e.payload.dedupKey === 'conformance-dedup-key' && e.payload.outcome === 'delivered');
      expect(deliveredForKey.length === 1, req(R_DEDUP, 'trigger-bridge.md §C-1', 'a repeated dedupKey MUST be effectively-once — EXACTLY one delivered attempt (not zero, not two)')).toBe(true);
      for (const e of dedupEvents) {
        expect(typeof e.payload.outcome === 'string' && DELIVERY_OUTCOMES.includes(e.payload.outcome as string), req(R_DEDUP, 'run-event-payloads.schema.json#triggerDeliveryAttempted', 'outcome MUST be delivered|retrying|dead-lettered')).toBe(true);
        expectContentFree(R_DEDUP, e.payload, 'trigger.delivery.attempted');
      }
      noteObservation('seam path');
      await resetTestSeam();
      return;
    }

    // Normative-surface path (RFC 0230 §C Identity + §D).
    const sub = await registerSignedWebhook('none');
    expect('reason' in sub ? sub.reason : null, req(R_DEDUP, 'trigger-bridge.md §F.6', 'an inboundSigning host MUST return the §B binding on webhook registration')).toBeNull();
    if ('reason' in sub) return;
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
    noteObservation('normative-surface path (RFC 0230)');
  });

  it('dead-letters an exhausted or refused delivery without starting a run', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const path = await witnessPath();
    if (path === null) return seamAbsent(NO_PATH);

    if (path === 'seam') {
      const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
      if (exhaust === null) return seamAbsent('host advertises openwop-trigger-bridge but the delivery seam is unwired');
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
      noteObservation('seam path');
      await resetTestSeam();
      return;
    }

    // Normative-surface path (RFC 0230 §C Verification + §C.1).
    const sub = await registerSignedWebhook('required');
    expect('reason' in sub ? sub.reason : null, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6', 'an inboundSigning host MUST return the §B binding on webhook registration')).toBeNull();
    if ('reason' in sub) return;
    const body = JSON.stringify({ conformance: 'dead-letter' });
    const bad = await signedIngest(sub, body, { signature: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    expect(bad.status, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6', `a bad signature under required verification MUST answer 401 (got ${bad.status})`)).toBe(401);
    expect(bad.json?.runId, req(R_DEAD_LETTER, 'trigger-bridge.md §F.2', 'a required-verification failure MUST NOT start a run')).toBeUndefined();
    const read = await driver.get(`/v1/trigger-subscriptions/${encodeURIComponent(sub.subscriptionId)}`);
    const state = (read.json as { subscription?: { state?: unknown } } | undefined)?.subscription?.state;
    expect(state, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6 (RFC 0230 §C.1)', `a refused post MUST NOT change the subscription's state (got ${String(state)})`)).toBe('active');
    const ok = await signedIngest(sub, body);
    expect(ok.status, req(R_DEAD_LETTER, 'trigger-bridge.md §F.6 (RFC 0230 §C.1)', `after a refused post the subscription MUST still deliver a correctly signed one (got ${ok.status})`)).toBe(202);
    noteObservation('normative-surface path (RFC 0230)');
  });

  it('links delivery→run causation on run.started', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const path = await witnessPath();
    if (path === null) return seamAbsent(NO_PATH);

    if (path === 'seam') {
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
      noteObservation('seam path');
      await resetTestSeam();
      return;
    }

    // Normative-surface path: a signed delivery, then the run's own event log.
    const sub = await registerSignedWebhook('none');
    expect('reason' in sub ? sub.reason : null, req(R_CAUSATION, 'trigger-bridge.md §F.6', 'an inboundSigning host MUST return the §B binding on webhook registration')).toBeNull();
    if ('reason' in sub) return;
    const res = await signedIngest(sub, JSON.stringify({ conformance: 'causation' }));
    expect(res.status, req(R_CAUSATION, 'trigger-bridge.md §F.6', `a signed delivery MUST answer 202 (got ${res.status})`)).toBe(202);
    const runId = res.json?.runId;
    if (typeof runId !== 'string' || runId.length === 0) return softSkip('blocked', 'the 202 carried no runId to read the run from');
    const poll = await driver.get(`/v1/runs/${encodeURIComponent(bareRunId(runId))}/events/poll`);
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
    noteObservation(`normative-surface path (RFC 0230)${deliveredEvent === undefined ? '; the delivered attempt event is not on the run log, so equality was not checked' : ''}`);
  });

  it('keeps the run-less trigger events content-free', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    // No normative-surface path: a dead-lettered attempt and a state change are
    // on no run's log, so only the seam can read them (RFC 0230 §Conformance).
    if (!(await isEventLogSeamAvailable())) return seamAbsent('the run-less trigger events are readable only through the event-log seam, which is absent');
    const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
    if (exhaust === null) return seamAbsent('host advertises openwop-trigger-bridge but the delivery seam is unwired');
    const exKey = exhaust.runId ?? '__exhaust__';
    for (const type of ['trigger.delivery.attempted', 'trigger.subscription.state.changed'] as const) {
      for (const e of requireEvents(await queryTestEvents(exKey, { type }), `${type} (exhaust)`)) expectContentFree(R_RUNLESS, e.payload, type);
    }
    await resetTestSeam();
  });
});
