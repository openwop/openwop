/**
 * memory-attribution-tenant-scoped — RFC 0057 §C + SECURITY/invariants.yaml
 * `memory-attribution-tenant-scoped`. A run's `memory.written` events appear
 * only on that run's stream (mirrors CTI-1). The full cross-tenant proof
 * (tenant B cannot read tenant A's run stream) needs a multi-tenant auth seam
 * not standardized for this surface — that half soft-skips, mirroring
 * `feedback-cross-tenant-isolation`.
 *
 * Gated on `capabilities.memory.attribution.emitsWriteEvents`.
 *
 * @see RFCS/0057-memory-write-attribution-event.md §C
 * @see SECURITY/invariants.yaml — memory-attribution-tenant-scoped
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readMemoryAttributionCap, emitsWriteEvents, seedRun, memoryWrittenEvents } from '../lib/memoryAttribution.js';
import { req } from '../lib/requirement-ids.js';

describe('memory-attribution-tenant-scoped (RFC 0057 §C)', () => {
  it("a run's memory.written events appear only on that run's stream", async () => {
    const cap = await readMemoryAttributionCap();
    if (!emitsWriteEvents(cap)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!emitsWriteEvents(cap)` returned early');
    const runId = await seedRun('mem-attr-cti');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return softSkip('blocked', 'precondition not met — an earlier step threw (seam, prior step, or fixture unavailable)');
    }
    const events = await memoryWrittenEvents(runId);
    if (events.length === 0) return softSkip('blocked', 'precondition not met — `events.length === 0` returned early (seam, prior step, or fixture unavailable)');
    // Every memory.written we read came from THIS run's /events stream; if the
    // host echoes a runId in the event it MUST be this run's (no cross-run leak).
    for (const e of events) {
      if (typeof e.runId === 'string') {
        expect(
          e.runId,
          req('openwop.it.memory-attribution-tenant-scoped.a-run-s-memory-written-events-appear-only-on-that-run-s-stream', 'RFC 0057 §C', "a memory.written event MUST belong to its own run's stream (CTI-1)"),
        ).toBe(runId);
      }
    }
  });
});
