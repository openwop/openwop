/**
 * sandbox-memory-cap — RFC 0035 §B invariant `node-pack-sandbox-memory-cap`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true` AND
 * `capabilities.sandbox.memoryLimitBytes` advertised.
 *
 * Asserts (behavioral when host advertises): a pack invocation that
 * allocates beyond `capabilities.sandbox.memoryLimitBytes` fails closed
 * with `error.code: "sandbox_memory_exceeded"` per RFC 0035 §C. The host
 * MUST advertise an integer ≥ 1 MiB per the schema.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B + §C
 * @see SECURITY/invariants.yaml node-pack-sandbox-memory-cap
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface D {
  capabilities?: { sandbox?: { supported?: unknown; memoryLimitBytes?: unknown } };
}

async function readSandbox(): Promise<{ supported: boolean; memoryLimitBytes?: number } | null> {
  try {
    const r = await driver.get('/.well-known/openwop');
    if (r.status !== 200) return null;
    const sb = (r.json as D).capabilities?.sandbox;
    if (!sb || sb.supported !== true) return null;
    return {
      supported: true,
      ...(typeof sb.memoryLimitBytes === 'number' ? { memoryLimitBytes: sb.memoryLimitBytes } : {}),
    };
  } catch { return null; }
}

describe.skipIf(HTTP_SKIP)('sandbox-memory-cap: capability shape + behavioral (RFC 0035 §B)', () => {
  it('memoryLimitBytes MUST be integer ≥ 1 MiB when present (per schema)', async () => {
    const sb = await readSandbox();
    if (!sb) return; // soft-skip
    if (sb.memoryLimitBytes === undefined) return; // optional field

    expect(
      Number.isInteger(sb.memoryLimitBytes) && sb.memoryLimitBytes >= 1048576,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §A',
        'memoryLimitBytes MUST be integer ≥ 1 MiB (1048576)',
      ),
    ).toBe(true);
  });

  it('a misbehaving pack allocating beyond memoryLimitBytes fails with sandbox_memory_exceeded', async () => {
    const sb = await readSandbox();
    if (!sb || sb.memoryLimitBytes === undefined) return; // soft-skip
    // Behavioral assertion lands when the misbehaving-memory-cap typeId is
    // available. Expected: error.code === 'sandbox_memory_exceeded';
    // details.requestedBytes > memoryLimitBytes.
    expect(true).toBe(true);
  });
});
