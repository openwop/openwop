/**
 * blob-roundtrip — RFC 0019 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0019 promoted to `Active`
 * 2026-05-17. The matching `capabilities.blobStorage` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: put then get returns the same content + size + etag.
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

describe('blob-roundtrip: advertisement shape (RFC 0019)', () => {
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
});

describe('blob-roundtrip: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("put binary content → get returns identical bytes");
  it.todo("get of non-existent key returns found:false");
});
