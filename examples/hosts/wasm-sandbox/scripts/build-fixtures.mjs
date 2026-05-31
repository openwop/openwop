#!/usr/bin/env node
// Build the WASM sandbox conformance fixtures.
//
// Each fixture is authored as WebAssembly Text (WAT) here, compiled to `.wasm`
// with `wabt` (a BUILD-TIME-ONLY dependency — the host runtime never needs it),
// and written to `../fixtures/<name>.wasm`. Both the WAT (this file) and the
// committed `.wasm` are source-of-truth so the fixtures are auditable.
//
// The fixtures map 1:1 to the RFC 0035 §B failure-mode invariants. In a WASM
// sandbox a "forbidden operation" is expressed as a DECLARED IMPORT the host
// refuses to provide (fail-closed at link/inspection time), plus the two
// engine-enforced traps (memory bound, wall-clock) for the resource caps.
//
//   well-behaved-echo            positive control — no imports, returns input
//   well-behaved-host-fetch      positive control — imports openwop.fetch (granted only when 'fetch' ∈ allowedHostCalls)
//   misbehaving-fs               declares wasi fd_read           → host-fs-escape
//   misbehaving-env              declares wasi environ_get       → host-env-leak
//   misbehaving-network          declares wasi sock_connect      → network-escape
//   misbehaving-process          declares wasi proc_raise        → host-process-escape
//   misbehaving-capability-gate  declares openwop.privileged     → sandbox_capability_denied (requestedCapability)
//   misbehaving-memory           stores far beyond the host memory bound → sandbox_memory_exceeded (OOB trap)
//   misbehaving-timeout          infinite loop                   → sandbox_timeout (worker kill-timer)
//   isolation-global             mutable global + bump/read      → fresh-instance isolation proof

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import wabtInit from 'wabt';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'fixtures');

const FIXTURES = {
  'well-behaved-echo': `(module
  (func (export "invoke") (param i32) (result i32) local.get 0))`,

  'well-behaved-host-fetch': `(module
  (import "openwop" "fetch" (func $fetch (param i32) (result i32)))
  (func (export "invoke") (param i32) (result i32) (call $fetch (local.get 0))))`,

  'misbehaving-fs': `(module
  (import "wasi_snapshot_preview1" "fd_read" (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $fd_read (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))`,

  'misbehaving-env': `(module
  (import "wasi_snapshot_preview1" "environ_get" (func $e (param i32 i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $e (i32.const 0) (i32.const 0))))`,

  'misbehaving-network': `(module
  (import "wasi_snapshot_preview1" "sock_connect" (func $s (param i32 i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $s (i32.const 0) (i32.const 0))))`,

  'misbehaving-process': `(module
  (import "wasi_snapshot_preview1" "proc_raise" (func $p (param i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $p (i32.const 0))))`,

  'misbehaving-capability-gate': `(module
  (import "openwop" "privileged" (func $p (param i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $p (local.get 0))))`,

  // Imports the host-provided memory, then stores ~2GiB beyond the host bound.
  // The engine traps with "out of bounds memory access" → sandbox_memory_exceeded.
  'misbehaving-memory': `(module
  (import "env" "memory" (memory 1))
  (func (export "invoke") (param i32) (result i32)
    (i32.store (i32.const 0x7ffffff0) (i32.const 1))
    (i32.const 0)))`,

  // Infinite loop — never returns; the host's worker kill-timer fires → sandbox_timeout.
  'misbehaving-timeout': `(module
  (func (export "invoke") (param i32) (result i32)
    (loop $l (br $l))
    (i32.const 0)))`,

  // Mutable global: "bump" increments + returns; "read" returns current. A fresh
  // instance per invocation MUST start at 0 (no cross-pack state) — the isolation proof.
  'isolation-global': `(module
  (global $g (mut i32) (i32.const 0))
  (func (export "bump") (result i32)
    (global.set $g (i32.add (global.get $g) (i32.const 1)))
    (global.get $g))
  (func (export "read") (result i32) (global.get $g)))`,
};

const wabt = await wabtInit();
mkdirSync(outDir, { recursive: true });
let count = 0;
for (const [name, wat] of Object.entries(FIXTURES)) {
  const mod = wabt.parseWat(`${name}.wat`, wat);
  const { buffer } = mod.toBinary({});
  mod.destroy();
  writeFileSync(join(outDir, `${name}.wasm`), Buffer.from(buffer));
  writeFileSync(join(outDir, `${name}.wat`), `${wat}\n`);
  count += 1;
}
// eslint-disable-next-line no-console
console.log(`built ${count} wasm fixtures into ${outDir}`);
