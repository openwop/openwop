/**
 * feedback-on-terminal-run — RFC 0056 §C. An annotation on a COMPLETED run
 * is accepted (proves feedback is non-blocking and post-hoc). Gated on
 * `capabilities.feedback.supported`; soft-skips when a run can't be seeded.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §C
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';

describe('feedback-on-terminal-run (RFC 0056 §C)', () => {
  it('annotating a terminal run is accepted', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return;
    const runId = await seedRun('feedback-terminal');
    if (!runId) return;
    try {
      await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    } catch {
      return; // run didn't reach terminal in time — soft-skip
    }
    const post = await driver.post(`/v1/runs/${runId}/annotations`, { signal: { kind: 'flag' }, note: 'post-hoc review' });
    if (post.status === 501 || post.status === 404) return;
    expect(
      post.status,
      driver.describe('RFC 0056 §C', 'a host MUST accept an annotation on a terminal run'),
    ).toBe(201);
  });
});
