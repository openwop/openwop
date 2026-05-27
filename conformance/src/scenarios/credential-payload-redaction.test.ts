/**
 * credential-payload-redaction — RFC 0046 §C.1 / §E invariant verification.
 *
 * Status: DRAFT. RFC 0046 (`host.credentials`) is `Draft`. Backs the
 * SECURITY invariant `credential-payload-redaction`.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.credentials.supported = true`.
 *
 * What this scenario asserts:
 *   1. Advertisement shape — `capabilities.credentials` is well-formed when
 *      supported (delegated in detail to credentials-capability-shape).
 *   2. Redaction MUST-NOT — when the host exposes the optional
 *      `POST /v1/host/sample/credentials/echo` test seam, resolving a seeded
 *      credential whose plaintext is a known canary MUST NOT cause that
 *      canary to appear in ANY of the run's observable surfaces (events,
 *      inputs, persisted variables, channels, snapshot, debug bundle). The
 *      reference is the only credential artifact permitted on the wire.
 *
 * Hosts without the test seam soft-skip the redaction probe (404) and still
 * assert the advertisement shape — mirroring fs-path-traversal.
 *
 * @see RFCS/0046-host-credentials-capability.md
 * @see SECURITY/invariants.yaml id: credential-payload-redaction
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryCredentials {
  supported?: boolean;
}

interface DiscoveryDoc {
  capabilities?: {
    credentials?: DiscoveryCredentials;
  };
}

// A unique canary the seam seeds as the resolved credential's plaintext.
const CANARY = 'OPENWOP_CRED_CANARY_4f1c8a2e9b';

async function readCredentials(): Promise<DiscoveryCredentials | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'credentials') ?? null;
}

describe('credential-payload-redaction: advertisement shape (RFC 0046 §A)', () => {
  it('capabilities.credentials.supported is a boolean when advertised', async () => {
    const cred = await readCredentials();
    if (cred === null) return;
    expect(
      typeof cred.supported,
      driver.describe(
        'capabilities.schema.json §credentials',
        'capabilities.credentials.supported MUST be a boolean when credentials is advertised',
      ),
    ).toBe('boolean');
  });
});

describe('credential-payload-redaction: resolved material MUST NOT cross the wire (RFC 0046 §C.1)', () => {
  it('canary plaintext is absent from every observable run surface', async () => {
    const cred = await readCredentials();
    if (!cred?.supported) return; // capability-gated

    // Seam contract: resolve a seeded credential whose plaintext is CANARY,
    // run an echo node, and return the run's observable surfaces.
    const res = await driver.post('/v1/host/sample/credentials/echo', { canary: CANARY });
    // 404 from a host that hasn't wired the test seam is a soft-skip.
    if (res.status === 404) return;

    expect(
      res.status,
      driver.describe(
        'SECURITY/invariants.yaml credential-payload-redaction',
        'the credentials echo seam MUST resolve the seeded credential and return its observable surfaces',
      ),
    ).toBeLessThan(400);

    // The entire serialized observable surface (events + inputs + variables +
    // channels + snapshot + debug bundle) MUST NOT contain the canary plaintext.
    const serialized = JSON.stringify(res.json ?? {});
    expect(
      serialized.includes(CANARY),
      driver.describe(
        'SECURITY/invariants.yaml credential-payload-redaction',
        'resolved credential material MUST NOT appear in inputs, variables, channels, events, snapshot, or debug bundle — only the reference may cross the wire',
      ),
    ).toBe(false);
  });
});
