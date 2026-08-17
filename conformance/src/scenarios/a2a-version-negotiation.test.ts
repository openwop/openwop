/**
 * RFC 0152 §B — A2A version negotiation, witnessed against the fake peer.
 *
 * This file exists because I twice described RFC 0152 as needing a live
 * upstream A2A peer, and that was only half true. **Interop needs a real peer.
 * Negotiation does not** — negotiation is the *host's* behavior, and the host is
 * right here. What was actually missing was that `A2AFakePeer` recorded method,
 * path, rpcMethod, and body, but **not headers** — and §B lives entirely in the
 * headers. The peer could observe that a call happened but not which version was
 * negotiated, which is the only part §B is about.
 *
 * So the blocker was apparatus, again, and the fix was to record what the fake
 * peer already received.
 *
 * `Real upstream A2A 1.0 peer passes in CI` remains a separate and unmet
 * acceptance item — it tests interoperation, which no fake can stand in for.
 * This file does not claim it, and RFC 0152's acceptance criteria still say so.
 *
 * The load-bearing requirement is negative: **"a host MUST NOT silently
 * downgrade an authenticated request."** A silent downgrade is the dangerous
 * outcome precisely because it *succeeds* — the caller believes it negotiated
 * 1.0, the peer answered 0.3, and nothing in the response says otherwise. A
 * failure would at least be visible.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';
import { readErrorCode } from '../lib/error-envelope.js';

/**
 * Callback-shaped: the host issues A2A calls to the suite's fake peer, which records the negotiated version header.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host issues A2A calls to the suite's fake peer, which records the negotiated version header";

const PROFILE = 'a2a.versionNegotiation';

interface A2ACaps {
  readonly supported?: boolean;
  readonly protocolVersions?: readonly string[];
  readonly preferredVersion?: string;
}

async function a2a(): Promise<A2ACaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<A2ACaps>(disco.json, 'a2a');
}

/** Advertised versions are a §A shape claim; §B is what the host DOES with them. */
async function negotiationAdvertised(): Promise<boolean> {
  const caps = await a2a();
  return caps?.supported === true && (caps.protocolVersions?.length ?? 0) > 0;
}

describe('RFC 0152 §B — A2A version negotiation', () => {
  it('the advertised preferred version is one the host actually claims', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const caps = await a2a();
    expect(
      caps?.protocolVersions ?? [],
      driver.describe(
        'RFCS/0152-a2a-1-0-versioned-composition.md §A',
        '`preferredVersion` MUST be present in `protocolVersions`. Preferring a version you do ' +
          'not list is a claim no peer can act on.',
      ),
    ).toContain(caps?.preferredVersion);
  });

  it('outbound calls carry an explicit A2A-Version header', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const peer = getA2AFakePeer();
    if (peer === null) return; // no fake peer wired in this run
    peer.reset();
    const drive = await driver.post('/v1/host/sample/a2a/invoke', { peerUrl: peer.endpoint() });
    if (drive.status === 404 || drive.status === 403) {
      // Seam absent. RFC 0148 §A: unobservable resolves to `blocked`, not a pass.
      expect(
        drive.status,
        driver.describe(
          'RFCS/0152 §B',
          'a host advertising A2A version negotiation MUST expose an invoke seam so the negotiated ' +
            'version is observable. Without it the requirement cannot be witnessed and resolves to ' +
            '`blocked` per RFC 0148 §A.',
        ),
      ).not.toBe(404);
      return;
    }
    const calls = peer.invocations().filter((i: { method: string }) => i.method !== 'GET');
    expect(calls.length, 'the host MUST have called the peer').toBeGreaterThan(0);
    for (const c of calls) {
      expect(
        c.headers['a2a-version'],
        driver.describe(
          'RFCS/0152 §B',
          'the sender MUST send `A2A-Version`. An absent header leaves the receiver guessing, and ' +
            'a guess that happens to be right is not a negotiation.',
        ),
      ).toBeTruthy();
    }
  });

  it('an authenticated request is not silently downgraded', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const peer = getA2AFakePeer();
    if (peer === null) return;
    const caps = await a2a();
    const preferred = caps?.preferredVersion;
    peer.reset();
    const drive = await driver.post('/v1/host/sample/a2a/invoke', {
      peerUrl: peer.endpoint(),
      authenticated: true,
      peerOffersOnly: '0.3',
    });
    if (drive.status === 404 || drive.status === 403) return; // covered above

    // THE load-bearing leg. A silent downgrade is dangerous precisely because it
    // SUCCEEDS: the caller believes it negotiated `preferred`, the peer answered
    // 0.3, and nothing in the response says otherwise. Either the host refuses
    // (fails closed, visibly) or it negotiates down EXPLICITLY — what it must
    // not do is return success while having quietly used the lower version.
    if (drive.status < 400) {
      const negotiated = (drive.json as { negotiatedVersion?: string }).negotiatedVersion;
      expect(
        negotiated,
        driver.describe(
          'RFCS/0152 §B',
          'a host that proceeds after a downgrade MUST report the version it actually negotiated. ' +
            'Reporting the preferred version while having used a lower one is the silent downgrade ' +
            '§B forbids — and it is worse than a failure because it succeeds.',
        ),
      ).not.toBe(preferred);
      const calls = peer.invocations().filter((i: { method: string }) => i.method !== 'GET');
      for (const c of calls) {
        expect(
          c.headers['a2a-version'],
          driver.describe('RFCS/0152 §B', 'the wire header MUST match the reported negotiated version'),
        ).toBe(negotiated);
      }
    }
  });

  it('an unsupported version fails through the canonical interop error envelope', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const peer = getA2AFakePeer();
    if (peer === null) return;
    const drive = await driver.post('/v1/host/sample/a2a/invoke', {
      peerUrl: peer.endpoint(),
      requestVersion: '99.0',
    });
    if (drive.status === 404 || drive.status === 403) return;
    expect(drive.status >= 400, driver.describe('RFCS/0152 §B', 'an unsupported version MUST fail')).toBe(true);
    // S28: canonical envelope is FLAT (`error: "<code>"`, error-envelope.schema.json);
    // the nested `error.code` is tolerated by the lib only through the deprecation window.
    expect(
      readErrorCode(drive.json),
      driver.describe(
        'RFCS/0152 §B',
        'the upstream version error MUST be projected through the canonical OpenWOP interop error ' +
          'envelope when the failure crosses an OpenWOP boundary — a raw upstream body leaves the ' +
          'caller parsing a foreign protocol to learn its own request was rejected',
      ),
    ).toBeTruthy();
  });
});
