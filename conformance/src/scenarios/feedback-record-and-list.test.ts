/**
 * feedback-record-and-list — RFC 0056 §C. POST an annotation, then GET
 * lists it back. Gated on `capabilities.feedback.supported` + the
 * `conformance-a` seed fixture; soft-skips otherwise.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §C
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';

describe('feedback-record-and-list (RFC 0056 §C)', () => {
  it('POST an annotation then GET returns it', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early');
    const runId = await seedRun('feedback-rl');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    const post = await driver.post(`/v1/runs/${runId}/annotations`, { signal: { kind: 'rating', rating: 5 } });
    if (post.status === 501 || post.status === 404) return softSkip('blocked', 'precondition not met — `post.status === 501 || post.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(
      post.status,
      driver.describe('RFC 0056 §C', 'POST annotation returns 201 with the persisted annotation'),
    ).toBe(201);
    const created = post.json as { annotationId?: string };
    expect(typeof created.annotationId).toBe('string');
    const list = await driver.get(`/v1/runs/${runId}/annotations`);
    expect(list.status).toBe(200);
    const ann = (list.json as { annotations?: Array<{ annotationId?: string }> } | undefined)?.annotations ?? [];
    expect(ann.some((a) => a.annotationId === created.annotationId)).toBe(true);
  });
});
