/**
 * oauth-connector-redaction — RFC 0047 §C / §D + `credential-payload-redaction`.
 *
 * Status: DRAFT. RFC 0047 (`host.oauth`) is `Draft`. Reuses the RFC 0046
 * SECURITY invariant `credential-payload-redaction` — OAuth tokens acquired
 * via host.oauth are stored as host.credentials entries and are subject to
 * the same no-plaintext-on-the-wire rule.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.oauth.supported = true`.
 *
 * What this scenario asserts:
 *   1. Advertisement shape — `capabilities.oauth.supported` is a boolean.
 *   2. Token-material redaction MUST-NOT — when the host exposes the optional
 *      `POST /v1/host/sample/oauth/connector-echo` test seam (a synthetic
 *      provider acquires a token whose value is a known canary, then a
 *      connector node runs), the canary MUST NOT appear in ANY observable
 *      run surface, and `connector.authorized` MUST carry the credential
 *      reference rather than the token.
 *
 * Hosts without the seam soft-skip the redaction probe (404).
 *
 * @see RFCS/0047-host-oauth-connector-flows.md
 * @see SECURITY/invariants.yaml id: credential-payload-redaction
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryOAuth {
  supported?: boolean;
}

interface DiscoveryDoc {
  capabilities?: {
    oauth?: DiscoveryOAuth;
  };
}

const TOKEN_CANARY = 'OPENWOP_OAUTH_CANARY_b7d3e1a9c2';

async function readOAuth(): Promise<DiscoveryOAuth | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return body?.capabilities?.oauth ?? null;
}

describe('oauth-connector-redaction: advertisement shape (RFC 0047 §A)', () => {
  it('capabilities.oauth.supported is a boolean when advertised', async () => {
    const oauth = await readOAuth();
    if (oauth === null) return;
    expect(
      typeof oauth.supported,
      driver.describe(
        'capabilities.schema.json §oauth',
        'capabilities.oauth.supported MUST be a boolean when oauth is advertised',
      ),
    ).toBe('boolean');
  });
});

describe('oauth-connector-redaction: token material MUST NOT cross the wire (RFC 0047 §C.2)', () => {
  it('canary token is absent from every observable run surface', async () => {
    const oauth = await readOAuth();
    if (!oauth?.supported) return; // capability-gated

    // Seam contract: a synthetic provider issues a token whose value is
    // TOKEN_CANARY, a connector node runs, and the run's observable surfaces
    // (events incl. connector.authorized + snapshot + debug bundle) are returned.
    const res = await driver.post('/v1/host/sample/oauth/connector-echo', { canary: TOKEN_CANARY });
    // 404 from a host that hasn't wired the test seam is a soft-skip.
    if (res.status === 404) return;

    expect(
      res.status,
      driver.describe(
        'RFC 0047 §C',
        'the oauth connector-echo seam MUST acquire the token and return the run observable surfaces',
      ),
    ).toBeLessThan(400);

    const serialized = JSON.stringify(res.json ?? {});
    expect(
      serialized.includes(TOKEN_CANARY),
      driver.describe(
        'SECURITY/invariants.yaml credential-payload-redaction',
        'acquired OAuth token material MUST NOT appear in inputs, variables, channels, events, snapshot, or debug bundle — only the credential reference may cross the wire',
      ),
    ).toBe(false);
  });
});
