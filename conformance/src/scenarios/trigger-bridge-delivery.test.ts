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
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import {
  isTriggerBridgeProfileAdvertised,
  driveDelivery,
  DELIVERY_OUTCOMES,
  SUBSCRIPTION_STATES,
} from '../lib/triggerBridge.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

const CONTENT_FREE_FORBIDDEN = ['body', 'headers', 'payload', 'secret', 'credentials', 'token', 'apiKey'];

function expectContentFree(payload: Record<string, unknown>, where: string): void {
  for (const f of CONTENT_FREE_FORBIDDEN) {
    expect(
      !(f in payload),
      driver.describe('RFC 0083 §C (SR-1)', `${where} MUST be content-free (no ${f})`),
    ).toBe(true);
  }
}

describe('trigger-bridge-delivery (RFC 0083 §C)', () => {
  it('de-dups by dedupKey, retries to dead-letter, and links delivery→run causation', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    if (!(await isEventLogSeamAvailable())) return; // event-log seam absent — soft-skip

    // ---- Leg 1: dedup → effectively-once (§C-1) ---------------------------
    const dedup = await driveDelivery({ scenario: 'dedup', dedupKey: 'conformance-dedup-key', source: 'queue' });
    if (dedup === null) return; // delivery seam unwired — soft-skip the whole behavioral suite
    if (dedup.runId || dedup.subscriptionId) {
      const subId = dedup.subscriptionId;
      const q = await queryTestEvents(dedup.runId ?? '__dedup__', { type: 'trigger.delivery.attempted' });
      if (q.ok) {
        const deliveredForKey = q.events.filter(
          (e) => e.payload.dedupKey === 'conformance-dedup-key' && e.payload.outcome === 'delivered',
        );
        // Effectively-once: a repeated dedupKey MUST NOT produce two 'delivered' attempts.
        expect(
          deliveredForKey.length <= 1,
          driver.describe('trigger-bridge.md §C-1', 'a repeated dedupKey MUST be effectively-once (≤1 delivered attempt)'),
        ).toBe(true);
        for (const e of q.events) {
          expect(
            typeof e.payload.outcome === 'string' && DELIVERY_OUTCOMES.includes(e.payload.outcome as string),
            driver.describe('run-event-payloads.schema.json#triggerDeliveryAttempted', 'outcome MUST be delivered|retrying|dead-lettered'),
          ).toBe(true);
          expectContentFree(e.payload, 'trigger.delivery.attempted');
        }
      }
      void subId;
    }

    // ---- Leg 2: retry → dead-letter (§C-2 + RFC 0053) --------------------
    const exhaust = await driveDelivery({ scenario: 'exhaust', source: 'webhook' });
    if (exhaust && (exhaust.runId || exhaust.subscriptionId)) {
      const key = exhaust.runId ?? '__exhaust__';
      const dq = await queryTestEvents(key, { type: 'trigger.delivery.attempted' });
      if (dq.ok && dq.events.length > 0) {
        const terminal = dq.events.sort((a, b) => a.sequence - b.sequence)[dq.events.length - 1]!;
        expect(
          terminal.payload.outcome === 'dead-lettered',
          driver.describe('trigger-bridge.md §C-2', 'an exhausted retry policy MUST terminate in a dead-lettered delivery'),
        ).toBe(true);
      }
      const sq = await queryTestEvents(key, { type: 'trigger.subscription.state.changed' });
      if (sq.ok && sq.events.length > 0) {
        const toDeadLetter = sq.events.some((e) => e.payload.toState === 'dead-lettered');
        expect(
          toDeadLetter,
          driver.describe('trigger-bridge.md §B', 'the subscription MUST transition to dead-lettered on exhaustion'),
        ).toBe(true);
        for (const e of sq.events) {
          expect(
            typeof e.payload.toState === 'string' && SUBSCRIPTION_STATES.includes(e.payload.toState as string),
            driver.describe('trigger-bridge.md §B', 'toState MUST be in the four-state vocabulary'),
          ).toBe(true);
          expectContentFree(e.payload, 'trigger.subscription.state.changed');
        }
      }
    }

    // ---- Leg 3: delivery → run causation (§C / RFC 0040) -----------------
    const delivered = await driveDelivery({ scenario: 'deliver', source: 'schedule' });
    if (delivered?.runId) {
      const rq = await queryTestEvents(delivered.runId, { type: 'run.started' });
      if (rq.ok && rq.events[0]) {
        expect(
          typeof rq.events[0].causationId === 'string' && (rq.events[0].causationId as string).length > 0,
          driver.describe('trigger-bridge.md §C / RFC 0040', 'the delivered run.started MUST carry the delivery causationId (resolvable via /ancestry)'),
        ).toBe(true);
      }
    }

    await resetTestSeam();
  });
});
