/**
 * sandbox-mvp-behavior — RFC 0035 §B behavioral probes via the node:vm sandbox MVP.
 *
 * Companion to the 8 advertisement-shape `sandbox-*.test.ts` files. This
 * file exercises the 5 RFC 0035 §B failure-mode invariants the
 * node:vm-based reference MVP supports:
 *
 *   1. host-fs-escape — sandboxed code attempting `require('fs')` fails closed
 *   2. host-env-leak — sandboxed code attempting `process.env` access fails closed
 *   3. network-escape — sandboxed code attempting `require('http')` fails closed
 *   4. host-process-escape — sandboxed code attempting `require('child_process')` fails closed
 *   5. sandbox-timeout — runaway loop terminated by the host's wallClockLimitMs
 *
 * Plus 2 more by-construction invariants:
 *
 *   6. cross-pack-mutation — each invocation gets a fresh vm context;
 *      sandboxed code that mutates a "shared" global sees the same fresh
 *      value (0 or undefined) every invocation
 *   7. capability-gate-respected — host.X invocations not in
 *      allowedHostCalls throw with code `sandbox_capability_denied` +
 *      `details.requestedCapability: <method-name>` per the spec's
 *      canonical 4-code error catalog at `host-capabilities.md` §"Error codes"
 *
 * Plus 1 spec-required terminal-failure invariant:
 *
 *   8. memory-exceeded — runaway allocation fails with the canonical
 *      `sandbox_memory_exceeded` (or `sandbox_timeout` when the wall-clock
 *      cap catches it first)
 *
 * The 8th RFC 0035 §B invariant (`node-pack-sandbox-no-eval`) is JS-
 * runtime-specific and reserved per the RFC's exemption clause; this MVP
 * does not enforce it.
 *
 * @see RFCS/0035-sandbox-execution-contract.md §B
 * @see apps/workflow-engine/backend/typescript/src/routes/testSeam.ts §"sandbox-vm MVP"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface SandboxCaps {
  supported?: unknown;
  isolationModel?: unknown;
}

interface DiscoveryDoc {
  capabilities?: { sandbox?: SandboxCaps };
}

interface SandboxResponse {
  result?: unknown;
  error?: {
    code: string;
    details?: {
      escapeKind?: string;
      requestedCapability?: string;
      requestedBytes?: number;
      message?: string;
    };
  };
}

async function isSandboxAdvertised(): Promise<boolean> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return false;
    return capabilityFamily((res.json as DiscoveryDoc), 'sandbox')?.supported === true;
  } catch {
    return false;
  }
}

async function invoke(typeId: string, args: Record<string, unknown> = {}, allowedHostCalls: string[] = []): Promise<{ status: number; body: SandboxResponse }> {
  const res = await driver.post('/v1/host/sample/test/sandbox-invoke', { typeId, args, allowedHostCalls });
  return { status: res.status, body: (res.json as SandboxResponse) ?? {} };
}

describe.skipIf(HTTP_SKIP)('sandbox-mvp-behavior: RFC 0035 §B failure-mode invariants (node:vm MVP)', () => {
  it('host-fs-escape — fs access from sandboxed code fails closed', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('misbehave.fs-escape-read');
    expect(probe.status).toBe(200);
    expect(
      probe.body.error?.code,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §B node-pack-sandbox-fs-gated',
        'sandboxed `require("fs")` MUST fail closed with `sandbox_escape_attempt`',
      ),
    ).toBe('sandbox_escape_attempt');
    expect(
      probe.body.error?.details?.escapeKind,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §B',
        'escapeKind MUST be host-fs-escape',
      ),
    ).toBe('host-fs-escape');
  });

  it('host-env-leak — process.env access from sandboxed code fails closed', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('misbehave.env-leak');
    expect(probe.status).toBe(200);
    expect(
      probe.body.error?.code,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §B node-pack-sandbox-no-env',
        'sandboxed `process.env` access MUST fail closed with `sandbox_escape_attempt`',
      ),
    ).toBe('sandbox_escape_attempt');
    expect(probe.body.error?.details?.escapeKind).toBe('host-env-leak');
  });

  it('network-escape — http/net access from sandboxed code fails closed', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('misbehave.network-escape');
    expect(probe.status).toBe(200);
    expect(
      probe.body.error?.code,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §B node-pack-sandbox-network-gated',
        'sandboxed `require("http")` MUST fail closed with `sandbox_escape_attempt`',
      ),
    ).toBe('sandbox_escape_attempt');
    expect(['network-escape', 'host-fs-escape'].includes(probe.body.error?.details?.escapeKind ?? '')).toBe(true);
  });

  it('host-process-escape — child_process access from sandboxed code fails closed', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('misbehave.process-escape');
    expect(probe.status).toBe(200);
    expect(probe.body.error?.code).toBe('sandbox_escape_attempt');
    // The heuristic may catch this as host-fs-escape (via "require") if
    // network/process patterns don't match first. Accept either as long
    // as it fails closed.
    expect(['host-process-escape', 'host-fs-escape'].includes(probe.body.error?.details?.escapeKind ?? '')).toBe(true);
  });

  it('sandbox-timeout — runaway loop terminated by wallClockLimitMs', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const start = Date.now();
    const probe = await invoke('misbehave.timeout');
    const elapsed = Date.now() - start;
    expect(probe.status).toBe(200);
    expect(
      probe.body.error?.code,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §B node-pack-sandbox-timeout',
        'sandboxed infinite-loop MUST be terminated with `sandbox_timeout`',
      ),
    ).toBe('sandbox_timeout');
    // Should terminate within ~2× wallClockLimitMs (1000ms config + overhead).
    expect(
      elapsed < 5000,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §A wallClockLimitMs',
        `timeout MUST terminate within reasonable bound (got ${elapsed}ms; cap is 1000ms)`,
      ),
    ).toBe(true);
  });

  it('cross-pack-mutation — fresh vm context per invocation, no state leaks', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const r1 = await invoke('misbehave.cross-pack-mutate');
    const r2 = await invoke('misbehave.cross-pack-mutate');
    const r3 = await invoke('misbehave.cross-pack-mutate');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);

    // Each invocation gets a fresh context → __sharedState starts at 0+1=1 each time.
    // If state leaked across invocations, we'd see 1, 2, 3.
    const shared1 = (r1.body.result as { shared?: number })?.shared;
    const shared2 = (r2.body.result as { shared?: number })?.shared;
    const shared3 = (r3.body.result as { shared?: number })?.shared;
    expect(
      shared1 === 1 && shared2 === 1 && shared3 === 1,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §B node-pack-sandbox-isolated-context',
        `each invocation MUST see fresh state (got shared=[${shared1}, ${shared2}, ${shared3}]; expected all 1)`,
      ),
    ).toBe(true);
  });

  it('capability-gate-respected — host call NOT in allowedHostCalls fails with sandbox_capability_denied', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('misbehave.capability-gate-violation', {}, []);
    expect(probe.status).toBe(200);
    expect(
      probe.body.error?.code,
      driver.describe(
        'spec/v1/host-capabilities.md §"Error codes" + §B node-pack-sandbox-capability-gate-respected',
        'capability-gate violation MUST fail closed with `sandbox_capability_denied` — distinct from `sandbox_escape_attempt` which covers forbidden-syscall escapes per the spec\'s 4-code catalog',
      ),
    ).toBe('sandbox_capability_denied');
    expect(
      probe.body.error?.details?.requestedCapability,
      driver.describe(
        'spec/v1/host-capabilities.md §"Error codes"',
        '`sandbox_capability_denied` MUST carry `details.requestedCapability` identifying the host method the sandboxed code attempted to call',
      ),
    ).toBe('notInAllowedList');
  });

  it('memory-exceeded — runaway allocation fails with sandbox_memory_exceeded', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('misbehave.memory-bomb');
    expect(probe.status).toBe(200);
    // The memory-bomb program doubles a string 30 times → ~1GiB if it
    // ran to completion. node:vm + v8 typically OOM or timeout before
    // that point; either way the engine MUST surface the canonical
    // `sandbox_memory_exceeded` OR `sandbox_timeout` error code per
    // `host-capabilities.md` §"Error codes". The MVP heuristic also
    // catches >16MiB serialized results post-hoc → same code.
    // We accept either canonical code here because both are
    // spec-conformant terminal states for a memory-bomb under the
    // declared `memoryLimitBytes` + `wallClockLimitMs` caps; what we
    // refuse is silent success or the now-removed `sandbox_memory_cap`
    // legacy code.
    expect(
      ['sandbox_memory_exceeded', 'sandbox_timeout'].includes(probe.body.error?.code ?? ''),
      driver.describe(
        'spec/v1/host-capabilities.md §"Error codes" + §B node-pack-sandbox-memory-cap',
        `memory-bomb MUST surface either \`sandbox_memory_exceeded\` (when memoryLimitBytes caught it) or \`sandbox_timeout\` (when wallClockLimitMs caught it first) — got code: ${probe.body.error?.code}`,
      ),
    ).toBe(true);
  });

  it('well-behaved.host-fetch — allowedHostCalls=[fetch] permits the host call', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('well-behaved.host-fetch', {}, ['fetch']);
    expect(probe.status).toBe(200);
    expect(
      probe.body.error,
      driver.describe(
        'RFCS/0035-sandbox-execution-contract.md §A allowedHostCalls',
        'host call IN allowedHostCalls MUST succeed (no error envelope)',
      ),
    ).toBeUndefined();
  });

  it('well-behaved.echo — sandboxed code returns args round-trip when no escape attempt', async (ctx) => {
    if (!(await isSandboxAdvertised())) {
      ctx.skip();
      return;
    }
    const probe = await invoke('well-behaved.echo', { input: 'hello-sandbox' });
    expect(probe.status).toBe(200);
    expect(probe.body.error).toBeUndefined();
    expect((probe.body.result as { echoed?: string })?.echoed).toBe('hello-sandbox');
  });
});
