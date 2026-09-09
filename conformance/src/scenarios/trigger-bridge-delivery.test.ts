/**
 * Durable trigger bridge — delivery model (RFC 0083 §C) — behavioral.
 *
 * Profile-gated on `openwop-trigger-bridge` (derived from the live discovery
 * doc per RFC 0083 §D: the bridge advertised + a dead-letter sink + a durable
 * source). Soft-skips when the profile isn't derived (default) / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage
 * lives in `trigger-bridge-shape.test.ts`; this asserts host BEHAVIOR via the
 * `POST /v1/host/sample/trigger-bridge/deliver` seam + the test event-log seam:
 *
 *   1. DEDUP (§C-1) — the same `dedupKey` delivered twice is effectively-once:
 *      exactly one `trigger.delivery.attempted { outcome:"delivered" }` for that
 *      key (at-least-once collapses to once within the retention window).
 *   2. RETRY → DEAD-LETTER (§C-2 + RFC 0053) — an exhausted retry policy lands a
 *      terminal `trigger.delivery.attempted { outcome:"dead-lettered" }` and a
 *      `trigger.subscription.state.changed { toState:"dead-lettered" }`; both
 *      content-free (SR-1: ids/states/counters only).
 *   3. CAUSATION (§C / RFC 0040) — a successful delivery's resulting run carries
 *      `run.started.causationId` == the delivery id (trigger → run is resolvable
 *      via `/ancestry`).
 *
 * Each leg soft-skips independently (seam absent / event-log seam absent).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/trigger-bridge.md (§C)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0083-durable-trigger-and-channel-bridge-profile.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/profiles.md (§openwop-trigger-bridge)
 */

import { describe, it, expect } from 'vitest';
import { seamAbsent } from '../lib/soft-skip.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import {
  isTriggerBridgeProfileAdvertised,
  driveDelivery,
  DELIVERY_OUTCOMES,
  SUBSCRIPTION_STATES,
} from '../lib/triggerBridge.js';
import { queryTestEvents, requireEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';

const CONTENT_FREE_FORBIDDEN = ['body', 'headers', 'payload', 'secret', 'credentials', 'token', 'apiKey'];

function expectContentFree(payload: Record<string, unknown>, where: string): void {
  for (const f of CONTENT_FREE_FORBIDDEN) {
    expect(
      !(f in payload),
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'RFC 0083 §C (SR-1)', `${where} MUST be content-free (no ${f})`),
    ).toBe(true);
  }
}

