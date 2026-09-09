/**
 * RFC 0035 §B sandbox isolation — portable, server-free behavioral conformance.
 *
 * Drives the committed `fixtures/wasm-sandbox/*.wasm` modules through the
 * suite-local `probeSandboxed` reference (see `../lib/wasm-sandbox-probe.ts`).
 * Every assertion exercises real WebAssembly isolation — there are NO `it.todo`
 * placeholders and NO mocks. These are the behavioral probes that graduate the
 * cross-runtime `node-pack-sandbox-*` invariants from reference-impl to protocol
 * tier (`SECURITY/invariants.yaml`).
 *
 * Coverage (six invariants, proven by construction, server-free):
 *   - node-pack-sandbox-fs-gated / -no-env / -network-gated / -no-process:
 *     a forbidden operation can only be a DECLARED IMPORT; the probe statically
 *     refuses any un-granted import → `sandbox_escape_attempt` + `escapeKind`.
 *   - capability gate: an un-granted `openwop.*` import → `sandbox_capability_denied`.
 *   - node-pack-sandbox-memory-cap: an access past the host memory bound traps →
 *     `sandbox_memory_exceeded`.
 *   - node-pack-sandbox-isolated-context: a fresh instance per invocation carries
 *     no state across calls.
 *
 * `node-pack-sandbox-timeout` requires thread preemption (a worker kill-timer) and
 * stays reference-impl, proven by `examples/hosts/wasm-sandbox/test/sandbox.test.ts`
 * (real worker kill). `node-pack-sandbox-no-eval` is JS-runtime-specific (WASM has
 * no `eval`) and is exempt per RFC 0035.
 *
 * Spec reference:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0035-sandbox-execution-contract.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../lib/paths.js';
import { probeSandboxed } from '../lib/wasm-sandbox-probe.js';
import { req } from '../lib/requirement-ids.js';
const dir = join(FIXTURES_DIR, 'wasm-sandbox');
const fix = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, `${name}.wasm`)));
const BASE = { allowedHostCalls: [] as string[], memoryLimitBytes: 2 * 1024 * 1024 };

describe('sandbox-wasm-isolation: positive controls (RFC 0035 §B, server-free)', () => {
  it('a well-behaved pure module runs and returns its input', () => {
    const r = probeSandboxed(fix('well-behaved-echo'), BASE, 'invoke', 42);
    expect(r.ok, req('openwop.it.sandbox-wasm-isolation.a-well-behaved-pure-module-runs-and-returns-its-input', 'RFC 0035 §B', 'a pure-compute module runs')).toBe(true);
    expect(r.result, req('openwop.it.sandbox-wasm-isolation.a-well-behaved-pure-module-runs-and-returns-its-input', 'RFC 0035 §B', 'a well-behaved pure module runs and returns its input')).toBe(42);
  });

  it('a granted host capability is callable when in allowedHostCalls', () => {
    const r = probeSandboxed(fix('well-behaved-host-fetch'), { ...BASE, allowedHostCalls: ['fetch'] }, 'invoke', 7);
    expect(r.ok, req('openwop.it.sandbox-wasm-isolation.a-granted-host-capability-is-callable-when-in-allowedhostcalls', 'RFC 0035 §B invariant 7', 'a granted openwop.* capability is callable')).toBe(true);
    expect(r.result, req('openwop.it.sandbox-wasm-isolation.a-granted-host-capability-is-callable-when-in-allowedhostcalls', 'RFC 0035 §B', 'a granted host capability is callable when in allowedHostCalls')).toBe(7);
  });
});

describe('sandbox-wasm-isolation: escape attempts fail closed (RFC 0035 §B 1–4, server-free)', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['misbehaving-fs', 'host-fs-escape', 'node-pack-sandbox-fs-gated'],
    ['misbehaving-env', 'host-env-leak', 'node-pack-sandbox-no-env'],
    ['misbehaving-network', 'network-escape', 'node-pack-sandbox-network-gated'],
    ['misbehaving-process', 'host-process-escape', 'node-pack-sandbox-no-process'],
  ];
  for (const [fixture, escapeKind, invariant] of cases) {
    it(`${invariant}: ${fixture} → sandbox_escape_attempt (${escapeKind})`, () => {
      const r = probeSandboxed(fix(fixture), BASE);
      expect(r.code, req('openwop.it.sandbox-wasm-isolation.sandbox-escape-attempt', 'RFC 0035 §B', `${invariant} fails closed before instantiation`)).toBe('sandbox_escape_attempt');
      expect(r.escapeKind, req('openwop.it.sandbox-wasm-isolation.sandbox-escape-attempt', 'RFC 0035 §B', ': → sandbox_escape_attempt ( )')).toBe(escapeKind);
    });
  }
});

describe('sandbox-wasm-isolation: capability gate (RFC 0035 §B 7, server-free)', () => {
  it('an un-granted openwop capability is denied with its name', () => {
    const r = probeSandboxed(fix('misbehaving-capability-gate'), BASE);
    expect(r.code, req('openwop.it.sandbox-wasm-isolation.an-un-granted-openwop-capability-is-denied-with-its-name', 'RFC 0035 §B invariant 7', 'undeclared host capability fails closed')).toBe('sandbox_capability_denied');
    expect(r.requestedCapability, req('openwop.it.sandbox-wasm-isolation.an-un-granted-openwop-capability-is-denied-with-its-name', 'RFC 0035 §B', 'an un-granted openwop capability is denied with its name')).toBe('privileged');
  });

  it('host-fetch WITHOUT the grant is denied (the gate works both directions)', () => {
    const r = probeSandboxed(fix('well-behaved-host-fetch'), BASE);
    expect(r.code, req('openwop.it.sandbox-wasm-isolation.host-fetch-without-the-grant-is-denied-the-gate-works-both-directions', 'RFC 0035 §B', 'host-fetch WITHOUT the grant is denied (the gate works both directions)')).toBe('sandbox_capability_denied');
    expect(r.requestedCapability).toBe('fetch');
  });
});

describe('sandbox-wasm-isolation: memory cap (RFC 0035 §B 5, server-free)', () => {
  it('node-pack-sandbox-memory-cap: access beyond the host memory bound is sandbox_memory_exceeded', () => {
    const r = probeSandboxed(fix('misbehaving-memory'), BASE);
    expect(r.ok, req('openwop.it.sandbox-wasm-isolation.node-pack-sandbox-memory-cap-access-beyond-the-host-memory-bound-is-sandbox-memo', 'RFC 0035 §B invariant 5', 'memory bound is engine-enforced')).toBe(false);
    expect(r.code, req('openwop.it.sandbox-wasm-isolation.node-pack-sandbox-memory-cap-access-beyond-the-host-memory-bound-is-sandbox-memo', 'RFC 0035 §B', 'node-pack-sandbox-memory-cap: access beyond the host memory bound is sandbox_memory_exceeded')).toBe('sandbox_memory_exceeded');
  });
});

describe('sandbox-wasm-isolation: isolated context (RFC 0035 §B 8, server-free)', () => {
  it('node-pack-sandbox-isolated-context: each invocation gets a fresh instance (no cross-pack state)', () => {
    const iso = fix('isolation-global');
    expect(probeSandboxed(iso, BASE, 'bump').result, req('openwop.it.sandbox-wasm-isolation.node-pack-sandbox-isolated-context-each-invocation-gets-a-fresh-instance-no-cros', 'RFC 0035 §B invariant 8', 'a fresh instance starts at 0')).toBe(1);
    expect(probeSandboxed(iso, BASE, 'read').result, req('openwop.it.sandbox-wasm-isolation.node-pack-sandbox-isolated-context-each-invocation-gets-a-fresh-instance-no-cros', 'RFC 0035 §B invariant 8', 'no state leaks across invocations')).toBe(0);
  });
});
