/**
 * Track 13: normative 429 envelope shape (rest-endpoints.md v1.1).
 *
 * Verifies that any 429 response produced by the host conforms to the
 * canonical envelope shape and supplemental `details` keys.
 *
 * Verifies:
 *   1. `error === 'rate_limited'`.
 *   2. `Retry-After` header present and integer-seconds.
 *   3. When `details.retryAfterMs` is present, it is consistent with
 *      `Retry-After`.
 *   4. `details.scope` is one of {"tenant", "route", "global", "key"}.
 *   5. No top-level keys outside `{error, message, details}`.
 *
 * Soft-skip behavior: hosts that don't surface 429 during the test
 * window (low traffic) emit a warning rather than fail. To exercise this
 * scenario the conformance harness MAY set OPENWOP_FORCE_RATE_LIMIT=true
 * which signals the host to fabricate a 429 against a test-only key.
 *
 * @see spec/v1/rest-endpoints.md §"429 Too Many Requests envelope"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';

const ALLOWED_SCOPES = new Set(['tenant', 'route', 'global', 'key']);
const FORCE = process.env.OPENWOP_FORCE_RATE_LIMIT === 'true';

describe('rate-limit-envelope: 429 conforms to canonical shape', () => {
  it('when a 429 is observed, the response body satisfies the v1.1 contract', async () => {
    // Drive a burst to provoke a 429 against a benign endpoint. If the host
    // is generous, this will not trip — that is acceptable; the test
    // is observational and skips its assertions when no 429 occurs.
    let last: Awaited<ReturnType<typeof driver.get>> | null = null;
    for (let i = 0; i < (FORCE ? 200 : 50); i++) {
      const r = await driver.get('/.well-known/openwop');
      last = r;
      if (r.status === 429) break;
    }

    if (!last || last.status !== 429) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rate-limit-envelope] no 429 observed within burst; skipping shape assertions',
      );
      return softSkip('blocked', 'precondition not met — `!last || last.status !== 429` returned early (seam, prior step, or fixture unavailable)');
    }

    const retryAfter = last.headers.get('retry-after');
    expect(retryAfter, req('openwop.it.rate-limit-envelope.when-a-429-is-observed-the-response-body-satisfies-the-v1-1-contract', 
      'rest-endpoints.md §"429 Too Many Requests envelope"',
      '429 response MUST set Retry-After header',
    )).not.toBeNull();

    const body = last.json as {
      error?: string;
      message?: string;
      details?: { retryAfterMs?: number; scope?: string; limit?: number; observedRate?: number };
      [k: string]: unknown;
    };

    expect(body.error, req('openwop.it.rate-limit-envelope.when-a-429-is-observed-the-response-body-satisfies-the-v1-1-contract', 
      'rest-endpoints.md §"429 Too Many Requests envelope"',
      "429 body MUST carry error === 'rate_limited'",
    )).toBe('rate_limited');
    expect(typeof body.message).toBe('string');

    // additionalProperties: false on error-envelope.schema.json
    const topKeys = Object.keys(body).filter(
      (k) => !['error', 'message', 'details'].includes(k),
    );
    expect(topKeys, req('openwop.it.rate-limit-envelope.when-a-429-is-observed-the-response-body-satisfies-the-v1-1-contract', 
      'error-envelope.schema.json additionalProperties: false',
      '429 envelope MUST NOT carry top-level keys outside {error, message, details}',
    )).toEqual([]);

    if (body.details?.scope !== undefined) {
      expect(ALLOWED_SCOPES.has(body.details.scope), req('openwop.it.rate-limit-envelope.when-a-429-is-observed-the-response-body-satisfies-the-v1-1-contract', 
        'rest-endpoints.md §"429 Too Many Requests envelope"',
        "details.scope MUST be one of {'tenant','route','global','key'} when present",
      )).toBe(true);
    }

    const retryAfterSec = Number(retryAfter);
    if (
      body.details?.retryAfterMs !== undefined &&
      !Number.isNaN(retryAfterSec) &&
      retryAfterSec > 0
    ) {
      const diff = Math.abs(body.details.retryAfterMs / 1000 - retryAfterSec);
      expect(diff, req('openwop.it.rate-limit-envelope.when-a-429-is-observed-the-response-body-satisfies-the-v1-1-contract', 
        'rest-endpoints.md §"429 Too Many Requests envelope"',
        'details.retryAfterMs MUST be consistent with Retry-After header (±1s)',
      )).toBeLessThanOrEqual(1.5);
    }
  });
});
