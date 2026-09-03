/**
 * Background memory consolidation — idempotence + SR-1 carry-forward
 * (RFC 0068, `Draft`).
 *
 * Gated on `capabilities.agents.memoryConsolidation.supported`. Drives the
 * documented host seam `POST /v1/host/sample/memory/consolidate` (staged
 * per the RFC 0027 §G precedent — soft-skips on 404/501 until a reference
 * host wires it). Asserts:
 *   - a consolidation pass emits `agent.memory.consolidated` with
 *     `outputCount <= inputCount` (RFC 0068 §D);
 *   - a second pass over the unchanged corpus is a no-op
 *     (`inputCount == outputCount`) — the idempotence MUST that bounds
 *     runaway consolidation;
 *   - SR-1 carry-forward — a redacted secret in a source entry stays
 *     redacted in a consolidated entry.
 *
 * Hosts that omit the capability skip cleanly.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md §"Background consolidation"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0068-memory-consolidation-and-standing-commitments.md
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';

interface ConsolidationCaps {
  agents?: { memoryConsolidation?: { supported?: boolean } };
}

interface ConsolidateResult {
  event?: { inputCount?: number; outputCount?: number };
  secretLeaked?: boolean;
}

async function consolidationSupported(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return false;
  return Boolean((res.json as ConsolidationCaps).agents?.memoryConsolidation?.supported);
}

describe('memory-consolidation-idempotent: pass contract (RFC 0068 §D, capability-gated)', () => {
  it('a consolidation pass reduces or holds entry count and is idempotent on a stable corpus', async () => {
    if (!(await consolidationSupported())) return softSkip('inapplicable', 'capability absent — gated skip');

    const first = await driver.post('/v1/host/sample/memory/consolidate', {
      memoryRef: 'mem://conformance/consolidation',
      includeSecretCanary: true,
    });
    if (first.status === 404 || first.status === 501) return softSkip('blocked', 'seam not wired — soft-skip');

    expect(first.status, req('openwop.it.memory-consolidation-idempotent.a-consolidation-pass-reduces-or-holds-entry-count-and-is-idempotent-on-a-stable', 'RFC 0068 §D', 'an advertised consolidation seam MUST succeed')).toBe(200);
    const r1 = first.json as ConsolidateResult;
    const in1 = r1.event?.inputCount ?? 0;
    const out1 = r1.event?.outputCount ?? 0;
    expect(out1, req('openwop.it.memory-consolidation-idempotent.a-consolidation-pass-reduces-or-holds-entry-count-and-is-idempotent-on-a-stable', 'RFC 0068 §D.1', 'outputCount MUST be <= inputCount for a merge/dedup pass')).toBeLessThanOrEqual(in1);

    // §D.2 — a second pass over the unchanged corpus is a no-op.
    const second = await driver.post('/v1/host/sample/memory/consolidate', {
      memoryRef: 'mem://conformance/consolidation',
    });
    if (second.status === 404 || second.status === 501) return softSkip('blocked', 'precondition not met — `second.status === 404 || second.status === 501` returned early (seam, prior step, or fixture unavailable)');
    const r2 = second.json as ConsolidateResult;
    expect(
      r2.event?.inputCount,
      req('openwop.it.memory-consolidation-idempotent.a-consolidation-pass-reduces-or-holds-entry-count-and-is-idempotent-on-a-stable', 'RFC 0068 §D.2', 'a second pass over an unchanged corpus MUST be a no-op (inputCount == outputCount)'),
    ).toBe(r2.event?.outputCount);

    // §D.3 — SR-1 carry-forward: a redacted secret stays redacted in the consolidated entry.
    if (typeof r1.secretLeaked === 'boolean') {
      expect(
        r1.secretLeaked,
        req('openwop.it.memory-consolidation-idempotent.a-consolidation-pass-reduces-or-holds-entry-count-and-is-idempotent-on-a-stable', 'RFC 0068 §D.3 / agent-memory.md §SR-1', 'a redacted secret MUST NOT re-appear in a consolidated entry'),
      ).toBe(false);
    }
  });
});
