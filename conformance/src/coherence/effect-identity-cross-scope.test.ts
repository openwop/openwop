/**
 * RFC 0150 §B — Layer-2 identity is run-scoped, and the spec has to say what
 * that costs.
 *
 * `runId` is in the §B preimage. An effect issued outside any run has no
 * `runId`, so the two identities can never collide, and Layer 2 cannot
 * deduplicate an in-run effect against the same logical effect issued through
 * an operator route, an admin action, or a scheduled job.
 *
 * §"Why this exists" already says implementations "MUST support layer 2 for any
 * node executor that performs an external side effect", and §"Layer 2" opens
 * "Inside a workflow run…". A host reading those literally uses the §B form for
 * the node path — correctly. If that same effect is *also* reachable outside a
 * run, the two paths issue two effects for one logical operation, which is
 * precisely the duplicate-effect class §B exists to kill, on the highest-stakes
 * path it touches.
 *
 * Reported by a tier-1 host from a shipped node pack, not a thought experiment:
 * `feature.commerce.nodes.refund-order` calls the same `refundOrder` that an
 * HTTP route, a connect-admin route, and a seeder call. They key it on business
 * identity rather than the §B form *deliberately*, because run-scoped identity
 * is the wrong scope for that effect — and §B says as much about itself in the
 * fork note, one face of the same limitation.
 *
 * The corpus was silent on this. Silence here reads as "the ordinal form is
 * sufficient", which for a cross-entry-point effect is false.
 *
 * Server-free; reads the corpus, never a host.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

describe.skipIf(V1_DIR === null)('RFC 0150 §B — cross-scope effect identity', () => {
  const doc = V1_DIR === null ? '' : readFileSync(join(V1_DIR as string, 'idempotency.md'), 'utf8');
  const plain = doc.replace(/[`*_]/g, '').replace(/\s+/g, ' ');

  it('the Layer-2 section is found at all', () => {
    // Guard: an empty read makes every leg below vacuously true.
    expect(doc.length, req('openwop.it.effect-identity-cross-scope.the-layer-2-section-is-found-at-all', 'RFC 0150 §B', 'idempotency.md MUST be readable')).toBeGreaterThan(1000);
    expect(plain, req('openwop.it.effect-identity-cross-scope.the-layer-2-section-is-found-at-all', 'RFC 0150 §B', 'the Layer-2 section MUST exist')).toContain('Layer 2: Activity-level idempotency');
  });

  it('the spec states that Layer-2 identity is run-scoped', () => {
    expect(
      /run-scoped/.test(plain),
      req('openwop.it.effect-identity-cross-scope.the-spec-states-that-layer-2-identity-is-run-scoped', 'RFC 0150 §B', 'RFC 0150 §B: `runId` is in the preimage, so the identity is scoped to a run. Saying so ' +
        'explicitly is what makes the next requirement follow rather than look arbitrary.'),
    ).toBe(true);
  });

  it('the spec requires a business identity when the effect escapes the run', () => {
    expect(
      /reachable outside any run/.test(plain),
      req('openwop.it.effect-identity-cross-scope.the-spec-requires-a-business-identity-when-the-effect-escapes-the-run', 'RFC 0150 §B', 'RFC 0150 §B: the spec MUST name the case — a node side effect that is ALSO reachable ' +
        'outside any run (operator route, admin action, scheduled job).'),
    ).toBe(true);
    expect(
      /MUST additionally key/.test(plain),
      'RFC 0150 §B: for such an effect the host MUST additionally key on an identity derived from ' +
        'the business operation. Layer-2 identity alone cannot dedupe across the boundary, because ' +
        'the out-of-run path has no `runId` to put in the preimage — so a host following the ' +
        'ordinal form literally reintroduces the duplicate effect §B exists to prevent.',
    ).toBe(true);
  });

  it('the run-scope cost is tied to the fork limitation it shares a cause with', () => {
    // Both are the same fact seen from two sides: `runId` in the preimage. The
    // spec already documented the fork face; documenting only that one taught
    // half a limitation.
    // Asserts the linkage, not a magic phrase: the cross-scope section must
    // name the fork limitation as the same fact seen from another side.
    expect(
      /fork note[\s\S]{0,120}?(one face|other face|same)/.test(plain),
      req('openwop.it.effect-identity-cross-scope.the-run-scope-cost-is-tied-to-the-fork-limitation-it-shares-a-cause-with', 'RFC 0150 §B', 'RFC 0150 §B: the fork note and the cross-scope note are one limitation seen twice — ' +
        '`runId` in the preimage. The cross-scope section MUST reference the fork note, or a ' +
        'reader concludes the fork case is a special exception rather than an instance.'),
    ).toBe(true);
  });
});
