/**
 * distillation-index-roundtrip — RFC 0062 §B(5). After distillation the
 * memory-index workspace file (`MEMORY-INDEX.json`, RFC 0059) is retrievable and
 * the run reported updating the index (rides `workspace.updated`, not a bespoke
 * index event).
 *
 * Gated on `capabilities.memory.distillation.supported` + `indexEmitted` + the
 * host memory-distillation seam; soft-skips when any is absent. (The seam echoes
 * the index file, so this scenario does not separately require the workspace
 * read endpoint to be wired.)
 *
 * @see RFCS/0062-scheduled-memory-distillation.md §B
 * @see RFCS/0059-agent-workspace.md — the durable layer the index rides
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readDistillationCap, invokeDistill } from '../lib/distillation.js';

describe('distillation-index-roundtrip (RFC 0062 §B)', () => {
  it('an indexEmitted run updates a retrievable memory-index manifest', async () => {
    const cap = await readDistillationCap();
    if (cap?.supported !== true || cap?.indexEmitted !== true) return;
    const res = await invokeDistill({ memoryRef: 'conformance-distill', tokenBudget: 8000, indexEmitted: true });
    if (res === null) return; // seam absent — soft-skip
    expect(
      res.body.indexUpdated === true || res.body.event?.distillation?.indexUpdated === true,
      driver.describe('RFC 0062 §B', 'an indexEmitted distillation MUST report updating the memory index'),
    ).toBe(true);
    expect(
      res.body.indexFile !== undefined && res.body.indexFile !== null,
      driver.describe('RFC 0062 §B', 'the MEMORY-INDEX.json manifest MUST be retrievable after distillation'),
    ).toBe(true);
  });
});
