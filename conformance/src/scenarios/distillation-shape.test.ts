/**
 * distillation-shape — RFC 0062 §A. The `capabilities.memory.distillation`
 * advertisement block is either absent or a well-formed object (with a positive
 * `maxTokenBudget` when present).
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage lives
 * in the sibling distillation-*.test.ts scenarios, gated on `supported` + the
 * host memory-distillation seam.
 *
 * @see RFCS/0062-scheduled-memory-distillation.md §A
 * @see spec/v1/agent-memory.md §"Scheduled distillation"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readDistillationCap } from '../lib/distillation.js';

describe('distillation-shape: advertisement (RFC 0062 §A)', () => {
  it('capabilities.memory.distillation is absent or a well-formed object', async () => {
    const cap = await readDistillationCap();
    if (cap === null) return; // not advertised — valid
    expect(
      typeof cap.supported,
      driver.describe('capabilities.schema.json §memory.distillation', 'distillation.supported MUST be a boolean when the block is present'),
    ).toBe('boolean');
    if (cap.maxTokenBudget !== undefined) {
      expect(
        typeof cap.maxTokenBudget === 'number' && (cap.maxTokenBudget as number) >= 1,
        driver.describe('capabilities.schema.json §memory.distillation', 'maxTokenBudget MUST be a positive integer when present'),
      ).toBe(true);
    }
    for (const k of ['scheduled', 'indexEmitted'] as const) {
      if (cap[k] !== undefined) {
        expect(
          typeof cap[k],
          driver.describe('capabilities.schema.json §memory.distillation', `distillation.${k} MUST be a boolean when present`),
        ).toBe('boolean');
      }
    }
  });
});
