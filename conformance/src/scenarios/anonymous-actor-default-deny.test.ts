/**
 * Anonymous-actor default-deny grant (RFC 0132 §C.1) — backs the
 * `anon-actor-no-default-baseline` SECURITY invariant.
 *
 * An anonymous actor is granted ONLY the tools explicitly listed in the
 * resolved surface allowlist — never a default-on tool baseline, never a tool
 * granted to authenticated agents by default. The effective granted set is
 * discoverable through the RFC 0078 tool-catalog read scoped to the anon
 * principal, which fails EMPTY when the surface grants nothing (never a
 * baseline). A call to a non-granted tool MUST resolve to
 * `authorization.decided { allowed:false, reason:"anon-not-granted" }` with NO
 * dispatch.
 *
 * Capability-gated on `capabilities.anonymousActor.supported` +
 * `behaviorGate('openwop-anonymous-actor', …)`; soft-skips when unadvertised or
 * when the reference public-surface seam is unwired (404). Hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. When it passes non-vacuously the
 * `anon-actor-no-default-baseline` invariant graduates reference-impl → protocol
 * tier (RFC 0079 precedent).
 *
 * @see RFCS/0132-anonymous-actor-authorization.md §C.1
 * @see conformance/coverage.md §"Capability-gated scenarios"
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { driver } from '../lib/driver.js';
import {
  isAnonymousActorAdvertised,
  anonDispatch,
  anonToolCatalog,
  readAnonymousActorCap,
} from '../lib/anonymousActor.js';

const PROFILE = 'openwop-anonymous-actor';

/** A tool no public surface would ever grant — an authenticated default-on baseline action. */
const UNGRANTED_TOOL = 'crm.contact.delete';

describe('anonymous-actor-default-deny (RFC 0132 §C.1)', () => {
  it('the anon tool catalog returns only the explicit surface grant — never a default baseline', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    const cat = await anonToolCatalog();
    if (cat.status === 404 || cat.status === 405) return; // seam unwired — soft-skip
    expect(
      cat.status,
      driver.describe('RFC 0132 §C.1', 'the anon tool-catalog read MUST resolve (scoped to the anon principal)'),
    ).toBe(200);
    // Default-deny: the ungranted baseline tool MUST NOT appear in the anon catalog.
    const names = cat.tools.map((t) => t.name);
    expect(
      names,
      driver.describe('RFC 0132 §C.1', 'a default-on baseline tool MUST NOT appear in the anon grant'),
    ).not.toContain(UNGRANTED_TOOL);
  });

  it('calling a non-granted tool denies with reason "anon-not-granted" and does not dispatch', async () => {
    if (!behaviorGate(PROFILE, await isAnonymousActorAdvertised())) return;
    const res = await anonDispatch({ tool: UNGRANTED_TOOL });
    if (res.status === 404 || res.status === 405) return; // seam unwired — soft-skip
    const decided = res.json?.authorizationDecided?.payload;
    expect(
      decided?.allowed,
      driver.describe('RFC 0132 §C.1', 'a non-granted anon tool MUST be denied (allowed:false), never default-allowed'),
    ).toBe(false);
    expect(
      decided?.reason,
      driver.describe('RFC 0132 §C.1', 'a default-deny denial carries the machine reason "anon-not-granted"'),
    ).toBe('anon-not-granted');
    // No dispatch — the seam MUST NOT return a tool result for a denied call.
    expect(
      res.json?.result,
      driver.describe('RFC 0132 §C.1', 'a denied anon tool MUST NOT dispatch (no result)'),
    ).toBeUndefined();
  });

  it('a host that advertises bounded-write-egress also advertises a mandatory control (truthful-advertisement)', async () => {
    const cap = await readAnonymousActorCap();
    if (!behaviorGate(PROFILE, cap?.supported === true)) return;
    if ((cap?.tiers ?? []).includes('bounded-write-egress')) {
      expect(
        (cap?.writeEgressControls ?? []).length,
        driver.describe('RFC 0132 §B.2', 'bounded-write-egress MUST advertise ≥1 writeEgressControl'),
      ).toBeGreaterThan(0);
    }
  });
});
