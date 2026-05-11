/**
 * RFC 0008 §Conformance — scenario 5/6: memory cap enforcement.
 *
 * Verifies that a host enforces `capabilities.nodePackRuntimes.wasm.maxMemoryBytes`
 * by trapping (or otherwise terminating) a module that exceeds the cap
 * and emitting `cap.breached` with `kind: 'wasm-memory'`.
 *
 * The reference rust-hello pack is well-behaved and does not allocate
 * excessively, so this scenario is OBSERVATIONAL: it asserts the cap
 * is *declared* (the protocol requires it) and that if the host
 * advertises a value, the value is plausible.
 *
 * Driving a real OOM requires a deliberately misbehaving pack. Such a
 * pack is filed as v1.x follow-up; the framework lives here.
 *
 * @see RFCS/0008-wasm-abi.md §K (resource limits)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

describe('wasm-pack-memory-cap: host advertises maxMemoryBytes', () => {
  it('capabilities.nodePackRuntimes.wasm.maxMemoryBytes is a plausible number', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const wasm =
      (disco.json as {
        capabilities?: { nodePackRuntimes?: { wasm?: { supported?: boolean; maxMemoryBytes?: unknown } } };
      }).capabilities?.nodePackRuntimes?.wasm;

    if (!wasm?.supported) return;

    // The cap is REQUIRED to enforce §K. Hosts MUST surface the configured
    // ceiling so clients can size their packs accordingly.
    expect(typeof wasm.maxMemoryBytes, driver.describe(
      'RFCS/0008-wasm-abi.md §K',
      'capabilities.nodePackRuntimes.wasm.maxMemoryBytes MUST be advertised as a number when WASM is supported',
    )).toBe('number');
    if (typeof wasm.maxMemoryBytes === 'number') {
      expect(wasm.maxMemoryBytes).toBeGreaterThanOrEqual(1024 * 1024); // ≥ 1 MiB
      expect(wasm.maxMemoryBytes).toBeLessThanOrEqual(8 * 1024 * 1024 * 1024); // ≤ 8 GiB
    }
  });
});
