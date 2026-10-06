/**
 * The operator-installed WASM fixture packs (`conformance/fixtures/wasm-packs/`)
 * are what their manifests say they are. Each module compiles, exports the RFC
 * 0008 §B functions, reports the pack name and node typeId its v2 manifest
 * declares, and reports the ABI version the pack exists to test (a v2 manifest
 * carries none). The memory bomb's `invoke` is not run here: it grows memory
 * until the runtime refuses, which is the host's job to stop.
 *
 * Corpus-only (it reads no host), so it lives in `src/coherence/` and never in a
 * host bundle (`spec/v2/core/conformance.md` §Two products).
 *
 * @see spec/v2/core/node-pack-runtimes.md §WASM
 * @see RFCS/0008-wasm-abi.md §B, §K
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR, V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/node-pack-runtimes.md §WASM';
const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';
const EXPORTS = ['memory', 'openwop_abi_version', 'openwop_pack_name', 'openwop_node_count', 'openwop_node_id_at', 'openwop_alloc', 'openwop_free', 'openwop_node_invoke'];

interface Manifest { name: string; nodes: Array<{ typeId: string }>; runtime: { entry: string } }

/** The slice of the WebAssembly JS API used here (the suite's tsconfig carries no DOM lib). */
declare const WebAssembly: {
  instantiate(bytes: Uint8Array, imports: Record<string, never>): Promise<{ instance: { exports: Record<string, unknown> }; module: object }>;
  Module: { exports(module: object): Array<{ name: string }> };
};
interface WasmMemory { readonly buffer: ArrayBuffer }

async function observe(dir: string): Promise<{ manifest: Manifest; exports: string[]; abi: number; pack: string; nodeCount: number; typeId: string }> {
  const base = join(FIXTURES_DIR, 'wasm-packs', dir);
  const manifest = JSON.parse(readFileSync(join(base, 'pack.json'), 'utf8')) as Manifest;
  const bytes = readFileSync(join(base, manifest.runtime.entry));
  const { instance, module } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports as Record<string, unknown>;
  const mem = ex['memory'] as WasmMemory;
  const str = (packed: bigint): string => {
    const len = Number(packed >> 32n);
    const ptr = Number(packed & 0xffffffffn);
    return new TextDecoder().decode(new Uint8Array(mem.buffer, ptr, len));
  };
  return {
    manifest,
    exports: WebAssembly.Module.exports(module).map((e) => e.name).sort(),
    abi: (ex['openwop_abi_version'] as () => number)(),
    pack: str((ex['openwop_pack_name'] as () => bigint)()),
    nodeCount: (ex['openwop_node_count'] as () => number)(),
    typeId: str((ex['openwop_node_id_at'] as (i: number) => bigint)(0)),
  };
}

describe('wasm fixture packs (node-pack-runtimes.md §WASM)', () => {
  async function check(dir: string, abi: number): Promise<{ got: unknown; want: unknown } | null> {
    if (V1_DIR === null) return null;
    const o = await observe(dir);
    const v = v2Validator('node-pack-manifest')(o.manifest);
    return {
      got: { schema: v.ok ? 'valid' : v.errors, exports: o.exports, abi: o.abi, pack: o.pack, nodeCount: o.nodeCount, typeId: o.typeId },
      want: { schema: 'valid', exports: [...EXPORTS].sort(), abi, pack: o.manifest.name, nodeCount: 1, typeId: o.manifest.nodes[0]!.typeId },
    };
  }

  it('misbehaving-memory is the memory-bomb pack its manifest describes, at ABI version 1', async () => {
    const r = await check('misbehaving-memory', 1);
    if (r === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(r.got, req('openwop.it.wasm-fixture-packs.misbehaving-memory-is-the-memory-bomb-pack-its-manifest-describes-at-abi-version-1', DOC, 'the fixture module is the pack its manifest describes')).toEqual(r.want);
  });

  it('misbehaving-abi is the abi-bomb pack its manifest describes, at the unlisted ABI version 999', async () => {
    const r = await check('misbehaving-abi', 999);
    if (r === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(r.got, req('openwop.it.wasm-fixture-packs.misbehaving-abi-is-the-abi-bomb-pack-its-manifest-describes-at-the-unlisted-abi-versi', DOC, 'the fixture module is the pack its manifest describes')).toEqual(r.want);
  });
});
