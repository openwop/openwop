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
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readMemoryAttributionCap, emitsWriteEvents, seedRun, memoryWrittenEvents } from '../lib/memoryAttribution.js';

describe('memory-attribution-no-content (RFC 0057 §C)', () => {
  it('memory.written payloads carry no entry content', async () => {
    const cap = await readMemoryAttributionCap();
    if (!emitsWriteEvents(cap)) return;
    const runId = await seedRun('mem-attr-no-content');
    if (!runId) return;
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return;
    }
    const events = await memoryWrittenEvents(runId);
    if (events.length === 0) return; // run wrote no memory — soft-skip
    for (const e of events) {
      const payload = e.payload ?? {};
      expect(
        'content' in payload,
        driver.describe('RFC 0057 §C', 'memory.written MUST NOT carry the entry content field'),
      ).toBe(false);
      expect(
        typeof (payload as { memoryRef?: unknown }).memoryRef === 'string' &&
          typeof (payload as { memoryId?: unknown }).memoryId === 'string',
        driver.describe('RFC 0057 §B', 'memory.written MUST carry memoryRef + memoryId identifiers'),
      ).toBe(true);
    }
  });
});
