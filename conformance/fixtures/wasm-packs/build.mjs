#!/usr/bin/env node
/**
 * Builds the two operator-installed WASM fixture packs from their WebAssembly
 * text sources, so no Rust toolchain is needed (RFC 0008 §B exports, hand-written).
 *
 *   misbehaving-memory/   `vendor.openwop.misbehaving.memory-bomb` grows linear
 *                         memory until the host refuses, then traps (RFC 0008 §K;
 *                         node-pack-runtimes.md §WASM: cap.breached kind wasm-memory).
 *   misbehaving-abi/      `vendor.openwop.misbehaving.abi-bomb` reports ABI version
 *                         999, which no host lists, so a conforming host refuses it
 *                         at load (node-pack-runtimes.md §WASM).
 *
 * The built `module.wasm` files are committed. `--check` rebuilds in memory and
 * fails when a committed binary does not match its source.
 *
 *   node conformance/fixtures/wasm-packs/build.mjs [--check]
 *
 * Needs the `wabt` package only to build: `npx -y -p wabt@1.0.36 node build.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes('--check');
const require = createRequire(import.meta.url);
const wabt = await require('wabt')();
let bad = 0;
for (const dir of ['misbehaving-memory', 'misbehaving-abi']) {
  const src = readFileSync(join(HERE, dir, 'module.wat'), 'utf8');
  const bin = Buffer.from(wabt.parseWat(`${dir}/module.wat`, src).toBinary({}).buffer);
  const out = join(HERE, dir, 'module.wasm');
  if (check) {
    let committed = Buffer.alloc(0);
    try { committed = readFileSync(out); } catch { /* missing */ }
    if (!committed.equals(bin)) { console.error(`${dir}/module.wasm does not match module.wat — run build.mjs`); bad++; }
  } else {
    writeFileSync(out, bin);
    console.log(`wrote ${dir}/module.wasm (${bin.length} bytes)`);
  }
}
process.exit(bad ? 1 : 0);
