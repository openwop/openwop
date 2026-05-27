/**
 * MCP-1 invariant: tool-call arguments + result content NEVER appear
 * on emitted event payloads.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.mcpClient.supported = true`.
 *
 * The test does NOT actually invoke an MCP tool (that requires the
 * host to be wired to a real MCP server, which is deployment-specific
 * and outside the conformance suite's environmental contract). What
 * it verifies is the SHAPE of the host's mcpClient advertisement +
 * the trust-boundary marker. The redaction invariant is then verified
 * end-to-end by the host's own in-process test (`mcp-client.test.ts`)
 * which DOES drive a fake MCP server and asserts no raw args/results
 * appear on the sanitized summary.
 *
 * @see SECURITY/invariants.yaml id: mcp-toolcall-payload-redaction
 * @see spec/v1/host-capabilities.md §host.mcp
 * @see SECURITY/threat-model-prompt-injection.md §"UNTRUSTED marker"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

async function isMcpClientSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = (disco.json as { capabilities?: { mcpClient?: { supported?: boolean } } })
    .capabilities;
  return caps?.mcpClient?.supported === true;
}

describe('mcp-toolcall-redaction: capability advertisement contract', () => {
  it('host advertising mcpClient MUST declare trustBoundary: "untrusted"', async () => {
    if (!(await isMcpClientSupported())) {
      // eslint-disable-next-line no-console
      console.warn('[mcp-toolcall-redaction] host does not advertise mcpClient; skipping');
      return;
    }
    const disco = await driver.get('/.well-known/openwop');
    const cap = capabilityFamily((disco.json as {
      capabilities?: {
        mcpClient?: { supported?: boolean; transports?: unknown; trustBoundary?: string };
      };
    }), 'mcpClient');

    expect(cap?.supported, driver.describe(
      'host-capabilities.md §host.mcp',
      'mcpClient.supported MUST be a boolean',
    )).toBe(true);

    expect(Array.isArray(cap?.transports), driver.describe(
      'host-capabilities.md §host.mcp',
      'mcpClient.transports MUST be an array of transport identifiers',
    )).toBe(true);

    // threat-model-prompt-injection.md §"UNTRUSTED marker": MCP tool
    // output is by spec untrusted (it can carry adversarial content).
    // Hosts advertising mcpClient MUST encode the boundary in the
    // capability so downstream consumers (LLM nodes) treat the
    // content accordingly.
    expect(cap?.trustBoundary, driver.describe(
      'SECURITY/threat-model-prompt-injection.md §"UNTRUSTED marker"',
      'mcpClient.trustBoundary MUST be "untrusted" — downstream LLM nodes treat tool content as user data',
    )).toBe('untrusted');
  });
});
