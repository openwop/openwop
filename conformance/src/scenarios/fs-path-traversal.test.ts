/**
 * fs-path-traversal — RFC 0014 §C invariant verification.
 *
 * Status: ACTIVE. RFC 0014 promoted to `Active` 2026-05-17. The
 * `capabilities.fs` block has landed in `schemas/capabilities.schema.json`
 * and the invariant row `fs-path-traversal` is in `SECURITY/invariants.yaml`.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.fs.supported = true`.
 *
 * What this scenario asserts:
 *   1. Advertisement shape — `capabilities.fs` is either absent or a
 *      well-formed object; when `supported: true`, `sandboxRoot` is
 *      non-empty (RFC 0014 §A).
 *   2. Path-traversal MUST-NOT — when the host exposes the optional
 *      `POST /v1/host/sample/fs/read` test seam, absolute paths outside
 *      the sandbox AND relative `../` escapes MUST be rejected with a
 *      4xx envelope whose `error.code` is in the canonical rejection set.
 *
 * Hosts without the test seam soft-skip the path-escape steps and still
 * assert the advertisement shape. This lets the suite pass against the
 * stricter hosts that don't expose any unauthenticated fs probe.
 *
 * @see RFCS/0014-host-fs-capability.md
 * @see SECURITY/invariants.yaml id: fs-path-traversal
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode } from '../lib/error-envelope.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryFs {
  supported?: boolean;
  sandboxRoot?: string;
  maxFileSizeBytes?: number;
}

interface DiscoveryDoc {
  capabilities?: {
    fs?: DiscoveryFs;
  };
}

async function readFs(): Promise<DiscoveryFs | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'fs') ?? null;
}

const PATH_REJECTION_CODES: ReadonlySet<string> = new Set([
  'path_outside_sandbox',
  'fs_path_traversal',
  'invalid_path',
]);

describe('fs-path-traversal: advertisement shape (RFC 0014 §A)', () => {
  it('capabilities.fs is either absent or well-formed', async () => {
    const fs = await readFs();
    if (fs === null) return; // host doesn't advertise fs at all
    expect(
      typeof fs.supported,
      driver.describe(
        'capabilities.schema.json §fs',
        'capabilities.fs.supported MUST be a boolean when fs is advertised',
      ),
    ).toBe('boolean');
  });

  it('fs.sandboxRoot is set + non-empty when fs.supported=true', async () => {
    const fs = await readFs();
    if (!fs?.supported) return;
    expect(
      typeof fs.sandboxRoot,
      driver.describe(
        'RFC 0014 §A',
        'capabilities.fs.sandboxRoot MUST be present when fs.supported=true',
      ),
    ).toBe('string');
    expect(
      (fs.sandboxRoot ?? '').length,
      driver.describe('RFC 0014 §A', 'capabilities.fs.sandboxRoot MUST NOT be empty'),
    ).toBeGreaterThan(0);
  });
});

describe('fs-path-traversal: MUST-NOT escape sandboxRoot (RFC 0014 §C)', () => {
  it('absolute path outside sandbox is rejected', async () => {
    const fs = await readFs();
    if (!fs?.supported) return;
    const res = await driver.post('/v1/host/sample/fs/read', { path: '/etc/passwd' });
    // 404 from a host that hasn't wired the test seam is a soft-skip.
    if (res.status === 404) return;
    expect(
      res.status,
      driver.describe(
        'SECURITY/invariants.yaml fs-path-traversal',
        'absolute paths outside sandboxRoot MUST be rejected with a 4xx envelope',
      ),
    ).toBeGreaterThanOrEqual(400);
    const code = readErrorCode(res.json);
    expect(
      code !== undefined && PATH_REJECTION_CODES.has(code),
      driver.describe(
        'SECURITY/invariants.yaml fs-path-traversal',
        `error.code MUST be one of {${[...PATH_REJECTION_CODES].join(', ')}}, got: ${code ?? '(absent)'}`,
      ),
    ).toBe(true);
  });

  it('relative ../ path escape is rejected', async () => {
    const fs = await readFs();
    if (!fs?.supported) return;
    const res = await driver.post('/v1/host/sample/fs/read', { path: '../../etc/passwd' });
    if (res.status === 404) return;
    expect(res.status).toBeGreaterThanOrEqual(400);
    const code = readErrorCode(res.json);
    expect(
      code !== undefined && PATH_REJECTION_CODES.has(code),
      driver.describe(
        'SECURITY/invariants.yaml fs-path-traversal',
        `error.code MUST be one of {${[...PATH_REJECTION_CODES].join(', ')}}, got: ${code ?? '(absent)'}`,
      ),
    ).toBe(true);
  });
});
