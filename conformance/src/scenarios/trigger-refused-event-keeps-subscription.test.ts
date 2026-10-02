/**
 * A refused inbound event dead-letters only its delivery — `trigger-bridge.md`
 * §F.2, corrected 2026-09-30 (`docs/COMPATIBILITY-CORRECTIONS-LOG.md`).
 *
 * §F.2 used to send an event failing a `required` verification to
 * `trigger.subscription.state.changed.reason: 'signature-invalid'`, a
 * SUBSCRIPTION transition. Anyone able to post one badly signed event could
 * then disable a working integration: every later delivery is refused as
 * `subscription_not_active`. RFC 0230 §C.1 closed that for the uncredentialed
 * Standard Webhooks ingest; the correction states it for every host.
 *
 * Driven through the delivery seam's OPTIONAL `scenario: "refused"` value
 * (`host-sample-test-seams.md`, trigger-bridge delivery seam), then the
 * `deliver` value on the same `subscriptionId`. Three observations, each of
 * which a host implementing the old subscription-level transition fails:
 *
 *   1. the refused event is recorded as a dead-lettered
 *      `trigger.delivery.attempted` and starts no run;
 *   2. no `trigger.subscription.state.changed` is emitted for the subscription,
 *      and it reads back `active` (seam response, and the normative
 *      `GET /v1/trigger-subscriptions/{id}` when the host serves it);
 *   3. a verified event on the same subscription is then delivered and starts
 *      a run.
 *
 * Gated on the `openwop-trigger-bridge` profile and on
 * `triggerBridge.ingestion.externalSources` listing `webhook`. The uncredentialed
 * public path (RFC 0230, `inboundSigning`) is witnessed separately, by the
 * dead-letter leg of `trigger-bridge-delivery`. A host with no seams that
 * advertises `inboundSigning` therefore records `inapplicable` here.
 *
 * @see spec/v1/trigger-bridge.md §F.2
 * @see spec/v2/core/webhooks.md §Inbound triggers
 * @see RFCS/0230-inbound-webhook-ingest-contract.md §C.1 (risk R3)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { seamAbsent, softSkip } from '../lib/soft-skip.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { inboundSigningAdvertised, isTriggerBridgeProfileAdvertised } from '../lib/triggerBridge.js';
import { queryTestEvents, requireEvents, isEventLogSeamAvailable } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';

const SEAM = '/v1/host/sample/trigger-bridge/deliver';
const ID = 'openwop.requirement.trigger-bridge.refused-event-keeps-subscription';
const SPEC = 'trigger-bridge.md §F.2 (corrected 2026-09-30)';

interface SeamResult {
  subscriptionId?: unknown;
  outcome?: unknown;
  subscriptionState?: unknown;
  runId?: unknown;
}

describe('trigger-refused-event-keeps-subscription (trigger-bridge.md §F.2)', () => {
  it('a refused event dead-letters only its delivery; the subscription stays active and a verified event then delivers', async () => {
    if (!behaviorGate('openwop-trigger-bridge', await isTriggerBridgeProfileAdvertised())) return;
    const tb = await readCapabilityFamily<{ ingestion?: { externalSources?: unknown } }>('triggerBridge');
    const sources = Array.isArray(tb?.ingestion?.externalSources) ? (tb!.ingestion!.externalSources as unknown[]) : [];
    if (!sources.includes('webhook')) {
      return softSkip('inapplicable', 'triggerBridge.ingestion.externalSources does not list webhook, so the host verifies no inbound webhook event');
    }
    if (!(await isEventLogSeamAvailable())) {
      // A host with no seams that serves RFC 0230's signed ingest is measured on this same rule
      // there: the dead-letter leg of `trigger-bridge-delivery` posts a badly signed event, reads the
      // subscription back `active`, and delivers a signed one (RFC 0230 §C.1). Until 2.45.8 this
      // file failed such a host in strict mode as "not observable" right after that leg observed it.
      if (await inboundSigningAdvertised()) return softSkip('inapplicable', 'no delivery seam on this host; the rule is witnessed on its signed public ingest by openwop.requirement.0083.trigger-delivery.dead-letter (RFC 0230 §C.1)');
      return seamAbsent('host ingests external webhooks but the event-log seam is absent');
    }

    // ---- 1. The refused event -------------------------------------------
    const refusedRes = await driver.post(SEAM, { scenario: 'refused', source: 'webhook' });
    if (refusedRes.status === 404 || refusedRes.status === 405) {
      return seamAbsent('host ingests external webhooks but the trigger-bridge delivery seam is unwired');
    }
    if (refusedRes.status === 400) {
      // Grace window (suite 2.45.3): the `refused` seam value is new in this cycle, so a
      // host whose existing delivery seam predates it records `inapplicable` with this
      // reason rather than `blocked` (which would deny its certification for a seam
      // extension it has not yet shipped). The disposition for an advertised facet whose
      // fixture or seam value is missing is pending a suite-wide policy decision.
      return softSkip('inapplicable', 'the trigger-bridge delivery seam predates scenario "refused" (answered 400); grace window for seams extended in 2.45.3');
    }
    expect(refusedRes.status, req(ID, 'host-sample-test-seams.md (trigger-bridge delivery seam)', 'scenario "refused" MUST answer 200')).toBe(200);
    const refused = (refusedRes.json ?? {}) as SeamResult;
    expect(
      typeof refused.subscriptionId === 'string' && refused.subscriptionId.length > 0,
      req(ID, 'host-sample-test-seams.md (trigger-bridge delivery seam)', 'scenario "refused" MUST return the subscriptionId it drove'),
    ).toBe(true);
    const subscriptionId = refused.subscriptionId as string;
    expect(
      refused.outcome,
      req(ID, SPEC, 'an event failing a required verification MUST NOT start a run; its delivery is dead-lettered'),
    ).toBe('dead-lettered');

    const logKey = typeof refused.runId === 'string' && refused.runId.length > 0 ? refused.runId : '__refused__';
    const attempts = requireEvents(await queryTestEvents(logKey, { type: 'trigger.delivery.attempted' }), 'trigger.delivery.attempted (refused)')
      .filter((e) => e.payload.subscriptionId === subscriptionId);
    expect(
      attempts.some((e) => e.payload.outcome === 'dead-lettered'),
      req(ID, SPEC, 'the refused delivery MUST be recorded as trigger.delivery.attempted { outcome: "dead-lettered" }'),
    ).toBe(true);
    expect(
      attempts.every((e) => e.payload.outcome !== 'delivered'),
      req(ID, SPEC, 'an event failing a required verification MUST NOT be delivered'),
    ).toBe(true);
    const started = requireEvents(await queryTestEvents(logKey, { type: 'run.started' }), 'run.started (refused)');
    expect(started.length, req(ID, SPEC, 'an event failing a required verification MUST NOT start a run')).toBe(0);

    // ---- 2. The subscription is untouched --------------------------------
    const transitions = requireEvents(await queryTestEvents(logKey, { type: 'trigger.subscription.state.changed' }), 'trigger.subscription.state.changed (refused)')
      .filter((e) => e.payload.subscriptionId === subscriptionId);
    expect(
      transitions.map((e) => `${String(e.payload.fromState)}->${String(e.payload.toState)} (${String(e.payload.reason)})`),
      req(ID, SPEC, 'a refused event MUST NOT emit trigger.subscription.state.changed — one bad post must not disable the integration'),
    ).toEqual([]);
    expect(
      refused.subscriptionState,
      req(ID, SPEC, 'a refused event MUST NOT change the subscription\'s state: it stays active'),
    ).toBe('active');
    const read = await driver.get(`/v1/trigger-subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (read.status === 200) {
      const body = read.json as { state?: unknown; subscription?: { state?: unknown } } | undefined;
      expect(
        body?.subscription?.state ?? body?.state,
        req(ID, SPEC, 'the normative subscription read MUST still show state active after a refused event'),
      ).toBe('active');
    }

    // ---- 3. A verified event on the same subscription is delivered -------
    const nextRes = await driver.post(SEAM, { scenario: 'deliver', source: 'webhook', subscriptionId });
    expect(nextRes.status, req(ID, 'host-sample-test-seams.md (trigger-bridge delivery seam)', 'scenario "deliver" with the refused subscriptionId MUST answer 200')).toBe(200);
    const next = (nextRes.json ?? {}) as SeamResult;
    expect(
      next.subscriptionId,
      req(ID, 'host-sample-test-seams.md (trigger-bridge delivery seam)', 'scenario "deliver" MUST deliver on the subscriptionId it was given'),
    ).toBe(subscriptionId);
    expect(
      typeof next.runId === 'string' && next.runId.length > 0,
      req(ID, SPEC, 'after a refused event, a verified event on the same subscription MUST start a run'),
    ).toBe(true);
    const delivered = requireEvents(await queryTestEvents(next.runId as string, { type: 'trigger.delivery.attempted' }), 'trigger.delivery.attempted (deliver after refused)');
    expect(
      delivered.some((e) => e.payload.subscriptionId === subscriptionId && e.payload.outcome === 'delivered'),
      req(ID, SPEC, 'after a refused event, the next verified delivery on the subscription MUST be recorded delivered'),
    ).toBe(true);
  });
});
