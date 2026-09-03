/**
 * feedback-correction-redaction — RFC 0056 §E + SECURITY/invariants.yaml
 * `annotation-content-redaction`. `signal.correction` and `note` are
 * untrusted user content; secret-shaped material MUST be redacted under
 * SR-1 before persistence/listing/export.
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §E
 * @see SECURITY/invariants.yaml — annotation-content-redaction
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readFeedbackCap, seedRun } from '../lib/feedback.js';
import { req } from '../lib/requirement-ids.js';

const CANARY = 'sk-canary-rfc0056-do-not-leak-abc123';

describe('feedback-correction-redaction (RFC 0056 §E)', () => {
  it('secret-shaped material in correction/note is redacted in the annotation list', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early');
    const runId = await seedRun('feedback-redact');
    if (!runId) return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)');
    const post = await driver.post(`/v1/runs/${runId}/annotations`, {
      signal: { kind: 'correction', correction: `please use ${CANARY}` },
      note: CANARY,
    });
    if (post.status === 501 || post.status === 404) return softSkip('blocked', 'precondition not met — `post.status === 501 || post.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(post.status).toBe(201);
    const list = await driver.get(`/v1/runs/${runId}/annotations`);
    expect(
      JSON.stringify(list.json ?? {}).includes(CANARY),
      req('openwop.it.feedback-correction-redaction.secret-shaped-material-in-correction-note-is-redacted-in-the-annotation-list', 'RFC 0056 §E', 'secret-shaped material MUST be redacted before persistence/listing (SR-1)'),
    ).toBe(false);
  });
});
