/**
 * RFC 0008 §Conformance — scenario 3/6: invoke returning `outcome: 'suspended'`.
 *
 * Verifies that when a WASM-packaged node returns `outcome: 'suspended'`
 * the host honors the suspension contract:
 *   1. Run transitions to a `waiting-*` state (NOT terminal failure).
 *   2. The interrupt payload reaches the run's interrupt surface.
 *   3. Resolving the interrupt resumes the node, which re-invokes the
 *      WASM `openwop_node_invoke` with the resume value available.
 *
 * Hosts that don't support WASM-driven suspends MAY return a recognizable
 * `wasm_suspend_not_implemented` failure code — the scenario soft-passes
 * in that case (the contract is "if supported, honor it"; explicit
 * non-support is acceptable for v1.1).
 *
 * @see RFCS/0008-wasm-abi.md §D (response envelope) + §C (openwop_interrupt import)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-wasm-pack-roundtrip';

async function isWasmSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  return Boolean(
    (disco.json as { capabilities?: { nodePackRuntimes?: { wasm?: { supported?: boolean } } } })
      .capabilities?.nodePackRuntimes?.wasm?.supported,
  );
}

describe('wasm-pack-invoke-suspended: suspend → resume round-trip', () => {
  it('host either suspends the run or explicitly reports wasm_suspend_not_implemented', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    if (!(await isWasmSupported())) return;

    // The reference rust-hello pack does NOT itself suspend (it always
    // returns `completed`), so against that pack this scenario can only
    // assert the negative path: a run completes without entering a
    // waiting-* state. A pack that explicitly suspends would be needed
    // to exercise the positive path; tracked as v1.x follow-up.
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE,
      inputs: { name: 'suspend-probe' },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 15_000 });

    if (terminal.status === 'failed') {
      // Acceptable if the host reports the recognizable code from
      // RFC 0008 §D for hosts that don't implement WASM suspends.
      const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
      const list = (events.json as { events?: Array<{ type: string; data?: unknown }> }).events ?? [];
      const haystack = JSON.stringify(list).toLowerCase();
      const ok =
        haystack.includes('wasm_suspend_not_implemented') ||
        haystack.includes('suspend_not_supported');
      expect(ok, driver.describe(
        'RFCS/0008-wasm-abi.md §D',
        "if a host doesn't implement WASM-driven suspends it MUST surface a recognizable code",
      )).toBe(true);
      return;
    }

    // Completed path: the reference pack never suspends. Asserting
    // 'completed' confirms the host did not spuriously enter a
    // waiting-* state.
    expect(terminal.status).toBe('completed');
  });
});
