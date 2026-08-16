/**
 * distillation-secret-carryforward — RFC 0062 §B(3). A redacted secret in
 * source memory stays redacted in the distilled archive — the SR-1 carry-forward
 * invariant (RFC 0012 §D) holds through distillation; the raw value never appears
 * in the archive or the emitted `memory.compacted` event.
 *
 * Gated on `capabilities.memory.distillation.supported` + the host memory-
 * distillation seam; soft-skips when either is absent.
 *
 * @see RFCS/0062-scheduled-memory-distillation.md §B
 * @see spec/v1/agent-memory.md §SR-1 — Secret-Redaction Invariant
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readDistillationCap, invokeDistill } from '../lib/distillation.js';

const CANARY = 'sk-canary-rfc0062-do-not-leak-qrs456';

describe('distillation-secret-carryforward (RFC 0062 §B)', () => {
  it('a redacted secret in source memory never appears in the distilled output', async () => {
    if ((await readDistillationCap())?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `(await readDistillationCap())?.supported !== true` returned early');
    const res = await invokeDistill({
      memoryRef: 'conformance-distill',
      tokenBudget: 8000,
      includeSecretCanary: true,
      sources: [{ content: `notes with embedded secret ${CANARY}` }],
    });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      JSON.stringify(res.body).includes(CANARY),
      driver.describe('RFC 0062 §B', 'SR-1 carry-forward: a redacted secret MUST NOT re-appear in the archive or memory.compacted event'),
    ).toBe(false);
  });
});
