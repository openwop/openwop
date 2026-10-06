/**
 * v2 — a host enforcing its advertised WASM memory ceiling
 * (`spec/v2/core/node-pack-runtimes.md` §WASM: "When it advertises
 * `maxMemoryBytes` it MUST enforce it and emit `cap.breached` with
 * `kind: "wasm-memory"` on a breach").
 *
 * The v1 twin, `wasm-pack-memory-cap`, runs at major 1 only and needed a
 * Rust-built pack. Here the operator installs the hand-written fixture pack at
 * `conformance/fixtures/wasm-packs/misbehaving-memory/` (`vendor.openwop.misbehaving`,
 * node `vendor.openwop.misbehaving.memory-bomb`, which grows memory until the
 * host refuses) and advertises `conformance-wasm-pack-memory-cap-breach`.
 *
 * The leg lives in `lib/wasm-memory-cap-witness.ts`, proven against a double in
 * `lib/wasm-memory-cap-witness.test.ts`.
 *
 * Dispositions: no `nodePackRuntimes.wasm`, no `maxMemoryBytes`, or the fixture
 * not advertised ⇒ `inapplicable`.
 *
 * @see spec/v2/core/node-pack-runtimes.md §WASM
 * @see RFCS/0008-wasm-abi.md §K
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { memoryCapLeg } from '../lib/wasm-memory-cap-witness.js';

describe('v2 WASM memory ceiling (node-pack-runtimes.md §WASM)', () => {
  it('a module exceeding maxMemoryBytes produces cap.breached wasm-memory and fails the run', async () => {
    const out = await memoryCapLeg();
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    expect(out.findings.join('; '), req('openwop.requirement.node-pack-runtimes.wasm-memory-cap', 'spec/v2/core/node-pack-runtimes.md §WASM', 'a host advertising maxMemoryBytes MUST enforce it and emit cap.breached with kind wasm-memory on a breach')).toBe('');
  });
});
