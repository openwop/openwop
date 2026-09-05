/**
 * RFC 0173 §B — `pack-isolation` (suite 2.0.0, target major 2; gated on `packs` + `sandbox`).
 *
 * Isolation binds with pack EXECUTION: a host that executes third-party packs
 * MUST enforce the eight `node-pack-sandbox-*` invariants and MUST advertise
 * `sandbox.isolationModel ∈ wasm | process | container | vm`
 * (`spec/v2/facets/sandbox.schema.json`); `node:vm` is not a value — it "is
 * escapable by design" (RFC 0035 §130) and RFC 0173 §D.1 disposes of it
 * (`spec/v2/core/security-defaults.md` §Sandbox isolation; RFC 0173 §B row C6.5).
 *
 * Legs:
 *   - unaided on the gate: the facet names a mechanism from the closed set and
 *     never `node:vm`;
 *   - the eight behavioural legs are seam-driven through the RFC 0035 §B
 *     misbehaving-pack registry (`host-sample-test-seams.md` §8,
 *     `POST /v1/host/sample/test/sandbox-invoke` → `/conformance/seams/sample/test/sandbox-invoke`
 *     under the v2 seams profile): fs read, fs write, env, network, process,
 *     timeout, memory cap, cross-pack context. Each is `blocked` unless the
 *     seams profile is advertised and the seam answers. `no-eval` stays
 *     reference-impl (`ext/sandbox-runtime-notes`, RFC 0173 §D.1) and is not a
 *     suite leg.
 *
 * @see spec/v2/core/security-defaults.md §Sandbox isolation
 * @see spec/v1/host-sample-test-seams.md §8
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ISOLATION_MODELS = ['wasm', 'process', 'container', 'vm'];
const INVOKE = `${SEAMS_PREFIX}/sample/test/sandbox-invoke`;

interface SandboxError { code?: string; details?: { escapeKind?: string; requestedCapability?: string; message?: string } }
interface InvokeResult { result?: unknown; error?: SandboxError }

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

/** Gate for every leg: packs + sandbox advertised. Returns the sandbox facet or null (reason recorded). */
async function gated(): Promise<Record<string, unknown> | null> {
  const doc = await discovery();
  if (!doc) { softSkip('blocked', 'discovery unreachable'); return null; }
  if (!(await gateFamily('packs'))) { softSkip('inapplicable', 'packs family not advertised — no pack execution, no isolation obligation (gate recorded under openwop.family.packs)'); return null; }
  const sandbox = await gateFamily('sandbox');
  if (!sandbox) { softSkip('inapplicable', 'sandbox family not advertised (gate recorded under openwop.family.sandbox)'); return null; }
  return sandbox;
}

/** Drive one misbehaving typeId through the sandbox seam; null (reason recorded) when the seam is absent. */
async function invoke(typeId: string, extra: Record<string, unknown> = {}): Promise<InvokeResult | null> {
  const doc = await discovery();
  if (!doc || !seamsProfileAdvertised(doc)) { softSkip('inapplicable', `the ${typeId} leg is seam-driven — seams profile (conformance.seamsProfile = openwop-conformance-seams-v2) not advertised`); return null; }
  const res = await driver.post(INVOKE, { typeId, ...extra });
  if (res.status === 404 || res.status === 403 || res.status === 405) { seamAbsent(`host advertises packs + sandbox but ${INVOKE} answered ${res.status} — the ${typeId} leg is unobservable (host-sample-test-seams.md §8)`); return null; }
  expect(res.status, req('openwop.requirement.0173.pack-isolation.seam', 'host-sample-test-seams.md §8', `${INVOKE} MUST answer 200 { result } | 200 { error } for ${typeId}`)).toBe(200);
  return (res.json ?? {}) as InvokeResult;
}

function expectEscape(id: string, r: InvokeResult, escapeKind: string, invariant: string): void {
  expect(r.error?.code, req(id, 'security-defaults.md §Sandbox isolation', `${invariant}: the sandbox MUST refuse with sandbox_escape_attempt (RFC 0173 §B binds the invariant with pack execution)`)).toBe('sandbox_escape_attempt');
  expect(r.error?.details?.escapeKind, req(id, 'host-sample-test-seams.md §8 SandboxError', `escapeKind MUST be ${escapeKind}`)).toBe(escapeKind);
}

