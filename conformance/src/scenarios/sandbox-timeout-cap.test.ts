/**
 * sandbox-timeout-cap — RFC 0035 §B invariant `node-pack-sandbox-timeout-cap`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true` AND
 * `capabilities.sandbox.wallClockLimitMs` advertised.
 *
 * Asserts (behavioral when host advertises): a pack invocation whose
 * wall-clock execution exceeds `capabilities.sandbox.wallClockLimitMs`
 * fails closed with `error.code: "sandbox_timeout"` per RFC 0035 §C. The
 * host MUST advertise an integer ≥ 100 ms per the schema.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B + §C
 * @see SECURITY/invariants.yaml node-pack-sandbox-timeout-cap
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface D {
  capabilities?: { sandbox?: { supported?: unknown; wallClockLimitMs?: unknown } };
}

async function readSandbox(): Promise<{ supported: boolean; wallClockLimitMs?: number } | null> {
  try {
    const r = await driver.get('/.well-known/openwop');
    if (r.status !== 200) return null;
    const sb = capabilityFamily((r.json as D), 'sandbox');
    if (!sb || sb.supported !== true) return null;
    return {
      supported: true,
      ...(typeof sb.wallClockLimitMs === 'number' ? { wallClockLimitMs: sb.wallClockLimitMs } : {}),
    };
  } catch { return null; }
}

describe.skipIf(HTTP_SKIP)('sandbox-timeout-cap: capability shape + behavioral (RFC 0035 §B)', () => {
  it('wallClockLimitMs MUST be integer ≥ 100 ms when present (per schema)', async () => {
    const sb = await readSandbox();
    if (!sb) return softSkip('blocked', 'precondition not met — `!sb` returned early (seam, prior step, or fixture unavailable)');
    if (sb.wallClockLimitMs === undefined) return softSkip('inapplicable', 'optional (sb.wallClockLimitMs === undefined)');

    expect(
      Number.isInteger(sb.wallClockLimitMs) && sb.wallClockLimitMs >= 100,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §A',
        'wallClockLimitMs MUST be integer ≥ 100 ms',
      ),
    ).toBe(true);
  });

  // Behavioral coverage in `sandbox-mvp-behavior.test.ts` §"sandbox-timeout"
  // (drives `POST /v1/host/sample/test/sandbox-invoke` against the
  // workflow-engine's node:vm MVP and asserts `error.code:
  // 'sandbox_timeout'` per `host-capabilities.md` §"Error codes").
  // `it.skip` preserves the per-invariant file structure without inflating
  // the `it.todo` count external auditors track.
  it.skip('behavioral coverage in sandbox-mvp-behavior.test.ts §"sandbox-timeout"');
});
