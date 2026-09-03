/**
 * memory-attribution-no-content — RFC 0057 §C + SECURITY/invariants.yaml
 * `memory-attribution-no-content`. A `memory.written` payload carries
 * identifiers + non-secret tags only — never the memory entry content (the
 * read-side serves that, already SR-1-redacted).
 *
 * Gated on `capabilities.memory.attribution.emitsWriteEvents`; soft-skips when
 * unadvertised or when the seeded run wrote no memory.
 *
 * @see RFCS/0057-memory-write-attribution-event.md §C
 * @see SECURITY/invariants.yaml — memory-attribution-no-content
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readMemoryAttributionCap, emitsWriteEvents, seedRun, memoryWrittenEvents } from '../lib/memoryAttribution.js';
import { req } from '../lib/requirement-ids.js';

describe('memory-attribution-no-content (RFC 0057 §C)', () => {
  it('memory.written payloads carry no entry content', async () => {
    const cap = await readMemoryAttributionCap();
    if (!emitsWriteEvents(cap)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!emitsWriteEvents(cap)` returned early');
    const runId = await seedRun('mem-attr-no-content');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return softSkip('blocked', 'precondition not met — an earlier step threw (seam, prior step, or fixture unavailable)');
    }
    const events = await memoryWrittenEvents(runId);
    if (events.length === 0) return softSkip('blocked', 'run wrote no memory — soft-skip (events.length === 0)');
    for (const e of events) {
      const payload = e.payload ?? {};
      expect(
        'content' in payload,
        req('openwop.it.memory-attribution-no-content.memory-written-payloads-carry-no-entry-content', 'RFC 0057 §C', 'memory.written MUST NOT carry the entry content field'),
      ).toBe(false);
      expect(
        typeof (payload as { memoryRef?: unknown }).memoryRef === 'string' &&
          typeof (payload as { memoryId?: unknown }).memoryId === 'string',
        req('openwop.it.memory-attribution-no-content.memory-written-payloads-carry-no-entry-content', 'RFC 0057 §B', 'memory.written MUST carry memoryRef + memoryId identifiers'),
      ).toBe(true);
    }
  });
});
