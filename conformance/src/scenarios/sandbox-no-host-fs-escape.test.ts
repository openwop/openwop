/**
 * sandbox-no-host-fs-escape — RFC 0035 §B invariant `node-pack-sandbox-no-host-fs-escape`.
 *
 * Capability-gated on `capabilities.sandbox.supported: true`. Hosts that
 * don't advertise sandbox soft-skip cleanly (no host yet serves a
 * sandbox-executing pack runtime — the invariant graduates from
 * reference-impl to protocol tier when one does, per
 * `SECURITY/invariants.yaml node-pack-sandbox-no-host-fs-escape`).
 *
 * Asserts (behavioral when host advertises): a pack from the synthetic
 * `vendor.openwop.misbehaving-sandbox` registry that attempts to read or
 * write files outside the host-advertised sandbox root fails closed with
 * `error.code: "sandbox_escape_attempt"` and `details.escapeKind: "host-fs-escape"`
 * per RFC 0035 §C.
 *
 * Today's scenario lands the advertisement-shape probe + the capability-gated
 * behavioral stub. The behavioral assertion exercises the synthetic
 * misbehaving-fs pack against the host's pack loader; that pack lands in a
 * follow-up commit when the first sandbox-executing reference host is
 * available.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B (failure-mode invariant table)
 * @see spec/v1/host-capabilities.md §"Sandbox execution contract (RFC 0035)"
 * @see SECURITY/invariants.yaml node-pack-sandbox-no-host-fs-escape
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface SandboxCaps {
  supported?: unknown;
  isolationModel?: unknown;
  allowedHostCalls?: unknown;
  memoryLimitBytes?: unknown;
  wallClockLimitMs?: unknown;
}

interface DiscoveryDoc {
  capabilities?: { sandbox?: SandboxCaps };
}

async function readSandboxCaps(): Promise<SandboxCaps | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return capabilityFamily((res.json as DiscoveryDoc), 'sandbox') ?? null;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('sandbox-no-host-fs-escape: capability shape (RFC 0035 §A)', () => {
  it('capabilities.sandbox (when present) conforms to RFC 0035 §A', async () => {
    const sb = await readSandboxCaps();
    if (sb === null) return softSkip('inapplicable', 'host omits the block — soft-skip cleanly (sb === null)');

    expect(typeof sb.supported, 'capabilities.sandbox.supported MUST be boolean when present').toBe('boolean');

    if (sb.supported === true) {
      const m = sb.isolationModel as string;
      const isCategorical = m === 'wasm' || m === 'process' || m === 'container' || m === 'vm';
      const isExtension = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(m);
      expect(
        isCategorical || isExtension,
        driver.describe(
          'RFCS/0035-sandbox-execution-contract.md §A',
          'isolationModel MUST be one of {wasm, process, container, vm} OR match ^x-host-<host>-<key>$ pattern',
        ),
      ).toBe(true);
    }
  });
});

// Behavioral assertion lands when the vendor.openwop.misbehaving-sandbox
// synthetic pack ships + a host advertises capabilities.sandbox.supported.
// Expected wire shape:
//   POST /v1/host/sample/test/sandbox-load { packId: 'vendor.openwop.misbehaving-sandbox' }
//   → 200 OK
//   POST /v1/host/sample/test/sandbox-invoke { typeId: 'misbehave.fs-escape-read', args: { path: '/etc/passwd' } }
//   → response.error.code === 'sandbox_escape_attempt'
//   → response.error.details.escapeKind === 'host-fs-escape'
// Surfaced as `todo` so test reporters track the gap rather than reporting
// a vacuous PASS.
describe('sandbox-no-host-fs-escape: behavioral (RFC 0035 §B node-pack-sandbox-no-host-fs-escape)', () => {
  // Behavioral coverage lives in `sandbox-mvp-behavior.test.ts` §"host-fs-escape"
  // (the consolidated file drives the workflow-engine's
  // `POST /v1/host/sample/test/sandbox-invoke` seam for ALL 7 RFC 0035 §B
  // invariants in one place to avoid per-file seam-setup duplication and to
  // exercise a single canonical 4-code error catalog). Kept this block as
  // `it.skip` to preserve the per-invariant file structure (so a future host
  // that opts into per-file probing has the slot ready) without inflating the
  // `it.todo` count external auditors track.
  it.skip('behavioral coverage in sandbox-mvp-behavior.test.ts §"host-fs-escape"');
});
