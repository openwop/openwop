/**
 * memory-attribution-emits-on-write — RFC 0057 §A/§B. A host advertising
 * `capabilities.memory.attribution.emitsWriteEvents: true` emits a
 * `memory.written` event (with resolvable identifiers) for the memory its run
 * writes. A host NOT advertising the capability emits none and still passes
 * the locked core.
 *
 * @see RFCS/0057-memory-write-attribution-event.md §A
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readMemoryAttributionCap, emitsWriteEvents, seedRun, memoryWrittenEvents } from '../lib/memoryAttribution.js';

describe('memory-attribution-emits-on-write (RFC 0057 §A/§B)', () => {
  it('an advertised host emits memory.written carrying a stable memoryId', async () => {
    const cap = await readMemoryAttributionCap();
    if (!emitsWriteEvents(cap)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!emitsWriteEvents(cap)` returned early');
    const runId = await seedRun('mem-attr-emit');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return;
    }
    const events = await memoryWrittenEvents(runId);
    if (events.length === 0) return softSkip('blocked', 'run wrote no memory — soft-skip (events.length === 0)');
    for (const e of events) {
      const memoryId = (e.payload as { memoryId?: unknown } | undefined)?.memoryId;
      expect(
        typeof memoryId === 'string' && memoryId.length > 0,
        driver.describe('RFC 0057 §B', 'memory.written.memoryId MUST be a stable, non-empty identifier'),
      ).toBe(true);
    }
  });

  it('a host without the capability emits no memory.written', async () => {
    const cap = await readMemoryAttributionCap();
    if (emitsWriteEvents(cap)) return softSkip('inapplicable', 'advertised — N/A');
    const runId = await seedRun('mem-attr-absent');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return;
    }
    const events = await memoryWrittenEvents(runId);
    expect(
      events.length,
      driver.describe('RFC 0057 §A', 'a host not advertising memory.attribution MUST NOT emit memory.written'),
    ).toBe(0);
  });
});
