/**
 * table-schema-enforcement — RFC 0016 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0016 promoted to `Active`
 * 2026-05-17. The matching `capabilities.tableStorage` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: Subsequent rows MUST conform to the schema established on first insert.
 *
 * @see RFCS/0016-*.md
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
  const final = (top && typeof top === 'object') ? (top as Record<string, unknown>)["tableStorage"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('table-schema-enforcement: advertisement shape (RFC 0016)', () => {
  it('capabilities.tableStorage is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §tableStorage',
        'capabilities.tableStorage.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('table-schema-enforcement: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("first insert declares schema; subsequent insert with wrong column type is rejected");
});
