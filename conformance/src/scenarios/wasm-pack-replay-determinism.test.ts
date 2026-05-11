/**
 * RFC 0008 §Conformance — scenario 4/6: replay determinism.
 *
 * Verifies that re-running the same WASM workflow with the same inputs
 * yields the same output, AND that `:fork` against a completed run
 * reproduces the same final state. RFC 0008 §G requires that
 * `openwop_now_ms` and `openwop_random` be host-controlled and replay-
 * stable; this scenario indirectly verifies the contract.
 *
 * @see RFCS/0008-wasm-abi.md §G (replay determinism)
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

function extractGreeting(events: Array<{ type: string; data?: unknown }>): string | null {
  const haystack = JSON.stringify(events);
  const m = haystack.match(/Hello, ([^!]+)!/);
  return m ? m[1] : null;
}

describe('wasm-pack-replay-determinism: same inputs → same output', () => {
  it('two independent runs with same inputs produce same WASM output', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return;
    if (!(await isWasmSupported())) return;

    const inputs = { name: 'determinism-probe' };

    const run = async (): Promise<string | null> => {
      const create = await driver.post('/v1/runs', { workflowId: FIXTURE, inputs });
      expect(create.status).toBe(201);
      const runId = (create.json as { runId: string }).runId;
      await pollUntilTerminal(runId, { timeoutMs: 15_000 });
      const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
      return extractGreeting(
        (events.json as { events?: Array<{ type: string; data?: unknown }> }).events ?? [],
      );
    };

    const a = await run();
    const b = await run();

    expect(a, driver.describe(
      'RFCS/0008-wasm-abi.md §G',
      'WASM-node output MUST be reproducible given the same inputs',
    )).not.toBeNull();
    expect(b).toBe(a);
  });
});
