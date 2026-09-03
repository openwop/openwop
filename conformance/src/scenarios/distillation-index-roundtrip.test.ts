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
import { softSkip } from '../lib/soft-skip.js';
import { readDistillationCap, invokeDistill } from '../lib/distillation.js';
import { req } from '../lib/requirement-ids.js';

describe('distillation-index-roundtrip (RFC 0062 §B)', () => {
  it('an indexEmitted run updates a retrievable memory-index manifest', async () => {
    const cap = await readDistillationCap();
    if (cap?.supported !== true || cap?.indexEmitted !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true || cap?.indexEmitted !== true` returned early');
    const res = await invokeDistill({ memoryRef: 'conformance-distill', tokenBudget: 8000, indexEmitted: true });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      res.body.indexUpdated === true || res.body.event?.distillation?.indexUpdated === true,
      req('openwop.it.distillation-index-roundtrip.an-indexemitted-run-updates-a-retrievable-memory-index-manifest', 'RFC 0062 §B', 'an indexEmitted distillation MUST report updating the memory index'),
    ).toBe(true);
    expect(
      res.body.indexFile !== undefined && res.body.indexFile !== null,
      req('openwop.it.distillation-index-roundtrip.an-indexemitted-run-updates-a-retrievable-memory-index-manifest', 'RFC 0062 §B', 'the MEMORY-INDEX.json manifest MUST be retrievable after distillation'),
    ).toBe(true);
  });
});
