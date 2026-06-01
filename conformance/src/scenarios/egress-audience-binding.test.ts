/**
 * Credential-audience-bound egress (RFC 0079 §C) — behavioral KEYSTONE.
 *
 * Gated on `httpClient.egressPolicy.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `egress-provenance-shape.test.ts`; this asserts host BEHAVIOR — the §C
 * confused-deputy MUST that backs the `egress-credential-audience-bound`
 * SECURITY invariant:
 *
 *   1. OUT-OF-AUDIENCE — a host-issued credential bound to audience A, used for
 *      an egress to destination B (B ∉ A), MUST be `denied` or `downgraded`
 *      with `reason: "out-of-audience"`, and the credential MUST NOT be attached
 *      to the egress (`credentialAttached !== true`).
 *   2. PROVENANCE-UNEVALUABLE — an egress whose credential provenance cannot be
 *      evaluated MUST be `denied` with `reason: "provenance-unevaluable"`
 *      (fail-closed, not fail-open).
 *
 * The decision is driven through the OPTIONAL host-sample egress seam
 * (`POST /v1/host/sample/egress/decide`) — soft-skip on 404/405. The decision
 * reason is a CLOSED enum so a host cannot spill a blocked URL/host into a
 * free-form string (SR-1, asserted in `egress-decision-content-free.test.ts`).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§"Credential provenance + egress policy")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0079-credential-provenance-and-egress-policy.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (egress-credential-audience-bound)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readEgressPolicyCap, driveEgress, EGRESS_DECISIONS, EGRESS_REASONS } from '../lib/egressPolicy.js';

describe('egress-audience-binding (RFC 0079 §C)', () => {
  it('denies/downgrades an out-of-audience egress without attaching the credential, and fails closed on unevaluable provenance', async () => {
    const cap = await readEgressPolicyCap();
    if (!behaviorGate('openwop-egress-audience-binding', cap?.supported === true)) return;

    // ---- Leg 1: out-of-audience — deny|downgrade + credential NOT attached --
    const oob = await driveEgress({ scenario: 'out-of-audience' });
    if (oob === null) return; // egress seam absent — soft-skip the whole behavior
    expect(
      oob.decision === 'denied' || oob.decision === 'downgraded',
      driver.describe('host-capabilities.md §"Credential provenance + egress policy"', 'an out-of-audience egress MUST be denied or downgraded'),
    ).toBe(true);
    expect(
      typeof oob.decision === 'string' && EGRESS_DECISIONS.includes(oob.decision),
      driver.describe('run-event-payloads.schema.json#egressDecided', 'decision MUST be in the closed enum'),
    ).toBe(true);
    expect(
      oob.reason === 'out-of-audience',
      driver.describe('RFC 0079 §C', 'an out-of-audience denial MUST carry reason "out-of-audience"'),
    ).toBe(true);
    expect(
      oob.credentialAttached !== true,
      driver.describe('SECURITY/invariants.yaml egress-credential-audience-bound', 'the host MUST NOT attach a credential whose audience excludes the destination (confused-deputy)'),
    ).toBe(true);

    // ---- Leg 2: provenance-unevaluable — fail closed (deny) ----------------
    const uneval = await driveEgress({ scenario: 'provenance-unevaluable' });
    if (uneval !== null) {
      expect(
        uneval.decision === 'denied',
        driver.describe('RFC 0079 §C', 'an egress with unevaluable provenance MUST fail closed (denied)'),
      ).toBe(true);
      expect(
        uneval.reason === 'provenance-unevaluable',
        driver.describe('RFC 0079 §C', 'a provenance-unevaluable denial MUST carry reason "provenance-unevaluable"'),
      ).toBe(true);
      expect(
        typeof uneval.reason === 'string' && EGRESS_REASONS.includes(uneval.reason),
        driver.describe('run-event-payloads.schema.json#egressDecided', 'reason MUST be in the closed enum'),
      ).toBe(true);
      expect(
        uneval.credentialAttached !== true,
        driver.describe('SECURITY/invariants.yaml egress-credential-audience-bound', 'a fail-closed egress MUST NOT attach the credential'),
      ).toBe(true);
    }
  });
});
