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
import { driver } from '../lib/driver.js';
import { readMemoryAttributionCap } from '../lib/memoryAttribution.js';

describe('memory-attribution-shape: advertisement (RFC 0057 §A)', () => {
  it('capabilities.memory.attribution is absent or a well-formed object', async () => {
    const cap = await readMemoryAttributionCap();
    if (cap === null) return; // not advertised — valid
    expect(
      cap.supported,
      driver.describe('capabilities.schema.json §memory.attribution', 'memory.attribution.supported MUST be the literal true when the block is present'),
    ).toBe(true);
    if (cap.emitsWriteEvents !== undefined) {
      expect(typeof cap.emitsWriteEvents).toBe('boolean');
    }
  });
});
