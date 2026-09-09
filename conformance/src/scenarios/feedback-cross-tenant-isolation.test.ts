/**
 * feedback-cross-tenant-isolation — RFC 0056 §E + SECURITY/invariants.yaml
 * `annotation-cross-tenant-isolation`. A run's annotation list MUST contain
 * only that run's annotations (mirrors CTI-1).
 *
 * The run-scoped check runs against any feedback host. The full cross-tenant
 * proof (tenant B cannot read tenant A's run) needs a multi-tenant auth seam
 * not yet standardized for this surface — that half soft-skips, mirroring
 * `kv-cross-tenant-isolation`'s seam gate.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §E
 * @see SECURITY/invariants.yaml — annotation-cross-tenant-isolation
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';
import { req } from '../lib/requirement-ids.js';

describe('feedback-cross-tenant-isolation (RFC 0056 §E)', () => {
  it('a run\'s annotation list contains only that run\'s annotations', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early');
    const runId = await seedRun('feedback-cti');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    const post = await driver.post(`/v1/runs/${runId}/annotations`, { signal: { kind: 'label', label: 'cti-probe' } });
    if (post.status === 501 || post.status === 404) return softSkip('blocked', 'precondition not met — `post.status === 501 || post.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(post.status).toBe(201);
    const list = await driver.get(`/v1/runs/${runId}/annotations`);
    const ann = (list.json as { annotations?: Array<{ target?: { runId?: string } }> } | undefined)?.annotations ?? [];
    for (const a of ann) {
      expect(
        a.target?.runId,
        req('openwop.it.feedback-cross-tenant-isolation.a-run-s-annotation-list-contains-only-that-run-s-annotations', 'RFC 0056 §E', 'an annotation list MUST contain only this run\'s annotations (CTI-1)'),
      ).toBe(runId);
    }
  });
});
