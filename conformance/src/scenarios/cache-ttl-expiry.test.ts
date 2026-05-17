/**
 * cache-ttl-expiry — RFC 0019 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0019 promoted to `Active`
 * 2026-05-17. The matching `capabilities.cache` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: Cache TTL honored with at most 1-second drift.
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["cache"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('cache-ttl-expiry: advertisement shape (RFC 0019)', () => {
  it('capabilities.cache is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §cache',
        'capabilities.cache.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('cache-ttl-expiry: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("put with ttl=2 → hit within window; miss after");
});
