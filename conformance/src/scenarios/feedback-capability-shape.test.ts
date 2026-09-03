/**
 * feedback-capability-shape — RFC 0056 §A. The `capabilities.feedback`
 * advertisement block is either absent or a well-formed object.
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage
 * lives in the sibling `feedback-*.test.ts` scenarios, gated on
 * `capabilities.feedback.supported`.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §A
 */

import { describe, it, expect } from 'vitest';
import { readFeedbackCap } from '../lib/feedback.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('feedback-capability-shape: advertisement (RFC 0056 §A)', () => {
  it('capabilities.feedback is absent or a well-formed object', async () => {
    const cap = await readFeedbackCap();
    if (cap === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap === null` returned early (not advertised — valid)'); // not advertised — valid
    expect(
      typeof cap.supported,
      req('openwop.it.feedback-capability-shape.capabilities-feedback-is-absent-or-a-well-formed-object', 'capabilities.schema.json §feedback', 'capabilities.feedback.supported MUST be a boolean when present'),
    ).toBe('boolean');
    if (Array.isArray(cap.targets)) {
      for (const t of cap.targets) {
        expect(['run', 'event', 'node']).toContain(t);
      }
    }
    if (Array.isArray(cap.signals)) {
      for (const s of cap.signals) {
        expect(['rating', 'correction', 'label', 'flag']).toContain(s);
      }
    }
  });
});
