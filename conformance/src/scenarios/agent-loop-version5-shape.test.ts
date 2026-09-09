/**
 * agent-loop-version5-shape — RFC 0061 §A/§B. The `executionModel.statefulResume`
 * + `transcriptWindow` advertisement fields are well-formed when present, and a
 * host advertising `version >= 5` carries a sane version ceiling.
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage lives
 * in the sibling agent-loop-*.test.ts scenarios, gated on `version >= 5` + the
 * host agent-loop seam.
 *
 * @see RFCS/0061-agent-loop-lifecycle.md §A
 * @see spec/v1/multi-agent-execution.md §"Stateful agent-loop lifecycle"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { executionModelVersionMax } from '../lib/execution-model-version.js';
import { readExecutionModelCap } from '../lib/agentLoop.js';
import { req } from '../lib/requirement-ids.js';

describe('agent-loop-version5-shape: advertisement (RFC 0061 §A)', () => {
  it('executionModel.statefulResume/transcriptWindow are well-formed when present', async () => {
    const em = await readExecutionModelCap();
    if (em === null) return softSkip('inapplicable', 'no execution model — valid (em === null)');
    if (em.statefulResume !== undefined) {
      expect(
        typeof em.statefulResume,
        req('openwop.it.agent-loop-version5-shape.executionmodel-statefulresume-transcriptwindow-are-well-formed-when-present', 'capabilities.schema.json §multiAgent.executionModel', 'statefulResume MUST be a boolean when present'),
      ).toBe('boolean');
    }
    if (em.transcriptWindow !== undefined) {
      expect(
        typeof em.transcriptWindow === 'number' && (em.transcriptWindow as number) >= 1,
        req('openwop.it.agent-loop-version5-shape.executionmodel-statefulresume-transcriptwindow-are-well-formed-when-present', 'capabilities.schema.json §multiAgent.executionModel', 'transcriptWindow MUST be a positive integer when present'),
      ).toBe(true);
    }
    if (typeof em.version === 'number') {
      // S31 (2026-08-17): the ceiling is the schema's `maximum` (6 since RFC 0090,
      // Accepted 2026-06-08 — MyndHyve was the version-6 witness and this leg failed
      // it against a stale literal 5 for ten weeks). Read, never restate.
      const max = executionModelVersionMax();
      expect(
        (em.version as number) >= 1 && (em.version as number) <= max,
        req('openwop.it.agent-loop-version5-shape.executionmodel-statefulresume-transcriptwindow-are-well-formed-when-present', 'capabilities.schema.json §multiAgent.executionModel', `version MUST be within the 1–${max} ladder (schema maximum)`),
      ).toBe(true);
    }
  });
});
