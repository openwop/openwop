/**
 * blob-cross-tenant-isolation — RFC 0019 §B point 1.
 *
 * Status: ACTIVE (advertisement + behavioral). Asserts that blobs put
 * under tenant A MUST NOT be retrievable under tenant B at the same key.
 *
 * @see RFCS/0019-host-blob-cache-capability.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["blobStorage"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

async function call(tenantId: string, op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId, surface: 'blob', op, args });
}

describe('blob-cross-tenant-isolation: advertisement shape (RFC 0019)', () => {
  it('capabilities.blobStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return;
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §blobStorage',
        'capabilities.blobStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('blob-cross-tenant-isolation: behavioral (RFC 0019 §B point 1)', () => {
  it('put under tenant A → get under tenant B with same key returns found:false', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const key = `xtenant-blob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const putRes = await call('tenant-a', 'put', {
      bucket: 'default',
      key,
      contentBase64: Buffer.from('from-A').toString('base64'),
      contentType: 'text/plain',
    });
    if (putRes.status === 404) return;
    expect(putRes.status, 'put MUST succeed').toBe(200);

    const getRes = await call('tenant-b', 'get', { bucket: 'default', key });
    expect(getRes.status).toBe(200);
    const body = getRes.json as { found?: boolean };
    expect(
      body.found,
      driver.describe('RFC 0019 §B point 1', 'tenant B MUST NOT retrieve tenant A blob at same key'),
    ).toBe(false);
  });
});
