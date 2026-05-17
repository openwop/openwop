/**
 * mcp-server-untrusted-args — RFC 0020 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0020 promoted to `Active`
 * 2026-05-17. The matching `capabilities.mcp.serverMount` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: tools/call.arguments MUST validate against the declared inputSchema before workflow start.
 *
 * @see RFCS/0020-*.md
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
  const cur = (top && typeof top === 'object') ? (top as Record<string, unknown>)["mcp"] : undefined;
  const final = (cur && typeof cur === 'object') ? (cur as Record<string, unknown>)["serverMount"] : undefined;
  return (final && typeof final === 'object' ? (final as Record<string, unknown>) : null);
}

describe('mcp-server-untrusted-args: advertisement shape (RFC 0020)', () => {
  it('capabilities.mcp.serverMount is either absent or a well-formed object', async () => {
    const cap = await readCap();
    if (cap === null) return; // host doesn't advertise — skip
    expect(
      typeof cap.supported,
      driver.describe(
        'capabilities.schema.json §mcp.serverMount',
        'capabilities.mcp.serverMount.supported MUST be a boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('mcp-server-untrusted-args: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("tools/call with arguments missing a required field is rejected with isError:true");
  it.todo("tools/call with arguments containing wrong types is rejected before the run starts");
});
