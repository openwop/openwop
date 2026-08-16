/**
 * distillation-token-budget — RFC 0062 §B. A distillation run stays within its
 * token budget (`memory.compacted.distillation.tokensUsed ≤ tokenBudget`); an
 * un-meetable budget fails with `token_budget_exceeded` and writes no partial
 * archive (atomic).
 *
 * Gated on `capabilities.memory.distillation.supported` + the host memory-
 * distillation seam; soft-skips when either is absent.
 *
 * @see RFCS/0062-scheduled-memory-distillation.md §B
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readDistillationCap, invokeDistill } from '../lib/distillation.js';

describe('distillation-token-budget (RFC 0062 §B)', () => {
  it('within budget tokensUsed ≤ tokenBudget; an un-meetable budget fails atomically', async () => {
    if ((await readDistillationCap())?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `(await readDistillationCap())?.supported !== true` returned early');

    const ok = await invokeDistill({ memoryRef: 'conformance-distill', tokenBudget: 8000 });
    if (ok === null) return softSkip('blocked', 'seam absent — soft-skip');
    const dist = ok.body.event?.distillation ?? {};
    expect(
      typeof dist.tokenBudget === 'number' && typeof dist.tokensUsed === 'number',
      driver.describe('RFC 0062 §B', 'memory.compacted MUST carry distillation.tokenBudget + tokensUsed on a budgeted run'),
    ).toBe(true);
    expect(
      (dist.tokensUsed as number) <= (dist.tokenBudget as number),
      driver.describe('RFC 0062 §B', 'a successful distillation MUST consume ≤ its tokenBudget'),
    ).toBe(true);

    // A budget too small to distill the corpus MUST fail closed, no partial archive.
    const tooSmall = await invokeDistill({ memoryRef: 'conformance-distill', tokenBudget: 1 });
    if (tooSmall === null) return softSkip('blocked', 'precondition not met — `tooSmall === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      tooSmall.status >= 400 && tooSmall.body.error === 'token_budget_exceeded',
      driver.describe('RFC 0062 §B', 'an un-meetable budget MUST fail with token_budget_exceeded'),
    ).toBe(true);
    expect(
      tooSmall.body.archiveChecksum,
      driver.describe('RFC 0062 §B', 'a token_budget_exceeded run MUST write no partial archive (atomic)'),
    ).toBeUndefined();
  });
});
