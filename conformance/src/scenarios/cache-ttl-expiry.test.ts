/**
 * cache-ttl-expiry — placeholder scenario for RFC 0019 §B point 2 (TTL drift ≤ 1s).
 *
 * Status: PLACEHOLDER. RFC 0019 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0019 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.cache.supported`.
 *
 * Summary: Cache TTL honored with at most 1-second drift.
 *
 * @see RFCS/0019-*.md
 */

import { describe, it } from 'vitest';

describe('cache-ttl-expiry: placeholder for RFC 0019', () => {
  it.todo("put with ttl=2 → hit within window; miss after");
});
