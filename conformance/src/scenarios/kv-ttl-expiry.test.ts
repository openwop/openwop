/**
 * kv-ttl-expiry — placeholder scenario for RFC 0015 §B point 3 (TTL honored within 1s drift).
 *
 * Status: PLACEHOLDER. RFC 0015 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0015 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.kvStorage.supported`.
 *
 * Summary: TTL honored with at most a 1-second drift on expiry visibility.
 *
 * @see RFCS/0015-*.md
 */

import { describe, it } from 'vitest';

describe('kv-ttl-expiry: placeholder for RFC 0015', () => {
  it.todo("set with ttl=2 → get at t+1 returns the value; get at t+3 returns not-found");
  it.todo("TTL drift across the 1-second window is bounded");
});
