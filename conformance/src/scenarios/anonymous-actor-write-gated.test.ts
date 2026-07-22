/**
 * Anonymous-actor bounded-write/egress is gated (RFC 0132 §C.3) — backs the
 * `anon-actor-write-egress-gated` SECURITY invariant.
 *
 * A `bounded-write-egress` tool — one that mutates durable state or performs
 * outbound egress — is permitted for an anonymous actor ONLY behind a mandatory
 * control: a per-action HITL/approval gate (RFC 0051 — the action suspends
 * pending a human decision) OR a hard rate-limit AND a per-session action cap.
 * An anon write/egress with no resolvable control MUST be denied. With a `hitl`
 * control, the action MUST suspend on an approval interrupt BEFORE any durable
 * write.
 *
 * Capability-gated on `capabilities.anonymousActor.supported` + the
 * `bounded-write-egress` tier; soft-skips when unadvertised or when the seam is
 * unwired (404). Hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`. Passing
 * non-vacuously graduates `anon-actor-write-egress-gated` reference-impl →
 * protocol tier.
 *
 * @see RFCS/0132-anonymous-actor-authorization.md §C.3
 * @see RFCS/0051-approval-deployment-gate-primitive.md
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { driver } from '../lib/driver.js';
import { readAnonymousActorCap, anonDispatch } from '../lib/anonymousActor.js';

const PROFILE = 'openwop-anonymous-actor';

describe('anonymous-actor-write-gated (RFC 0132 §C.3)', () => {
  it('an anon bounded-write tool is gated — denied when ungated, or suspends on an approval interrupt', async () => {
    const cap = await readAnonymousActorCap();
    const supportsWrite = (cap?.tiers ?? []).includes('bounded-write-egress');
    if (!behaviorGate(PROFILE, cap?.supported === true && supportsWrite)) return;

    const res = await anonDispatch({ tool: 'lead.capture', args: { email: 'visitor@example.com' } });
    if (res.status === 404 || res.status === 405) return; // seam unwired — soft-skip

    const controls = cap?.writeEgressControls ?? [];
    const decided = res.json?.authorizationDecided?.payload;
    const suspended = res.json?.interrupt?.kind !== undefined;

    if (controls.includes('hitl')) {
      // With a HITL control the write MUST suspend on an approval interrupt before durable write.
      expect(
        suspended,
        driver.describe('RFC 0132 §C.3 (hitl)', 'an anon bounded-write MUST suspend on an approval interrupt before the write'),
      ).toBe(true);
      expect(
        res.json?.result,
        driver.describe('RFC 0132 §C.3 (hitl)', 'no durable write result before the approval resolves'),
      ).toBeUndefined();
    } else {
      // With only a rate-limit/session-cap control, the seam surfaces a gate; an
      // ungated write MUST be denied (never a silent durable write).
      const gatedOrDenied = suspended || decided?.allowed === false || res.status === 429;
      expect(
        gatedOrDenied,
        driver.describe('SECURITY anon-actor-write-egress-gated', 'an anon bounded-write MUST be gated — an ungated write MUST be denied'),
      ).toBe(true);
    }
  });

  it('an anon write with no resolvable control is denied with a machine reason', async () => {
    const cap = await readAnonymousActorCap();
    const supportsWrite = (cap?.tiers ?? []).includes('bounded-write-egress');
    if (!behaviorGate(PROFILE, cap?.supported === true && supportsWrite)) return;
    // Probe a surface deliberately configured with a write grant but no control.
    const res = await anonDispatch({ tool: 'lead.capture', surface: 'sample-uncontrolled-surface' });
    if (res.status === 404 || res.status === 405) return; // seam unwired / surface absent — soft-skip
    const decided = res.json?.authorizationDecided?.payload;
    expect(
      decided?.allowed === false || res.status === 403 || res.status === 429,
      driver.describe('SECURITY anon-actor-write-egress-gated', 'an anon write with no resolvable control MUST be denied'),
    ).toBe(true);
    if (decided && decided.allowed === false) {
      expect(
        decided.reason,
        driver.describe('RFC 0132 §C.3', 'an ungated anon write denial carries a machine reason'),
      ).toBe('anon-write-ungated');
    }
  });
});
