/**
 * mcp-server-elicitation-bridge — RFC 0020 advertisement-shape verification + behavioral placeholders.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0020 promoted to `Active`
 * 2026-05-17. The matching `capabilities.mcp.serverMount` block has landed in
 * `schemas/capabilities.schema.json`. This scenario asserts the advertisement
 * shape against any host that boots the conformance suite, and keeps the
 * deeper behavioral assertions as `it.todo()` until a reference host wires
 * a test seam.
 *
 * Summary: Inbound elicitation/create suspends the run on a typed form and resumes on accept/decline/cancel.
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

describe('mcp-server-elicitation-bridge: advertisement shape (RFC 0020)', () => {
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

  it('elicitationBridge is a boolean when set', async () => {
    const cap = await readCap();
    if (!cap || cap.supported !== true) return;
    const subParts = ["elicitationBridge"];
    let sub: unknown = cap;
    for (const p of subParts) {
      if (sub && typeof sub === 'object') sub = (sub as Record<string, unknown>)[p];
      else { sub = undefined; break; }
    }
    if (sub === undefined) return; // optional sub-field
    expect(
      typeof sub,
      driver.describe(
        'RFC 0020 §A',
        'mcp.serverMount.elicitationBridge MUST be boolean when present',
      ),
    ).toBe('boolean');
  });
});

describe('mcp-server-elicitation-bridge: behavioral assertions (placeholders — need host test seam)', () => {
  it.todo("elicitation/create with a flat schema suspends the run");
  it.todo("accept response resumes with payload; decline + cancel paths round-trip correctly");
});
