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
import { driver } from '../lib/driver.js';
import { readDistillationCap, invokeDistill } from '../lib/distillation.js';

describe('distillation-stable-archive (RFC 0062 §B)', () => {
  it('identical sources + budget produce an identical archive checksum', async () => {
    if ((await readDistillationCap())?.supported !== true) return;
    const req = {
      memoryRef: 'conformance-distill',
      tokenBudget: 8000,
      sources: ['s1', 's2', 's3'],
    };
    const a = await invokeDistill(req);
    if (a === null) return; // seam absent — soft-skip
    const b = await invokeDistill(req);
    if (b === null) return;
    expect(
      typeof a.body.archiveChecksum === 'string' && (a.body.archiveChecksum as string).length > 0,
      driver.describe('RFC 0062 §B', 'a distillation run MUST produce a non-empty archive checksum'),
    ).toBe(true);
    expect(
      b.body.archiveChecksum,
      driver.describe('RFC 0062 §B', 'the same source set + budget MUST yield a byte-stable archive'),
    ).toBe(a.body.archiveChecksum);
  });
});
