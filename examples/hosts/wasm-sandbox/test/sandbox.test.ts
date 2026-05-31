/**
 * RFC 0035 §B behavioral conformance for the WASM-isolation sandbox executor.
 *
 * Drives the real `invokeSandboxed` reference implementation against the real
 * compiled `.wasm` fixtures (built by `scripts/build-fixtures.mjs`). Every
 * assertion exercises actual WebAssembly isolation — there are NO placeholders
 * and NO mocks. These are the behavioral probes that graduate the seven
 * `node-pack-sandbox-*` invariants from reference-impl to protocol tier.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeSandboxed, type SandboxConfig } from '../src/wasm-sandbox.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fix = (name: string): Uint8Array => new Uint8Array(readFileSync(join(fixturesDir, `${name}.wasm`)));

const BASE: SandboxConfig = { allowedHostCalls: [], memoryLimitBytes: 2 * 1024 * 1024, wallClockLimitMs: 1000 };

// ── positive controls ──────────────────────────────────────────────────────

test('well-behaved.echo runs and returns its input (positive control)', async () => {
  const r = await invokeSandboxed(fix('well-behaved-echo'), BASE, 'invoke', 42);
  assert.equal(r.ok, true);
  assert.equal(r.result, 42);
});

test('well-behaved.host-fetch succeeds when fetch is in allowedHostCalls', async () => {
  const r = await invokeSandboxed(fix('well-behaved-host-fetch'), { ...BASE, allowedHostCalls: ['fetch'] }, 'invoke', 7);
  assert.equal(r.ok, true);
  assert.equal(r.result, 7); // the granted fetch stub echoes
});

// ── §B invariant 7: capability gate ─────────────────────────────────────────

test('node-pack-sandbox-capability-gate: host-fetch WITHOUT the grant is sandbox_capability_denied', async () => {
  const r = await invokeSandboxed(fix('well-behaved-host-fetch'), BASE, 'invoke', 7);
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'sandbox_capability_denied');
  assert.equal(r.error?.details?.requestedCapability, 'fetch');
});

test('node-pack-sandbox-capability-gate: an undeclared openwop capability is denied with its name', async () => {
  const r = await invokeSandboxed(fix('misbehaving-capability-gate'), BASE);
  assert.equal(r.error?.code, 'sandbox_capability_denied');
  assert.equal(r.error?.details?.requestedCapability, 'privileged');
});

// ── §B invariants 1–4: escape attempts (fail-closed at import inspection) ────

test('node-pack-sandbox-fs-gated: a declared fs import is a host-fs-escape', async () => {
  const r = await invokeSandboxed(fix('misbehaving-fs'), BASE);
  assert.equal(r.error?.code, 'sandbox_escape_attempt');
  assert.equal(r.error?.details?.escapeKind, 'host-fs-escape');
});

test('node-pack-sandbox-no-env: a declared environ import is a host-env-leak', async () => {
  const r = await invokeSandboxed(fix('misbehaving-env'), BASE);
  assert.equal(r.error?.code, 'sandbox_escape_attempt');
  assert.equal(r.error?.details?.escapeKind, 'host-env-leak');
});

test('node-pack-sandbox-network-gated: a declared socket import is a network-escape', async () => {
  const r = await invokeSandboxed(fix('misbehaving-network'), BASE);
  assert.equal(r.error?.code, 'sandbox_escape_attempt');
  assert.equal(r.error?.details?.escapeKind, 'network-escape');
});

test('node-pack-sandbox-no-process: a declared process import is a host-process-escape', async () => {
  const r = await invokeSandboxed(fix('misbehaving-process'), BASE);
  assert.equal(r.error?.code, 'sandbox_escape_attempt');
  assert.equal(r.error?.details?.escapeKind, 'host-process-escape');
});

// ── §B invariant 5: memory cap ──────────────────────────────────────────────

test('node-pack-sandbox-memory-cap: access beyond the host memory bound is sandbox_memory_exceeded', async () => {
  const r = await invokeSandboxed(fix('misbehaving-memory'), BASE);
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'sandbox_memory_exceeded');
});

// ── §B invariant 6: wall-clock timeout ──────────────────────────────────────

test('node-pack-sandbox-timeout: an infinite loop is killed with sandbox_timeout', async () => {
  const r = await invokeSandboxed(fix('misbehaving-timeout'), { ...BASE, wallClockLimitMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, 'sandbox_timeout');
});

// ── §B invariant 8: isolated context ────────────────────────────────────────

test('node-pack-sandbox-isolated-context: each invocation gets a fresh instance (no cross-pack state)', async () => {
  const iso = fix('isolation-global');
  const bumped = await invokeSandboxed(iso, BASE, 'bump');
  assert.equal(bumped.result, 1); // a fresh instance starts at 0, bump → 1
  const read = await invokeSandboxed(iso, BASE, 'read');
  assert.equal(read.result, 0); // a SEPARATE fresh instance still reads 0 — no state leaked
});
