/**
 * Egress-decision secret non-leak (RFC 0079 §F / SR-1) — behavioral.
 *
 * Gated on `httpClient.egressPolicy.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Backs the `egress-decision-no-secret-leak`
 * guarantee: an `egress.decided` payload is metadata-only — it MUST NOT carry
 * the credential value, nor spill the blocked URL/host/header/body into a
 * free-form field, and its `reason` MUST be drawn from the CLOSED vocabulary
 * (so a host cannot smuggle a blocked destination into the reason string).
 *
 * Drives the host-sample seam with a `canary` credential whose value is a known
 * sentinel and asserts the sentinel never surfaces in the decision
 * (`canaryLeaked !== true`) and that the payload carries none of the forbidden
 * content keys. Soft-skips on 404/405.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§"Credential provenance + egress policy")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0079-credential-provenance-and-egress-policy.md
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readEgressPolicyCap, driveEgress, EGRESS_REASONS, EGRESS_CONTENT_FORBIDDEN } from '../lib/egressPolicy.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('egress-decision-content-free (RFC 0079 §F / SR-1)', () => {
  it('never leaks the credential value or the blocked destination into the egress.decided payload', async () => {
    const cap = await readEgressPolicyCap();
    if (!behaviorGate('openwop-egress-decision-content-free', cap?.supported === true)) return;

    const res = await driveEgress({ scenario: 'canary' });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip

    // The canary sentinel MUST NOT appear anywhere observable.
    expect(
      res.canaryLeaked !== true,
      req('openwop.it.egress-decision-content-free.never-leaks-the-credential-value-or-the-blocked-destination-into-the-egress-deci', 'RFC 0079 §F (SR-1)', 'the credential value (canary) MUST NOT leak into any observable surface'),
    ).toBe(true);

    // No forbidden content keys on the decision payload.
    for (const forbidden of EGRESS_CONTENT_FORBIDDEN) {
      expect(
        !(forbidden in res),
        req('openwop.it.egress-decision-content-free.never-leaks-the-credential-value-or-the-blocked-destination-into-the-egress-deci', 'RFC 0079 §F (SR-1)', `egress.decided MUST be content-free (no ${forbidden})`),
      ).toBe(true);
    }

    // The reason stays in the closed vocabulary — no free-form destination spill.
    if (res.reason !== undefined) {
      expect(
        typeof res.reason === 'string' && EGRESS_REASONS.includes(res.reason),
        req('openwop.it.egress-decision-content-free.never-leaks-the-credential-value-or-the-blocked-destination-into-the-egress-deci', 'run-event-payloads.schema.json#egressDecided', 'reason MUST be in the closed enum (no free-form spill)'),
      ).toBe(true);
    }
  });
});
