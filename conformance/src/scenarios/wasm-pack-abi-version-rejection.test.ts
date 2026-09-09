/**
 * RFC 0008 §Conformance — scenario 6/6: ABI version mismatch.
 *
 * Two-part scenario per RFCS/0008-wasm-abi.md §H (ABI version handshake):
 *
 *   1. **Discovery shape (observational, always-on)** — host advertises
 *      `capabilities.nodePackRuntimes.wasm.abiVersions[]` as a non-empty
 *      array of positive integers including v1.
 *   2. **Positive path (loadedPacks-gated)** — when the host advertises
 *      `capabilities.nodePackRuntimes.wasm.loadedPacks[]` AND lists the
 *      well-behaved reference pack (proving the loader pipeline runs),
 *      the misbehaving-abi pack at `examples/packs/rust-misbehaving-abi/`
 *      — which declares `openwop_abi_version() == 999` — MUST NOT
 *      appear in `loadedPacks[]`. ABI 999 is outside any host's
 *      `abiVersions[]`, so a conformant host MUST reject the pack at
 *      load time per RFC 0008 §H.
 *
 * The `loadedPacks[]` discovery field is the wire-observable signal:
 * load-time rejection happens before any node-invoke surface, so the
 * conformance suite needs a discovery-level affordance to verify the
 * rejection took effect. Hosts that don't advertise `loadedPacks[]`
 * soft-skip the positive path.
 *
 * @see RFCS/0008-wasm-abi.md §H (ABI version handshake)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const MISBEHAVING_PACK_NAME = 'vendor.openwop.misbehaving-abi';
const WELL_BEHAVED_PACK_NAME = 'vendor.openwop.rust-hello';

describe('wasm-pack-abi-version-rejection: host advertises supported ABI versions', () => {
  it('abiVersions[] contains positive integers; loader rejects unsupported versions', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const wasm =
      capabilityFamily<{ wasm?: Record<string, unknown> }>(disco.json, 'nodePackRuntimes')?.wasm;

    if (!wasm?.supported) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!wasm?.supported` returned early');

    expect(Array.isArray(wasm.abiVersions), req('openwop.it.wasm-pack-abi-version-rejection.abiversions-contains-positive-integers-loader-rejects-unsupported-versions', 
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

describe('wasm-pack-abi-version-rejection: positive path via misbehaving pack', () => {
  it('misbehaving-abi pack (declares ABI 999) MUST NOT appear in loadedPacks[]', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const wasm =
      capabilityFamily<{ wasm?: Record<string, unknown> }>(disco.json, 'nodePackRuntimes')?.wasm;

    if (!wasm?.supported) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!wasm?.supported` returned early');

    if (!Array.isArray(wasm.loadedPacks)) {
      // eslint-disable-next-line no-console
      console.warn(
        '[wasm-pack-abi-version-rejection] host does not advertise capabilities.nodePackRuntimes.wasm.loadedPacks[]; skipping positive path. ' +
          'Hosts MAY advertise loadedPacks[] to surface ABI rejection observably (RFC 0008 §H + Track 7).',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!Array.isArray(wasm.loadedPacks)` returned early');
    }

    // Soft-skip when the well-behaved reference pack isn't loaded. If
    // loadedPacks[] doesn't include rust-hello, we can't distinguish
    // "the loader pipeline runs but rejected misbehaving-abi" from
    // "the loader doesn't run at all on this host."
    if (!wasm.loadedPacks.includes(WELL_BEHAVED_PACK_NAME)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[wasm-pack-abi-version-rejection] reference pack ${WELL_BEHAVED_PACK_NAME} not in loadedPacks[]; ` +
          'skipping positive path (build examples/packs/rust-hello first or run against a host that ships it).',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!wasm.loadedPacks.includes(WELL_BEHAVED_PACK_NAME)` returned early');
    }

    // Core assertion: ABI 999 pack MUST NOT be in loadedPacks[]
    // regardless of filesystem state. The host's loader rejected it.
    expect(wasm.loadedPacks.includes(MISBEHAVING_PACK_NAME), req('openwop.it.wasm-pack-abi-version-rejection.misbehaving-abi-pack-declares-abi-999-must-not-appear-in-loadedpacks', 
      'RFCS/0008-wasm-abi.md §H',
      `host MUST reject packs whose declared ABI is not in abiVersions[]; ${MISBEHAVING_PACK_NAME} declares 999 and MUST NOT appear in loadedPacks[]`,
    )).toBe(false);
  });
});
