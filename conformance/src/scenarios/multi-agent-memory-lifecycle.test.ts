/**
 * multi-agent-memory-lifecycle — RFC 0039 §B advertisement-shape + behavioral stubs.
 *
 * Status: ACTIVE (advertisement-shape; behavioral stubs deferred to a
 * host that advertises both `capabilities.memory.supported: true` AND
 * `capabilities.multiAgent.executionModel.version >= 2`). Phase 1 hosts
 * + Phase 2 hosts without memory + Phase 2 hosts with memory but no
 * MAE-3 snapshot implementation all soft-skip cleanly.
 *
 * Closes the conformance gate for RFC 0039 §B (MAE-2 cross-run TTL +
 * MAE-3 replay snapshot). Behavioral assertions require a host that
 * actually advertises the MemoryAdapter surface; the reference
 * workflow-engine sample advertises `capabilities.memory.supported:
 * false` so this scenario soft-skips there. The Postgres reference
 * host advertises memory.supported: true; once it adopts RFC 0039
 * Phase 2 the behavioral assertions below light up.
 *
 * Asserts (advertisement-shape — always-on when discovery is reachable):
 *
 *   1. capabilities.multiAgent.executionModel.crossChildMemoryConcurrency
 *      (when advertised) MUST be one of {"strict", "advisory"} per
 *      RFC 0039 §B + schemas/capabilities.schema.json.
 *
 *   2. When a host advertises BOTH multiAgent.executionModel.version >= 2
 *      AND memory.supported: true, the host MUST honor the MAE-2 +
 *      MAE-3 contracts (behavioral assertions below).
 *
 * Behavioral assertions (capability-gated; soft-skip when no host
 * advertises the conjunction):
 *
 *   3. MAE-2 cross-run TTL: a child writing MemoryEntry { ttl: 5 } at
 *      parent-clock T+10s has `expiresAt` reflecting T+15s (child
 *      write time + 5s), NOT parent-start + 5s. Implementation requires
 *      a host-side test seam to drive the cross-run write + read; once
 *      a memory-advertising host wires the seam the assertion runs.
 *
 *   4. MAE-3 replay snapshot refusal: a host that advertises Phase 2 +
 *      memory MUST either (a) serve the fork from a past event-log
 *      index returning memory state as-of that index, OR (b) refuse
 *      with error.code: "replay_memory_snapshot_unavailable" per
 *      spec/v1/rest-endpoints.md §"Common error codes". Silent
 *      substitution of current memory is non-conformant.
 *
 * @see RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B
 * @see spec/v1/multi-agent-execution.md §"Agent memory lifecycle across sub-runs"
 * @see spec/v1/agent-memory.md §"TTL semantics" (which the child-write-time MAE-2 anchoring extends to the cross-run case)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    memory?: { supported?: unknown };
    multiAgent?: {
      executionModel?: {
        supported?: unknown;
        version?: unknown;
        crossChildMemoryConcurrency?: unknown;
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('multi-agent-memory-lifecycle: advertisement shape (RFC 0039 §B)', () => {
  it('crossChildMemoryConcurrency (when advertised) MUST be one of {strict, advisory}', async (ctx) => {
    const d = await readDiscovery();
    if (d === null) {
      ctx.skip();
      return;
    }
    const ccmc = d.capabilities?.multiAgent?.executionModel?.crossChildMemoryConcurrency;
    if (ccmc === undefined) {
      ctx.skip(); // optional advertisement — host hasn't opted in
      return;
    }
    expect(
      ccmc === 'strict' || ccmc === 'advisory',
      driver.describe(
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B',
        'crossChildMemoryConcurrency MUST be one of {strict, advisory} when present; values outside the closed enum are non-conformant',
      ),
    ).toBe(true);
  });
});

describe.skipIf(HTTP_SKIP)('multi-agent-memory-lifecycle: behavioral (RFC 0039 §B MAE-2 + MAE-3)', () => {
  // Behavioral assertion lands when a memory-advertising Phase 2 host
  // exposes a host-side test seam for cross-run memory writes (e.g.,
  // POST /v1/host/sample/test/memory/cross-run-ttl-roundtrip). The
  // assertion drives:
  //   1. Parent starts at parent-clock T+0
  //   2. Child dispatched at T+10s, writes MemoryEntry { key: 'k', value: 'v', ttl: 5 }
  //   3. Parent reads MemoryEntry { key: 'k' } at T+12s; expiresAt MUST be
  //      approximately T+15s (child write at T+10 + ttl 5), not T+5s.
  // Until a memory-advertising Phase 2 host wires the seam, the contract
  // is documentation-only — surfaced as `todo` so test reporters track
  // the gap rather than reporting a vacuous PASS.
  it.todo('MAE-2 cross-run TTL: child write expiresAt MUST be anchored at child write time, not parent start');

  // Behavioral assertion lands when the host implements the snapshot
  // mechanism per RFC 0039 §B. The assertion drives:
  //   1. Run a workflow that writes MemoryEntry { key: 'k', value: 'v1' } at index 10.
  //   2. Write MemoryEntry { key: 'k', value: 'v2' } at index 20.
  //   3. POST /v1/runs/{runId}:fork { fromSeq: 15 }.
  //   4. Forked run reads MemoryEntry { key: 'k' }; MUST return 'v1' (not 'v2').
  //   5. Alternative compliance: fork refused with
  //      error.code: 'replay_memory_snapshot_unavailable' AND
  //      details.fromSeq === 15.
  // Silent substitution of v2 (current state) is non-conformant.
  it.todo('MAE-3 replay snapshot: fork from past index MUST return memory-as-of-index OR refuse with replay_memory_snapshot_unavailable');
});
