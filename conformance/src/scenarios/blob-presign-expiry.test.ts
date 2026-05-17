/**
 * blob-presign-expiry — RFC 0019 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0019 promoted to `Active`
 * 2026-05-17. The matching `capabilities.blobStorage` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: Presigned URLs MUST expire at the advertised TTL.
 *
 * @see RFCS/0019-*.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
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

describe('blob-presign-expiry: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("presign with ttl=60 → URL works during the window, returns 403 after");
});
