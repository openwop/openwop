/**
 * v2 — a host rejecting at load a WASM pack whose ABI version it does not list
 * (`spec/v2/core/node-pack-runtimes.md` §WASM: "MUST reject at load a pack
 * whose `openwop_abi_version()` is not listed").
 *
 * The v1 twin, `wasm-pack-abi-version-rejection`, runs at major 1 only. Here the
 * operator offers the hand-written fixture pack at
 * `conformance/fixtures/wasm-packs/misbehaving-abi/` (`vendor.openwop.misbehaving-abi`,
 * ABI version 999) to the host's loader and advertises
 * `conformance-wasm-pack-abi-mismatch`. Loading is not a protocol operation, so
 * the leg reads what a rejection makes impossible: the pack in
 * `nodePackRuntimes.wasm.loadedPacks`, and its node completing.
 *
 * The leg lives in `lib/wasm-abi-reject-witness.ts`, proven against a double in
 * `lib/wasm-abi-reject-witness.test.ts`.
 *
 * Dispositions: no `nodePackRuntimes.wasm`, or the fixture not advertised ⇒
 * `inapplicable`; discovery unreachable or a 401/403/429/5xx at creation ⇒ `blocked`.
 *
 * @see spec/v2/core/node-pack-runtimes.md §WASM
 * @see RFCS/0008-wasm-abi.md §H
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { abiRejectLeg } from '../lib/wasm-abi-reject-witness.js';

describe('v2 WASM ABI rejection (node-pack-runtimes.md §WASM)', () => {
  it('a pack whose openwop_abi_version() is not listed is not loaded and its node never runs', async () => {
    const out = await abiRejectLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req('openwop.requirement.node-pack-runtimes.wasm-abi-reject', 'spec/v2/core/node-pack-runtimes.md §WASM', 'a host MUST reject at load a pack whose openwop_abi_version() is not listed')).toBe('');
  });
});
