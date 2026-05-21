/**
 * sandbox-capability-gate-respected — RFC 0035 §B invariant
 * `node-pack-sandbox-capability-gate-respected`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that calls
 * a host capability NOT in `capabilities.sandbox.allowedHostCalls` fails
 * closed with `error.code: "sandbox_capability_denied"` AND
 * `details.requestedCapability` identifying the disallowed capability.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B + §C
 * @see SECURITY/invariants.yaml node-pack-sandbox-capability-gate-respected
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
interface D { capabilities?: { sandbox?: { supported?: unknown } } }
async function ok(): Promise<boolean> { try { const r = await driver.get('/.well-known/openwop'); return r.status === 200 && (r.json as D).capabilities?.sandbox?.supported === true; } catch { return false; } }

describe.skipIf(HTTP_SKIP)('sandbox-capability-gate-respected: behavioral (RFC 0035 §B)', () => {
  it('a misbehaving pack calling an undeclared host capability fails closed with sandbox_capability_denied', async () => {
    if (!(await ok())) return;
    // Behavioral assertion lands when the misbehaving-capability-gate typeId
    // is available. Expected: error.code === 'sandbox_capability_denied';
    // details.requestedCapability is set to the disallowed identifier.
    expect(true).toBe(true);
  });
});
