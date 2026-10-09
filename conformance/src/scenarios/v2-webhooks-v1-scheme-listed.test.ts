/**
 * RFC 0176 §D.2 — the webhooks facet lists scheme `v1` (suite 2.45.30, target
 * major 2; gated on `webhooks`).
 *
 * The facet's `signatureAlgorithms[]` MUST list `"v1"`: the cut adds no
 * signature scheme, so a v1-signed delivery is verified under it
 * (`spec/v2/core/webhooks.md` §Surfaces). Until 2.45.30 this was the first leg
 * of `v2-v1-signed-webhook-accepted`, a floor of `openwop-conformance-seams-v2`,
 * and its pass certified that profile on hosts that mount no seams.
 *
 * @see spec/v2/core/webhooks.md §Surfaces
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('RFC 0176 §D.2 — the webhooks facet lists scheme v1 (gated on webhooks)', () => {
  it('the webhooks facet lists scheme "v1" — the scheme a v1-signed delivery is verified under', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const webhooks = await gateFamily('webhooks');
    if (!webhooks) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const algorithms = webhooks['signatureAlgorithms'];
    expect(Array.isArray(algorithms), req('openwop.requirement.0176.v1-signed-webhook-accepted.facet', 'spec/v2/core/webhooks.md §Surfaces', 'the webhooks facet is { signatureAlgorithms[] }')).toBe(true);
    expect(algorithms, req('openwop.requirement.0176.v1-signed-webhook-accepted.facet', 'spec/v2/core/webhooks.md §Surfaces', 'signatureAlgorithms MUST list "v1" — the cut adds no signature scheme (RFC 0176 §D.2)')).toContain('v1');
  });
});
