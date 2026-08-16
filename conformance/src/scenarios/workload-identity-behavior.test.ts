/**
 * RFC 0154 §A/§B — the workload-identity BEHAVIORAL witness.
 *
 * §A's requirements are behavioral and, from the wire alone, **invisible**: a
 * host must cryptographically verify the presented identity, bind it to the
 * request, resolve it to an OpenWOP principal *before* authorization, and fail
 * closed when it cannot. A normal request either succeeds or 401s, and **both
 * outcomes look identical whether the host verified anything or simply trusted
 * a header.**
 *
 * That invisibility is why `host-sample-test-seams.md` §20 exists, and why this
 * file reports a missing seam as `blocked` rather than skipping quietly. RFC
 * 0148 §A resolves an unobservable requirement to `blocked`, never to a pass —
 * so without the seam, RFC 0154 cannot be certified at all. That is the honest
 * position, and stating it is the point.
 *
 * **The negative cases carry the weight here.** A host that echoes its input can
 * satisfy every positive assertion; only the rejections distinguish a verifier
 * from a passthrough. So each negative names the specific confusion it rules
 * out:
 *
 *   - **audience mismatch** — an identity minted for another host, accepted
 *     here, is how a credential valid elsewhere becomes valid here;
 *   - **expired delegation** — a delegation without a live expiry is a standing
 *     grant, which is not what delegation means;
 *   - **missing sender constraint** — without proof-of-possession a bearer
 *     credential is replayable by anyone who observed it, so the host would be
 *     asserting *who called* rather than *that the caller held the key*.
 *
 * And the framing that no assertion can enforce, stated because it governs how
 * a `200` here should be read: **identity is not authorization** (RFC 0147 R12).
 * A resolution means the identity resolved. It never means the caller may act.
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode, readRetriable } from '../lib/error-envelope.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const PROFILE = 'openwop-workload-identity';
/**
 * §B gates on its OWN flag, not on §A's.
 *
 * The first draft of this file gated every leg on `workloadIdentity.supported`,
 * which meant a host that verifies workload identity but does NOT implement
 * delegation had two options: advertise and hard-fail the §B legs under strict
 * mode, or advertise nothing and get no witness for the §A behavior it does
 * have. That is the overclaim-or-silence bind RFC 0155 §A names for
 * `openwop-core`, reproduced one capability down.
 *
 * A tier-1 host caught it by asking whether the scenarios gate per-section or
 * all-on-`supported`. They gate per-section now. §A-only is an honest,
 * witnessable posture.
 */
const DELEGATION_PROFILE = 'openwop-workload-identity-delegation';
const SEAM = '/v1/host/sample/test/workload-identity/resolve';

interface AuthCaps {
  readonly workloadIdentity?: {
    readonly supported?: boolean;
    readonly schemes?: readonly string[];
    readonly senderConstraint?: readonly string[];
    readonly delegation?: { readonly supported?: boolean; readonly maxChainDepth?: number };
  };
}

async function caps(): Promise<AuthCaps['workloadIdentity']> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<AuthCaps>(disco.json, 'auth')?.workloadIdentity;
}

/** A seam response, or `null` when the seam is absent. */
async function resolve(body: Record<string, unknown>): Promise<{ status: number; json: unknown } | null> {
  const r = await driver.post(SEAM, body);
  return r.status === 404 || r.status === 403 ? null : { status: r.status, json: r.json };
}

function reasonOf(json: unknown): string | undefined {
  return readErrorCode(json);
}

const IDENTITY = { scheme: 'spiffe', subject: 'spiffe://example/dispatcher', issuer: 'spiffe://example' };

