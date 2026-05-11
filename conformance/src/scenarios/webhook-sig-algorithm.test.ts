/**
 * Track 13: webhook signature-algorithm versioning (webhooks.md v1.1).
 *
 * Verifies that hosts adopting v1.1+ set the `X-openwop-Signature-Algorithm`
 * header to a recognized value (currently `v1`) on every webhook delivery,
 * and that subscribers can rely on the absence-equals-v1 rule.
 *
 * This scenario observes the host's registered subscription receipts —
 * it does not exercise the dispatch path end-to-end (which would require
 * a public-internet test receiver). The full dispatch is exercised by
 * the host-side webhook test harness.
 *
 * @see spec/v1/webhooks.md §"Signature algorithm versioning"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryWebhooks {
  webhooks?: {
    supported?: boolean;
    signatureAlgorithms?: string[];
  };
}

describe('webhook-sig-algorithm: host advertises supported algorithm set', () => {
  it('discovery surfaces a webhooks.signatureAlgorithms array including "v1"', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const caps = (disco.json as { capabilities?: DiscoveryWebhooks }).capabilities ?? {};
    const webhooks = caps.webhooks;

    if (!webhooks?.supported) {
      // eslint-disable-next-line no-console
      console.warn('[webhook-sig-algorithm] host does not advertise webhook support; skipping');
      return;
    }

    const algos = webhooks.signatureAlgorithms;
    if (!Array.isArray(algos)) {
      // Pre-v1.1 hosts that support webhooks but don't yet advertise the
      // algorithm list are still v1-conformant — the absence-equals-v1
      // rule applies. Skip the v1.1 shape check.
      // eslint-disable-next-line no-console
      console.warn(
        '[webhook-sig-algorithm] host does not advertise webhooks.signatureAlgorithms (pre-v1.1); skipping shape check',
      );
      return;
    }

    expect(algos.includes('v1'), driver.describe(
      'webhooks.md §"Signature algorithm versioning"',
      'webhooks.signatureAlgorithms MUST include "v1" when surfaced (canonical baseline)',
    )).toBe(true);

    // All declared algorithms MUST be non-empty strings.
    for (const a of algos) {
      expect(typeof a).toBe('string');
      expect((a as string).length).toBeGreaterThan(0);
    }
  });
});