describe('trigger-bridge-delivery (RFC 0083 §C)', () => {
  it('de-dups by dedupKey, retries to dead-letter, and links delivery→run causation', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    if (!(await isEventLogSeamAvailable())) return seamAbsent('host advertises openwop-trigger-bridge but the event-log seam is absent');

    // ---- Leg 1: dedup → effectively-once (§C-1) ---------------------------
    const dedup = await driveDelivery({ scenario: 'dedup', dedupKey: 'conformance-dedup-key', source: 'queue' });
    if (dedup === null) return seamAbsent('host advertises openwop-trigger-bridge but the delivery seam is unwired');

    // The profile is derived AND the seam is wired — missing evidence is a
    // FAILURE, not a soft-skip. A repeated dedupKey MUST be effectively-once:
    // EXACTLY one delivered attempt for the key (zero would mean no delivery at all).
    const dedupQueryId = dedup.runId ?? '__dedup__';
    const dedupEvents = requireEvents(
      await queryTestEvents(dedupQueryId, { type: 'trigger.delivery.attempted' }),
      'trigger.delivery.attempted (dedup)',
    );
    const deliveredForKey = dedupEvents.filter(
      (e) => e.payload.dedupKey === 'conformance-dedup-key' && e.payload.outcome === 'delivered',
    );
    expect(
      deliveredForKey.length === 1,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C-1', 'a repeated dedupKey MUST be effectively-once — EXACTLY one delivered attempt (not zero, not two)'),
    ).toBe(true);
    for (const e of dedupEvents) {
      expect(
        typeof e.payload.outcome === 'string' && DELIVERY_OUTCOMES.includes(e.payload.outcome as string),
        req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'run-event-payloads.schema.json#triggerDeliveryAttempted', 'outcome MUST be delivered|retrying|dead-lettered'),
      ).toBe(true);
      expectContentFree(e.payload, 'trigger.delivery.attempted');
    }

    // ---- Leg 2: retry → dead-letter (§C-2 + RFC 0053) --------------------
    const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
    expect(
      exhaust !== null,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C-2', 'the exhaust scenario MUST be wired when the delivery seam is'),
    ).toBe(true);
    const exKey = exhaust!.runId ?? '__exhaust__';
    const exhaustEvents = requireEvents(
      await queryTestEvents(exKey, { type: 'trigger.delivery.attempted' }),
      'trigger.delivery.attempted (exhaust)',
    );
    expect(
      exhaustEvents.length >= 1,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C-2', 'an exhausted delivery MUST emit ≥1 trigger.delivery.attempted'),
    ).toBe(true);
    const terminal = exhaustEvents.sort((a, b) => a.sequence - b.sequence)[exhaustEvents.length - 1]!;
    expect(
      terminal.payload.outcome === 'dead-lettered',
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C-2', 'an exhausted retry policy MUST terminate in a dead-lettered delivery'),
    ).toBe(true);
    const stateEvents = requireEvents(
      await queryTestEvents(exKey, { type: 'trigger.subscription.state.changed' }),
      'trigger.subscription.state.changed (exhaust)',
    );
    expect(
      stateEvents.length >= 1,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §B', 'exhaustion MUST emit ≥1 trigger.subscription.state.changed'),
    ).toBe(true);
    expect(
      stateEvents.some((e) => e.payload.toState === 'dead-lettered'),
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §B', 'the subscription MUST transition to dead-lettered on exhaustion'),
    ).toBe(true);
    for (const e of stateEvents) {
      expect(
        typeof e.payload.toState === 'string' && SUBSCRIPTION_STATES.includes(e.payload.toState as string),
        req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §B', 'toState MUST be in the four-state vocabulary'),
      ).toBe(true);
      expectContentFree(e.payload, 'trigger.subscription.state.changed');
    }

    // ---- Leg 3: delivery → run causation (§C / RFC 0040) -----------------
    // §C: "the run started by a successful delivery MUST carry the delivery's
    // id as causationId on its run.started." The delivery's id is the
    // trigger.delivery.attempted{delivered} event's id, so we assert EQUALITY
    // (not merely "a causation id exists") — the trigger→run link MUST resolve.
    const delivered = await driveDelivery({ scenario: 'deliver', source: 'schedule' });
    expect(
      delivered !== null && typeof delivered.runId === 'string' && (delivered.runId as string).length > 0,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C', 'a successful delivery MUST create a run'),
    ).toBe(true);
    const deliveredRunId = delivered!.runId as string;
    const attemptEvents = requireEvents(
      await queryTestEvents(deliveredRunId, { type: 'trigger.delivery.attempted' }),
      'trigger.delivery.attempted (deliver)',
    );
    const deliveredEvent = attemptEvents.find((e) => e.payload.outcome === 'delivered');
    expect(
      deliveredEvent !== undefined,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C-1', 'a successful delivery MUST emit a trigger.delivery.attempted{outcome:delivered}'),
    ).toBe(true);
    const runStartedEvents = requireEvents(
      await queryTestEvents(deliveredRunId, { type: 'run.started' }),
      'run.started (deliver)',
    );
    expect(
      runStartedEvents.length >= 1,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C', 'a delivered run MUST emit run.started'),
    ).toBe(true);
    const runStarted = runStartedEvents.sort((a, b) => a.sequence - b.sequence)[0]!;
    expect(
      typeof runStarted.causationId === 'string' &&
        (runStarted.causationId as string).length > 0 &&
        runStarted.causationId === deliveredEvent!.eventId,
      req('openwop.it.trigger-bridge-delivery.de-dups-by-dedupkey-retries-to-dead-letter-and-links-delivery-run-causation', 'trigger-bridge.md §C / RFC 0040', 'run.started.causationId MUST EQUAL the delivery id (the trigger.delivery.attempted{delivered} eventId) — resolvable via /ancestry'),
    ).toBe(true);

    await resetTestSeam();
  });
});
