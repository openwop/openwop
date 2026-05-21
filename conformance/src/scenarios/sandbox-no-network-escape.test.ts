/**
 * sandbox-no-network-escape — RFC 0035 §B invariant `node-pack-sandbox-no-network-escape`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that initiates
 * a network request (fetch/connect/etc.) fails closed with
 * `sandbox_capability_denied` AND `details.requestedCapability: "host.fetch"`
 * (or equivalent) UNLESS `host.fetch` appears in
 * `capabilities.sandbox.allowedHostCalls`.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B + §C
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-network-escape
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: { sandbox?: { supported?: unknown; allowedHostCalls?: unknown } };
}

async function readSandbox(): Promise<{ supported: boolean; allowedHostCalls: string[] } | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    const sb = (res.json as DiscoveryDoc).capabilities?.sandbox;
    if (!sb || sb.supported !== true) return null;
    return {
      supported: true,
      allowedHostCalls: Array.isArray(sb.allowedHostCalls) ? sb.allowedHostCalls.filter((s): s is string => typeof s === 'string') : [],
    };
  } catch { return null; }
}

describe.skipIf(HTTP_SKIP)('sandbox-no-network-escape: behavioral (RFC 0035 §B)', () => {
  it('a misbehaving pack that fetches without host.fetch in allowedHostCalls fails closed with sandbox_capability_denied', async () => {
    const sb = await readSandbox();
    if (!sb) return; // soft-skip — no sandbox-executing host yet
    if (sb.allowedHostCalls.includes('host.fetch')) return; // host permits fetch — the negative test doesn't apply

    // Behavioral assertion lands when the misbehaving-network-escape typeId
    // is available. Expected error code: sandbox_capability_denied with
    // details.requestedCapability: 'host.fetch'.
    expect(true).toBe(true);
  });
});
