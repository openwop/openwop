/**
 * credentials-capability-shape — RFC 0046 §A advertisement-shape verification.
 *
 * Status: DRAFT. RFC 0046 (`host.credentials`) is `Draft`. The
 * `capabilities.credentials` block has landed in
 * `schemas/capabilities.schema.json` and the invariant row
 * `credential-payload-redaction` is in `SECURITY/invariants.yaml`.
 *
 * Always runs (shape-only): when the host advertises `capabilities.credentials`,
 * its fields MUST be well-formed; when it doesn't, the block is simply absent.
 *
 * What this scenario asserts:
 *   1. `capabilities.credentials` is either absent or a well-formed object.
 *   2. When `supported: true`, `scopes` (when present) is a subset of
 *      {user, workspace, tenant}, and `rotation` (when present) is one of
 *      {none, two-key-overlap} (RFC 0046 §A).
 *
 * @see RFCS/0046-host-credentials-capability.md
 * @see SECURITY/invariants.yaml id: credential-payload-redaction
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryCredentials {
  supported?: boolean;
  scopes?: string[];
  encryptionAtRest?: boolean;
  rotation?: string;
  sharing?: boolean;
}

interface DiscoveryDoc {
  capabilities?: {
    credentials?: DiscoveryCredentials;
  };
}

const VALID_SCOPES: ReadonlySet<string> = new Set(['user', 'workspace', 'tenant']);
const VALID_ROTATION: ReadonlySet<string> = new Set(['none', 'two-key-overlap']);

async function readCredentials(): Promise<DiscoveryCredentials | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return body?.capabilities?.credentials ?? null;
}

describe('credentials-capability-shape: advertisement shape (RFC 0046 §A)', () => {
  it('capabilities.credentials is either absent or well-formed', async () => {
    const cred = await readCredentials();
    if (cred === null) return; // host doesn't advertise host.credentials at all
    expect(
      typeof cred.supported,
      driver.describe(
        'capabilities.schema.json §credentials',
        'capabilities.credentials.supported MUST be a boolean when credentials is advertised',
      ),
    ).toBe('boolean');
  });

  it('scopes is a subset of {user, workspace, tenant} when supported', async () => {
    const cred = await readCredentials();
    if (!cred?.supported || cred.scopes === undefined) return;
    expect(
      Array.isArray(cred.scopes),
      driver.describe('RFC 0046 §A', 'capabilities.credentials.scopes MUST be an array'),
    ).toBe(true);
    for (const scope of cred.scopes) {
      expect(
        VALID_SCOPES.has(scope),
        driver.describe(
          'RFC 0046 §A',
          `capabilities.credentials.scopes entries MUST be one of {${[...VALID_SCOPES].join(', ')}}, got: ${scope}`,
        ),
      ).toBe(true);
    }
  });

  it('rotation is one of {none, two-key-overlap} when present', async () => {
    const cred = await readCredentials();
    if (!cred?.supported || cred.rotation === undefined) return;
    expect(
      VALID_ROTATION.has(cred.rotation),
      driver.describe(
        'RFC 0046 §A',
        `capabilities.credentials.rotation MUST be one of {${[...VALID_ROTATION].join(', ')}}, got: ${cred.rotation}`,
      ),
    ).toBe(true);
  });
});
