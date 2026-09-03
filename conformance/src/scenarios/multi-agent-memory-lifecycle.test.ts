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
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

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
      softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
    }
    const ccmc = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.crossChildMemoryConcurrency;
    if (ccmc === undefined) {
      softSkip('inapplicable', 'optional advertisement — `multiAgent.executionModel.crossChildMemoryConcurrency` not advertised by this host');
      ctx.skip(); // optional advertisement — host hasn't opted in
      return softSkip('blocked', 'precondition not met — `ccmc === undefined` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(
      ccmc === 'strict' || ccmc === 'advisory',
      req('openwop.it.multi-agent-memory-lifecycle.crosschildmemoryconcurrency-when-advertised-must-be-one-of-strict-advisory', 
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
  // MAE-2 is still out of stable profile via RFC 0042 §B (experimental
  // tier): RFC 0039 §B Half B (MAE-2 + MAE-3) landed on MyndHyve
  // 2026-05-23 via commit `a51f7bbd` (`snapshotAtSeq()` +
  // `crossChildMemoryConcurrency: 'strict'`). The MAE-2 cross-run-ttl-
  // roundtrip seam (POST /v1/host/sample/test/memory/cross-run-ttl-
  // roundtrip) is still open per host-sample-test-seams.md §"Open seams"
  // — no host has wired the seam endpoint yet, so the behavioral
  // assertion stays `it.skip`. Hosts that implement Half B SHOULD
  // advertise `multiAgent.executionModel.tier: 'experimental'` per
  // RFC 0042 §A until the seam contract is wired.
  it.skip('MAE-2 cross-run TTL: child write expiresAt MUST be anchored at child write time, not parent start — out of stable profile via RFC 0042');

  // MAE-3 flipped to behavioral 2026-05-25 — MyndHyve workflow-runtime
  // revision `00206-tdh` advertises Phase 2 + memory and honors the
  // POST /v1/runs/{runId}:fork mode:replay contract per
  // host-sample-test-seams.md §"Canonical-endpoint conformance hooks"
  // §9. The seam reuses the canonical fork endpoint plus the
  // OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID env-var convention (parallel
  // naming to OPENWOP_TEST_EXPIRED_RUN_ID used by
  // production-retention-expiry). Soft-skips on Phase 1 hosts, Phase 2
  // hosts without memory, and hosts that have not seeded the env var.
  it('MAE-3 replay snapshot refusal: fork mode:replay against a past-retention runId MUST return 422 replay_memory_snapshot_unavailable with documented envelope; silent substitution is non-conformant', async (ctx) => {
    const d = await readDiscovery();
    if (d === null) {
      softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
    }
    const v = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.version;
    const memorySupported = capabilityFamily<{ supported?: unknown }>(d, 'memory')?.supported;
    const phase2OrLater = typeof v === 'number' && v >= 2;
    const expiredRunId = process.env.OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID;
    if (!phase2OrLater || memorySupported !== true || !expiredRunId) {
      softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!phase2OrLater || memorySupported !== true || !expiredRunId` returned early');
      ctx.skip();
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!phase2OrLater || memorySupported !== true || !expiredRunId` returned early');
    }

    const fromSeq = 0;
    const res = await driver.post(`/v1/runs/${encodeURIComponent(expiredRunId)}:fork`, {
      mode: 'replay',
      fromSeq,
    });

    expect(
      res.status,
      req('openwop.it.multi-agent-memory-lifecycle.mae-3-replay-snapshot-refusal-fork-mode-replay-against-a-past-retention-runid-mu', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B MAE-3',
        'fork mode:replay against a past-retention runId MUST refuse with 422; silent substitution of current memory is non-conformant',
      ),
    ).toBe(422);

    const body = res.json as {
      error?: unknown;
      details?: { fromSeq?: unknown; sourceRunId?: unknown; reason?: unknown };
    } | null;

    expect(
      body?.error,
      req('openwop.it.multi-agent-memory-lifecycle.mae-3-replay-snapshot-refusal-fork-mode-replay-against-a-past-retention-runid-mu', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B MAE-3',
        'refusal envelope error code MUST be "replay_memory_snapshot_unavailable" (distinct from the pre-flight invalid_from_seq gate)',
      ),
    ).toBe('replay_memory_snapshot_unavailable');

    expect(
      body?.details?.fromSeq,
      req('openwop.it.multi-agent-memory-lifecycle.mae-3-replay-snapshot-refusal-fork-mode-replay-against-a-past-retention-runid-mu', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B MAE-3',
        'refusal envelope details.fromSeq MUST echo the requested fromSeq',
      ),
    ).toBe(fromSeq);

    expect(
      body?.details?.sourceRunId,
      req('openwop.it.multi-agent-memory-lifecycle.mae-3-replay-snapshot-refusal-fork-mode-replay-against-a-past-retention-runid-mu', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B MAE-3',
        'refusal envelope details.sourceRunId MUST echo the runId from the URL',
      ),
    ).toBe(expiredRunId);

    const reason = body?.details?.reason;
    expect(
      reason === 'retention_expired' || reason === 'event_log_unavailable',
      req('openwop.it.multi-agent-memory-lifecycle.mae-3-replay-snapshot-refusal-fork-mode-replay-against-a-past-retention-runid-mu', 
        'RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md §B MAE-3',
        'refusal envelope details.reason MUST be one of {"retention_expired", "event_log_unavailable"}',
      ),
    ).toBe(true);
  });
});
