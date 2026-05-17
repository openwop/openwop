/**
 * vector-knn-roundtrip — RFC 0018 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0018 promoted to `Active`
 * 2026-05-17. The matching `capabilities.vectorStore` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: upsert then query returns the same vectors in top-k order.
 *
 * @see RFCS/0018-*.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["vectorStore"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('vector-knn-roundtrip: advertisement shape (RFC 0018)', () => {
  it('capabilities.vectorStore is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §vectorStore',
        'capabilities.vectorStore.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('vector-knn-roundtrip: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("upsert 10 vectors → query with one of them returns it as top-1");
  it.todo("topK respects the configured limit");
});
