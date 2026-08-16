/**
 * feedback-unsupported-501 — RFC 0056 §C. A host that does NOT advertise
 * `capabilities.feedback.supported` MUST return `501 capability_not_provided`
 * on the annotation endpoints (the honest signal, per `capabilities.md`) —
 * not silently 404 the route.
 *
 * Soft-skips when the host advertises feedback (501 is N/A) or when the
 * route is entirely absent (404/405 — host predates RFC 0056).
 *
 * @see RFCS/0056-run-feedback-and-annotation-event.md §C
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readFeedbackCap } from '../lib/feedback.js';

describe('feedback-unsupported-501 (RFC 0056 §C)', () => {
  it('POST annotations returns 501 capability_not_provided when feedback is unadvertised', async () => {
    const cap = await readFeedbackCap();
    if (cap?.supported === true) return softSkip('inapplicable', 'host supports feedback — 501 N/A (cap?.supported === true)');
    const res = await driver.post('/v1/runs/probe-run-rfc0056/annotations', {
      signal: { kind: 'flag' },
    });
    if (res.status === 404 || res.status === 405) return softSkip('blocked', 'route absent — host predates RFC 0056');
    expect(
      res.status,
      driver.describe('rest-endpoints.md / RFC 0056 §C', 'unadvertised feedback MUST return 501, not 404'),
    ).toBe(501);
    const code = (res.json as { error?: string } | undefined)?.error;
    expect(code).toBe('capability_not_provided');
  });
});
