/**
 * RFC 0008 §Conformance — scenario 1/6: pack load + identity.
 *
 * Verifies that a host advertising `capabilities.nodePackRuntimes.wasm.supported: true`:
 *   1. Loads a signed WASM pack at startup or on-demand.
 *   2. Surfaces the pack's typeIds for dispatch.
 *   3. Reports the loaded pack's name + ABI version via discovery.
 *
 * Hosts that don't advertise WASM support skip this scenario.
 *
 * @see RFCS/0008-wasm-abi.md §B (required exports)
 * @see RFCS/0008-wasm-abi.md §H (capability advertisement)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const FIXTURE = 'conformance-wasm-pack-roundtrip';

interface WasmCaps {
  supported?: boolean;
  abiVersions?: number[];
  engine?: string;
  engineVersion?: string;
}

async function getWasmCaps(): Promise<WasmCaps | null> {
  const disco = await driver.get('/.well-known/openwop');
  const caps =
    capabilityFamily<{ wasm?: WasmCaps }>(disco.json, 'nodePackRuntimes')?.wasm ?? null;
  return caps;
}

describe('wasm-pack-load: discovery surfaces WASM runtime support', () => {
  it('a host claiming WASM support advertises abiVersions including 1', async () => {
    const wasm = await getWasmCaps();
    if (!wasm?.supported) {
      // eslint-disable-next-line no-console
      console.warn('[wasm-pack-load] host does not advertise WASM support; skipping');
      return softSkip('inapplicable', '[wasm-pack-load] host does not advertise WASM support; skipping');
    }
    expect(Array.isArray(wasm.abiVersions), driver.describe(
      'RFCS/0008-wasm-abi.md §H',
      'capabilities.nodePackRuntimes.wasm.abiVersions MUST be an array',
    )).toBe(true);
    expect(wasm.abiVersions?.includes(1), driver.describe(
      'RFCS/0008-wasm-abi.md §H',
      'abiVersions MUST include 1 (this RFC) when supported',
    )).toBe(true);
  });
});

describe('wasm-pack-load: loaded pack typeIds are dispatchable', () => {
  it('host accepts a workflow whose node typeId is provided by a loaded WASM pack', async () => {
    const wasm = await getWasmCaps();
    if (!wasm?.supported) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!wasm?.supported` returned early');
    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(`[wasm-pack-load] fixture ${FIXTURE} not advertised; skipping`);
      return softSkip('inapplicable', '[wasm-pack-load] fixture … not advertised; skipping');
    }
    // Creating a run against the fixture proves the host knows about the
    // WASM-provided typeId. A host that loaded the pack accepts the
    // POST /v1/runs; one that didn't would return 400/404.
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE, inputs: { name: 'world' } });
    expect(create.status, driver.describe(
      'RFCS/0008-wasm-abi.md §B + node-packs.md §Reserved typeIds',
      'host MUST accept runs whose nodes reference loaded-pack typeIds',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, { reason: 'conformance-cleanup' });
  });
});
