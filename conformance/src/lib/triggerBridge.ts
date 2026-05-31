/**
 * Shared helpers for the RFC 0083 `triggerBridge` conformance scenario.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/triggerBridge.js`.
 *
 * Two surfaces:
 *   - the NORMATIVE read (`GET /v1/trigger-subscriptions[/{subscriptionId}]`,
 *     RFC 0083 §A), exercised black-box; and
 *   - the host-sample delivery seam (`POST /v1/host/sample/trigger-bridge/deliver`),
 *     used to drive the §C delivery model (dedup → retry → dead-letter →
 *     causation) so the two `trigger.*` events can be asserted against the test
 *     event-log seam. The seam is OPTIONAL — scenarios soft-skip on 404/405
 *     (reference durable-delivery is deferred per RFC 0083 §Conformance).
 *
 * Gating uses the `openwop-trigger-bridge` PROFILE derived from the live
 * discovery doc (the bridge + a dead-letter sink + a durable source, §D), not a
 * bare capability flag.
 *
 * @see RFCS/0083-durable-trigger-and-channel-bridge-profile.md
 * @see spec/v1/trigger-bridge.md
 * @see spec/v1/profiles.md (§openwop-trigger-bridge)
 */
import { driver } from './driver.js';
import { deriveProfiles, type DiscoveryPayload } from './profiles.js';

/** True when the live host's discovery derives the `openwop-trigger-bridge`
 *  profile (RFC 0083 §D predicate: bridge advertised + dead-letter sink + a
 *  durable source). */
export async function isTriggerBridgeProfileAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  if (disco.status !== 200 || !disco.json) return false;
  return deriveProfiles(disco.json as DiscoveryPayload).includes('openwop-trigger-bridge');
}

export interface TriggerSubscription {
  subscriptionId?: string;
  source?: string;
  state?: string;
  [k: string]: unknown;
}

/** GET the NORMATIVE subscription read surface (RFC 0083 §A
 *  `GET /v1/trigger-subscriptions`); null when not served (404/405/501). */
export async function listTriggerSubscriptions(): Promise<{ subscriptions?: TriggerSubscription[] } | null> {
  const res = await driver.get('/v1/trigger-subscriptions');
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  return (res.json as { subscriptions?: TriggerSubscription[] } | undefined) ?? {};
}

export interface DeliveryResult {
  runId?: string;
  subscriptionId?: string;
  outcome?: string;
  deliveredCount?: number;
}

/**
 * Drive one delivery through the host-sample bridge seam. `scenario`:
 *   - `dedup`     — deliver the same `dedupKey` twice; effectively-once (§C-1).
 *   - `exhaust`   — exhaust the retry policy → `dead-lettered` (§C-2 + RFC 0053).
 *   - `deliver`   — a single successful delivery whose run's `run.started`
 *                   carries the delivery `causationId` (§C / RFC 0040).
 * Returns null when the seam is unwired (404/405).
 */
export async function driveDelivery(
  body: { scenario: 'dedup' | 'exhaust' | 'deliver'; dedupKey?: string; source?: string },
): Promise<DeliveryResult | null> {
  const res = await driver.post('/v1/host/sample/trigger-bridge/deliver', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as DeliveryResult | undefined) ?? {};
}

export const SUBSCRIPTION_STATES = ['active', 'paused', 'failed', 'dead-lettered'];
export const DELIVERY_OUTCOMES = ['delivered', 'retrying', 'dead-lettered'];
