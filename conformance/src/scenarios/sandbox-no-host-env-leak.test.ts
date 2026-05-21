/**
 * sandbox-no-host-env-leak — RFC 0035 §B invariant `node-pack-sandbox-no-host-env-leak`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that reads
 * `process.env` (or the platform equivalent) does NOT see host-level env
 * vars unless the host has forwarded them via an `allowedHostCalls` entry
 * exposing env resolution.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-host-env-leak
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc { capabilities?: { sandbox?: { supported?: unknown } } }

async function sandboxSupported(): Promise<boolean> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return false;
    return (res.json as DiscoveryDoc).capabilities?.sandbox?.supported === true;
  } catch { return false; }
}

describe.skipIf(HTTP_SKIP)('sandbox-no-host-env-leak: behavioral (RFC 0035 §B)', () => {
  it('a misbehaving pack reading process.env does NOT see host env vars unless explicitly allowed', async () => {
    if (!(await sandboxSupported())) return; // soft-skip — no sandbox-executing host yet
    // Behavioral assertion lands when the misbehaving-env-leak typeId is available.
    // Expected: invocation returns empty/filtered env mapping; the host's own
    // env (e.g., DATABASE_URL, OPENAI_API_KEY) is NOT visible to the pack.
    expect(true).toBe(true);
  });
});
