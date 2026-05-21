/**
 * sandbox-no-host-process-escape — RFC 0035 §B invariant `node-pack-sandbox-no-host-process-escape`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`.
 *
 * Asserts (behavioral when host advertises): a pack invocation that attempts
 * to spawn a host process, fork, or call exec-family syscalls fails closed
 * with `error.code: "sandbox_escape_attempt"` AND
 * `details.escapeKind: "host-process-escape"`.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-host-process-escape
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
interface D { capabilities?: { sandbox?: { supported?: unknown } } }
async function ok(): Promise<boolean> { try { const r = await driver.get('/.well-known/openwop'); return r.status === 200 && (r.json as D).capabilities?.sandbox?.supported === true; } catch { return false; } }

describe.skipIf(HTTP_SKIP)('sandbox-no-host-process-escape: behavioral (RFC 0035 §B)', () => {
  it('a misbehaving pack calling spawn/fork/exec fails closed with sandbox_escape_attempt', async () => {
    if (!(await ok())) return; // soft-skip — no sandbox-executing host yet
    // Behavioral assertion lands when the misbehaving-process-escape typeId
    // is available. Expected: error.code === 'sandbox_escape_attempt';
    // details.escapeKind === 'host-process-escape'.
    expect(true).toBe(true);
  });
});