describe('RFC 0173 §B — pack-isolation (gated on packs + sandbox)', () => {
  it('sandbox.isolationModel names a real mechanism, never node:vm', async () => {
    const sandbox = await gated();
    if (!sandbox) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const model = sandbox['isolationModel'];
    expect(
      model,
      req('openwop.requirement.0173.pack-isolation', 'facets/sandbox.schema.json isolationModel', 'isolationModel MUST NOT be node:vm — it is escapable by design (RFC 0035 §130) and is not a v2 value (RFC 0173 §D.1)'),
    ).not.toBe('node:vm');
    expect(
      ISOLATION_MODELS,
      req('openwop.requirement.0173.pack-isolation', 'facets/sandbox.schema.json isolationModel', `isolationModel MUST be one of ${ISOLATION_MODELS.join(' | ')} (got ${String(model)})`),
    ).toContain(model);
  });

  it('node-pack-sandbox-fs-gated: a host filesystem read is refused', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.fs-escape-read');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expectEscape('openwop.requirement.0173.pack-isolation.fs-read', r, 'host-fs-escape', 'node-pack-sandbox-fs-gated');
  });

  it('node-pack-sandbox-fs-gated: a host filesystem write is refused', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.fs-escape-write');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expectEscape('openwop.requirement.0173.pack-isolation.fs-write', r, 'host-fs-escape', 'node-pack-sandbox-fs-gated');
  });

  it('node-pack-sandbox-no-env: the host environment does not leak', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.env-leak');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expectEscape('openwop.requirement.0173.pack-isolation.no-env', r, 'host-env-leak', 'node-pack-sandbox-no-env');
  });

  it('node-pack-sandbox-network-gated: ungated network egress is refused', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.network-escape');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expectEscape('openwop.requirement.0173.pack-isolation.network', r, 'network-escape', 'node-pack-sandbox-network-gated');
  });

  it('node-pack-sandbox-no-process: host process access is refused', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.process-escape');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expectEscape('openwop.requirement.0173.pack-isolation.no-process', r, 'host-process-escape', 'node-pack-sandbox-no-process');
  });

  it('node-pack-sandbox-timeout: exceeding wallClockLimitMs fails with sandbox_timeout', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.timeout');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expect(r.error?.code, req('openwop.requirement.0173.pack-isolation.timeout', 'security-defaults.md §Sandbox isolation', 'node-pack-sandbox-timeout: a wall-clock overrun MUST fail with sandbox_timeout')).toBe('sandbox_timeout');
  });

  it('node-pack-sandbox-memory-cap: exceeding memoryLimitBytes fails with sandbox_memory_exceeded', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const r = await invoke('misbehave.memory-bomb');
    if (!r) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    expect(r.error?.code, req('openwop.requirement.0173.pack-isolation.memory-cap', 'security-defaults.md §Sandbox isolation', 'node-pack-sandbox-memory-cap: a memory overrun MUST fail with sandbox_memory_exceeded')).toBe('sandbox_memory_exceeded');
  });

  it('node-pack-sandbox-isolated-context: a pack cannot mutate state another invocation sees', async () => {
    if (!(await gated())) return softSkip('inapplicable', 'gate not met (reason recorded above)');
    const first = await invoke('misbehave.cross-pack-mutate');
    if (!first) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    const second = await invoke('misbehave.cross-pack-mutate');
    if (!second) return softSkip('blocked', 'seam unavailable (reason recorded above)');
    for (const r of [first, second]) {
      expect(r.error, req('openwop.requirement.0173.pack-isolation.isolated-context', 'host-sample-test-seams.md §8', 'misbehave.cross-pack-mutate is not a failure mode — it MUST return a result')).toBeUndefined();
      expect(
        (r.result as { shared?: unknown } | undefined)?.shared,
        req('openwop.requirement.0173.pack-isolation.isolated-context', 'security-defaults.md §Sandbox isolation', 'node-pack-sandbox-isolated-context: result.shared MUST equal 1 on every invocation — a mutation MUST NOT leak into a fresh context'),
      ).toBe(1);
    }
  });
});
