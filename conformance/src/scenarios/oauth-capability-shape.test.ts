/**
 * oauth-capability-shape — RFC 0047 §A advertisement-shape verification.
 *
 * Status: DRAFT. RFC 0047 (`host.oauth`) is `Draft`. The
 * `capabilities.oauth` block has landed in `schemas/capabilities.schema.json`.
 *
 * Always runs (shape-only): when the host advertises `capabilities.oauth`,
 * its fields MUST be well-formed; when it doesn't, the block is absent.
 *
 * What this scenario asserts:
 *   1. `capabilities.oauth` is either absent or a well-formed object.
 *   2. When `supported: true`, `grants` (when present) is a subset of
 *      {authorization_code, client_credentials, refresh_token}, and every
 *      `providers[]` entry has a non-empty `id` (RFC 0047 §A).
 *
 * @see RFCS/0047-host-oauth-connector-flows.md
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

interface DiscoveryOAuthProvider {
  id?: string;
  authUrl?: string;
  tokenUrl?: string;
  scopesSupported?: string[];
}

interface DiscoveryOAuth {
  supported?: boolean;
  grants?: string[];
  providers?: DiscoveryOAuthProvider[];
}

interface DiscoveryDoc {
  capabilities?: {
    oauth?: DiscoveryOAuth;
  };
}

const VALID_GRANTS: ReadonlySet<string> = new Set([
  'authorization_code',
  'client_credentials',
  'refresh_token',
]);

async function readOAuth(): Promise<DiscoveryOAuth | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'oauth') ?? null;
}

describe('oauth-capability-shape: advertisement shape (RFC 0047 §A)', () => {
  it('capabilities.oauth is either absent or well-formed', async () => {
    const oauth = await readOAuth();
    if (oauth === null) return softSkip('inapplicable', 'host doesn\'t advertise host.oauth at all');
    expect(
      typeof oauth.supported,
      req('openwop.it.oauth-capability-shape.capabilities-oauth-is-either-absent-or-well-formed', 
        'capabilities.schema.json §oauth',
        'capabilities.oauth.supported MUST be a boolean when oauth is advertised',
      ),
    ).toBe('boolean');
  });

  it('grants is a subset of the canonical grant set when supported', async () => {
    const oauth = await readOAuth();
    if (!oauth?.supported || oauth.grants === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!oauth?.supported || oauth.grants === undefined` returned early');
    expect(
      Array.isArray(oauth.grants),
      req('openwop.it.oauth-capability-shape.grants-is-a-subset-of-the-canonical-grant-set-when-supported', 'RFC 0047 §A', 'capabilities.oauth.grants MUST be an array'),
    ).toBe(true);
    for (const grant of oauth.grants) {
      expect(
        VALID_GRANTS.has(grant),
        req('openwop.it.oauth-capability-shape.grants-is-a-subset-of-the-canonical-grant-set-when-supported', 
          'RFC 0047 §A',
          `capabilities.oauth.grants entries MUST be one of {${[...VALID_GRANTS].join(', ')}}, got: ${grant}`,
        ),
      ).toBe(true);
    }
  });

  it('every advertised provider has a non-empty id when supported', async () => {
    const oauth = await readOAuth();
    if (!oauth?.supported || oauth.providers === undefined) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!oauth?.supported || oauth.providers === undefined` returned early');
    for (const provider of oauth.providers) {
      expect(
        typeof provider.id === 'string' && provider.id.length > 0,
        req('openwop.it.oauth-capability-shape.every-advertised-provider-has-a-non-empty-id-when-supported', 
          'RFC 0047 §A',
          'each capabilities.oauth.providers[] entry MUST declare a non-empty id',
        ),
      ).toBe(true);
    }
  });
});
