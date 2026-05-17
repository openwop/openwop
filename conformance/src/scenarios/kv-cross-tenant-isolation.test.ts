/**
 * kv-cross-tenant-isolation — RFC 0015 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0015 promoted to `Active`
 * 2026-05-17. The matching `capabilities.kvStorage` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: host.kvStorage MUST partition values by tenant. Cross-tenant reads MUST return not-found.
 *
 * Behavioral cross-tenant proof needs a two-tenant test seam; assertion stays it.todo() until a reference host exposes one.
 *
 * @see RFCS/0015-*.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["kvStorage"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('kv-cross-tenant-isolation: advertisement shape (RFC 0015)', () => {
  it('capabilities.kvStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §kvStorage',
        'capabilities.kvStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('kv-cross-tenant-isolation: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("set under tenant A → get under tenant B with same key returns found:false");
  it.todo("list under tenant B does not include keys set under tenant A");
});
