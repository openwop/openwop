/**
 * memory-attribution-shape — RFC 0057 §A. The `capabilities.memory.attribution`
 * advertisement block is either absent or a well-formed object.
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage lives
 * in the sibling memory-attribution-*.test.ts scenarios, gated on
 * `capabilities.memory.attribution.emitsWriteEvents`.
 *
 * @see RFCS/0057-memory-write-attribution-event.md §A
 */

import { describe, it, expect } from 'vitest';
import { readMemoryAttributionCap } from '../lib/memoryAttribution.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('memory-attribution-shape: advertisement (RFC 0057 §A)', () => {
  it('capabilities.memory.attribution is absent or a well-formed object', async () => {
    const cap = await readMemoryAttributionCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early (not advertised — valid)'); // not advertised — valid
    expect(
      cap.supported,
      req('openwop.it.memory-attribution-shape.capabilities-memory-attribution-is-absent-or-a-well-formed-object', 'capabilities.schema.json §memory.attribution', 'memory.attribution.supported MUST be the literal true when the block is present'),
    ).toBe(true);
    if (cap.emitsWriteEvents !== undefined) {
      expect(typeof cap.emitsWriteEvents).toBe('boolean');
    }
  });
});
