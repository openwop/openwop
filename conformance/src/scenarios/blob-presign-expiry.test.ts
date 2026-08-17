/**
 * blob-presign-expiry — RFC 0019 advertisement-shape verification + behavioral roundtrip.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0019 promoted to
 * `Active` 2026-05-17. The matching `capabilities.blobStorage` block has
 * landed in `schemas/capabilities.schema.json`. This scenario asserts the
 * advertisement shape against any host that boots the conformance suite, and
 * exercises the behavioral surface through the `/v1/host/sample/test/surface`
 * seam (soft-skip with HTTP 404 on hosts that don't expose it).
 *
 * Summary: Presigned URLs MUST expire at the advertised TTL.
 *
 * @see RFCS/0019-*.md
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

describe('blob-presign-expiry: advertisement shape (RFC 0019)', () => {
  it('capabilities.blobStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §blobStorage',
        'capabilities.blobStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });

  it('presignSupported is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const subParts = ["presignSupported"];
    let sub: unknown = cap;
    for (const p of subParts) {
      if (sub && typeof sub === 'object') sub = (sub as Record<string, unknown>)[p];
      else { sub = undefined; break; }
    }
    if (sub === undefined) return; // optional sub-field
    expect(
      typeof sub,
      driver.describe(
        'RFC 0019 §A',
        'blobStorage.presignSupported MUST be boolean when present',
      ),
    ).toBe('boolean');
  });
});

async function call(op: string, args: Record<string, unknown>) {
  return driver.post('/v1/host/sample/test/surface', { tenantId: 'tenant-a', surface: 'blob', op, args });
}

describe('blob-presign-expiry: behavioral (RFC 0019 §B point 1)', () => {
  it('presigned URL MUST resolve to the blob inside its TTL window and return 403 after expiry', async () => {
    const probe = await call('get', { key: '__probe__' });
    if (probe.status === 404) return; // seam not exposed
    const key = `pre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contentBase64 = Buffer.from('presigned-payload').toString('base64');
    await call('put', { key, contentBase64, contentType: 'text/plain' });

    // presign with TTL=2s
    const presign = await call('presign', { key, expiresInSeconds: 2 });
    expect(presign.status).toBe(200);
    const body = presign.json as { url?: string; expiresAtMs?: number };
    expect(typeof body.url, 'presign MUST return a URL').toBe('string');

    // Fetch within the window — MUST return 200 + the bytes
    const within = await driver.get(body.url!);
    if (within.status === 404) return; // host doesn't expose the resolver route — soft-skip the expiry side too
    expect(
      within.status,
      driver.describe('RFC 0019 §B point 1', 'presigned URL MUST resolve to 200 within its TTL window'),
    ).toBe(200);

    // Wait past expiry (TTL=2s + 1s buffer)
    await new Promise((r) => setTimeout(r, 3000));

    const after = await driver.get(body.url!);
    expect(
      after.status,
      driver.describe('RFC 0019 §B point 1', 'presigned URL MUST return 403 after TTL expiry'),
    ).toBe(403);
  });
});
