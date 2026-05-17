/**
 * kv-atomic-increment — placeholder scenario for RFC 0015 §B point 4 (atomic increment).
 *
 * Status: PLACEHOLDER. RFC 0015 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0015 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.kvStorage.atomicIncrement`.
 *
 * Summary: Atomic increment MUST be atomic across concurrent callers.
 *
 * @see RFCS/0015-*.md
 */

import { describe, it } from 'vitest';

describe('kv-atomic-increment: placeholder for RFC 0015', () => {
  it.todo("1000 concurrent +1 increments → final value is 1000");
  it.todo("previous value reflects the count at the time of the increment");
});
