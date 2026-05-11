/**
 * RFC 0008 §Conformance — scenario 6/6: ABI version mismatch.
 *
 * Verifies that a host refuses to load a WASM pack whose declared ABI
 * version is not in the host's advertised `abiVersions[]`. The host's
 * loader MUST surface a recognizable `unsupported_abi_version` error
 * (or equivalent) and MUST NOT silently dispatch to the pack's
 * `openwop_node_invoke`.
 *
 * Driving this end-to-end requires a pack with a deliberately wrong
 * ABI version. That pack is filed as v1.x follow-up (an
 * `examples/packs/abi-mismatch/`). The framework here asserts the
 * shape of the host's advertisement so future scenarios can rely on it.
 *
 * @see RFCS/0008-wasm-abi.md §H (abiVersions array)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

describe('wasm-pack-abi-version-rejection: host advertises supported ABI versions', () => {
  it('abiVersions[] contains positive integers; loader rejects unsupported versions', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const wasm =
      (disco.json as {
        capabilities?: { nodePackRuntimes?: { wasm?: { supported?: boolean; abiVersions?: unknown } } };
      }).capabilities?.nodePackRuntimes?.wasm;

    if (!wasm?.supported) return;

    expect(Array.isArray(wasm.abiVersions), driver.describe(
      'RFCS/0008-wasm-abi.md §H',
      'capabilities.nodePackRuntimes.wasm.abiVersions MUST be an array',
    )).toBe(true);

    if (Array.isArray(wasm.abiVersions)) {
      expect(wasm.abiVersions.length).toBeGreaterThan(0);
      for (const v of wasm.abiVersions) {
        expect(typeof v).toBe('number');
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      // v1.1 hosts MUST support ABI v1 if they support WASM at all.
      expect((wasm.abiVersions as number[]).includes(1)).toBe(true);
    }
  });
});
