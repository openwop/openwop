/**
 * distillation-stable-archive — RFC 0062 §B(4). The distilled archive is an
 * immutable, addressable artifact: the same source set + budget MUST yield a
 * byte-stable archive checksum (reproducible + auditable).
 *
 * Gated on `capabilities.memory.distillation.supported` + the host memory-
 * distillation seam; soft-skips when either is absent.
 *
 * @see RFCS/0062-scheduled-memory-distillation.md §B
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { readDistillationCap, invokeDistill } from '../lib/distillation.js';
import { req } from '../lib/requirement-ids.js';

describe('distillation-stable-archive (RFC 0062 §B)', () => {
  it('identical sources + budget produce an identical archive checksum', async () => {
    if ((await readDistillationCap())?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `(await readDistillationCap())?.supported !== true` returned early');
    const reqBody = {
      memoryRef: 'conformance-distill',
      tokenBudget: 8000,
      sources: ['s1', 's2', 's3'],
    };
    const a = await invokeDistill(reqBody);
    if (a === null) return softSkip('blocked', 'seam absent — soft-skip');
    const b = await invokeDistill(reqBody);
    if (b === null) return softSkip('blocked', 'precondition not met — `b === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      typeof a.body.archiveChecksum === 'string' && (a.body.archiveChecksum as string).length > 0,
      req('openwop.it.distillation-stable-archive.identical-sources-budget-produce-an-identical-archive-checksum', 'RFC 0062 §B', 'a distillation run MUST produce a non-empty archive checksum'),
    ).toBe(true);
    expect(
      b.body.archiveChecksum,
      req('openwop.it.distillation-stable-archive.identical-sources-budget-produce-an-identical-archive-checksum', 'RFC 0062 §B', 'the same source set + budget MUST yield a byte-stable archive'),
    ).toBe(a.body.archiveChecksum);
  });
});
