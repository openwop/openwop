/**
 * RFC 0035 §B invariant 6 — sandbox wall-clock timeout, worker-driven + server-free.
 *
 * The worker-thread counterpart to `sandbox-wasm-isolation.test.ts` (which proves
 * the other six cross-runtime invariants in-process but deliberately cannot run a
 * non-terminating module). A wall-clock cap can only be enforced by THREAD
 * PREEMPTION — a same-thread timer cannot interrupt a synchronous WASM loop — so
 * `probeTimeout` (see `../lib/wasm-sandbox-probe.ts`) spawns a worker running the
 * committed `misbehaving-timeout.wasm` fixture and races a main-thread kill-timer.
 *
 * This is the worker-driven conformance probe that graduates
 * `node-pack-sandbox-timeout` from reference-impl to protocol tier (the prior gap:
 * the cap was proven only host-internally by the WASM host's `test/sandbox.test.ts`).
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B invariant 6
 * @see SECURITY/invariants.yaml node-pack-sandbox-timeout
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../lib/paths.js';
import { probeTimeout } from '../lib/wasm-sandbox-probe.js';
import { req } from '../lib/requirement-ids.js';
const dir = join(FIXTURES_DIR, 'wasm-sandbox');
const fix = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, `${name}.wasm`)));

describe('sandbox-wasm-timeout: wall-clock cap is engine/worker-enforced (RFC 0035 §B 6, server-free)', () => {
  it('node-pack-sandbox-timeout: a non-terminating module is killed with sandbox_timeout', async () => {
    const r = await probeTimeout(fix('misbehaving-timeout'), { memoryLimitBytes: 2 * 1024 * 1024, wallClockLimitMs: 300 });
    expect(r.ok, req('openwop.it.sandbox-wasm-timeout.node-pack-sandbox-timeout-a-non-terminating-module-is-killed-with-sandbox-timeou', 'RFC 0035 §B invariant 6', 'an over-budget invocation MUST fail')).toBe(false);
    expect(r.code, req('openwop.it.sandbox-wasm-timeout.node-pack-sandbox-timeout-a-non-terminating-module-is-killed-with-sandbox-timeou', 'RFC 0035 §C', 'the failure code MUST be sandbox_timeout')).toBe('sandbox_timeout');
  });

  it('positive control: a well-behaved module completes within the budget (the kill-timer does not false-positive)', async () => {
    const r = await probeTimeout(fix('well-behaved-echo'), { memoryLimitBytes: 2 * 1024 * 1024, wallClockLimitMs: 1000 }, 'invoke', 7);
    expect(r.ok, req('openwop.it.sandbox-wasm-timeout.positive-control-a-well-behaved-module-completes-within-the-budget-the-kill-time', 'RFC 0035 §B', 'a within-budget invocation completes before the kill-timer')).toBe(true);
    expect(r.result, req('openwop.it.sandbox-wasm-timeout.positive-control-a-well-behaved-module-completes-within-the-budget-the-kill-time', 'RFC 0035 §B', 'positive control: a well-behaved module completes within the budget (the kill-timer does not false-positive)')).toBe(7);
  });
});
