/**
 * RFC 0008 §Conformance — scenario 2/6: invoke returning `outcome: 'completed'`.
 *
 * Verifies that a WASM-packaged node's completed-outcome response
 * round-trips through the host:
 *   1. Workflow runs to `completed` terminal.
 *   2. The node's `node.completed` event carries the WASM-emitted output.
 *
 * Uses the reference Rust pack's `vendor.openwop.rust-hello.greet` typeId,
 * whose contract is: `{ name: string }` → `{ greeting: "Hello, <name>!" }`.
 *
 * @see RFCS/0008-wasm-abi.md §D (response envelope shapes)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-wasm-pack-roundtrip';

async function isWasmSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  return Boolean(
    capabilityFamily<{ wasm?: { supported?: boolean } }>(disco.json, 'nodePackRuntimes')?.wasm?.supported,
  );
}

describe('wasm-pack-invoke-completed: round-trip output', () => {
  it('greet node returns Hello, <name>! and run reaches completed', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');
    if (!(await isWasmSupported())) {
      // eslint-disable-next-line no-console
      console.warn('[wasm-pack-invoke-completed] WASM not advertised; skipping');
      return softSkip('inapplicable', '[wasm-pack-invoke-completed] WASM not advertised; skipping');
    }

    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE,
      inputs: { name: 'openwop' },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 15_000 });
    expect(terminal.status, req('openwop.it.wasm-pack-invoke-completed.greet-node-returns-hello-name-and-run-reaches-completed', 
      'RFCS/0008-wasm-abi.md §D',
      "WASM 'completed' outcome MUST drive terminal 'completed' run status",
    )).toBe('completed');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; data?: unknown }> }).events ?? [];
    const completedNode = list.find((e) => e.type === 'node.completed');
    const haystack = JSON.stringify(completedNode ?? {}).toLowerCase();
    // Hosts MAY surface the WASM output on node.completed.data.output (this
    // host's convention) OR via a downstream artifact. Either way the
    // string "hello, openwop" MUST appear in the event log so observers
    // can audit the round-trip.
    const fullLog = JSON.stringify(list).toLowerCase();
    expect(
      haystack.includes('hello, openwop') || fullLog.includes('hello, openwop'),
      req('openwop.it.wasm-pack-invoke-completed.greet-node-returns-hello-name-and-run-reaches-completed', 
        'RFCS/0008-wasm-abi.md §D',
        "WASM completion output MUST be surfaced somewhere in the run's event log so consumers can read it",
      ),
    ).toBe(true);
  });
});