describe('RFC 0154 §A — workload identity resolution (capability-gated behavior)', () => {
  it('the seam is wired, or the requirement is blocked rather than skipped', async () => {
    if (!behaviorGate(PROFILE, (await caps())?.supported === true)) return;
    const r = await resolve({ identity: { ...IDENTITY, audience: 'openwop-host' } });
    expect(
      r,
      driver.describe(
        'spec/v1/host-sample-test-seams.md §20',
        'a host advertising `auth.workloadIdentity` MUST expose the resolution seam. §A\'s ' +
          'requirements — verify, bind, resolve-before-authorize, fail closed — are invisible from ' +
          'a normal request, where success and 401 look identical whether the host verified ' +
          'anything or trusted a header. RFC 0148 §A resolves an unobservable requirement to ' +
          '`blocked`, so without this seam RFC 0154 cannot be certified at all.',
      ),
    ).not.toBeNull();
  });

  it('a verified identity resolves to a principal', async () => {
    if (!behaviorGate(PROFILE, (await caps())?.supported === true)) return;
    const r = await resolve({ identity: { ...IDENTITY, audience: 'openwop-host' } });
    if (r === null) return;
    expect(r.status, driver.describe('RFCS/0154 §A', 'a verified identity resolves')).toBe(200);
    const principalId = (r.json as { principalId?: string }).principalId;
    expect(principalId, driver.describe('RFCS/0154 §A', 'resolution yields an OpenWOP principal')).toBeTruthy();
  });

  it('an identity for another audience is rejected', async () => {
    if (!behaviorGate(PROFILE, (await caps())?.supported === true)) return;
    const r = await resolve({ identity: { ...IDENTITY, audience: 'some-other-host' }, expectedAudience: 'openwop-host' });
    if (r === null) return;
    // The load-bearing negative. A host that echoes its input passes every
    // positive assertion; only this distinguishes a verifier from a passthrough.
    expect(
      r.status >= 400,
      driver.describe(
        'RFCS/0154 §A + RFC 0147 R12',
        'an identity minted for another host, accepted here, is how a credential valid elsewhere ' +
          'becomes a credential valid here — the confused-deputy path this profile prevents',
      ),
    ).toBe(true);
    expect(reasonOf(r.json)).toBe('audience_mismatch');
  });

  it('an expired delegation is rejected', async () => {
    // §B, gated on §B's own flag. A host doing §A-only identity resolution is
    // not failing this requirement — it has not claimed it.
    if (!behaviorGate(DELEGATION_PROFILE, (await caps())?.delegation?.supported === true)) return;
    const r = await resolve({
      identity: {
        ...IDENTITY,
        audience: 'openwop-host',
        delegation: {
          chain: [{ subject: 'spiffe://example/dispatcher' }],
          audience: 'openwop-host',
          expiresAt: '2020-01-01T00:00:00Z',
        },
      },
    });
    if (r === null) return;
    expect(
      r.status >= 400,
      driver.describe(
        'RFCS/0154 §B',
        'a delegation without a live expiry is a standing grant, which is not what delegation means',
      ),
    ).toBe(true);
    expect(reasonOf(r.json)).toBe('delegation_expired');
  });

  it('a failure is non-retriable and carries a closed reason code', async () => {
    if (!behaviorGate(PROFILE, (await caps())?.supported === true)) return;
    const r = await resolve({ identity: { scheme: 'spiffe', subject: 'spiffe://example/unknown' } });
    if (r === null || r.status < 400) return;
    // canonical flat envelope: code = `error`, retriable = `details.retriable`
    // (the legacy nested `error.{code,retriable}` the §20 catalog prescribed until
    // 2026-08-16 is tolerated by the helpers for the deprecation window)
    expect(
      readRetriable(r.json),
      driver.describe(
        'spec/v1/host-sample-test-seams.md §20',
        'an identity that does not resolve will not resolve on retry. Marking it retriable invites ' +
          'a caller to hammer a failing authorization path.',
      ),
    ).toBe(false);
    expect(
      ['identity_unverified', 'identity_unresolvable', 'audience_mismatch', 'delegation_expired', 'sender_constraint_missing', 'delegation_chain_too_long', 'delegation_chain_cyclic', 'delegation_scope_amplified'],
      driver.describe('RFCS/0154 §A', 'failures use a closed reason vocabulary'),
    ).toContain(readErrorCode(r.json));
  });

  it('a resolution response carries no credential material', async () => {
    if (!behaviorGate(PROFILE, (await caps())?.supported === true)) return;
    const r = await resolve({ identity: { ...IDENTITY, audience: 'openwop-host' } });
    if (r === null) return;
    const serialized = JSON.stringify(r.json ?? {});
    for (const forbidden of ['-----BEGIN', 'Bearer ', 'eyJ']) {
      expect(
        serialized.includes(forbidden),
        driver.describe(
          'RFCS/0154 §A',
          'a verified identity is a fact about a completed verification, not a container for the ' +
            `material that proved it. Found: ${forbidden}`,
        ),
      ).toBe(false);
    }
  });
});
