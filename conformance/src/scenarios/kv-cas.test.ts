/**
 * kv-cas — placeholder scenario for RFC 0015 §B point 5 (compare-and-swap).
 *
 * Status: PLACEHOLDER. RFC 0015 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0015 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.kvStorage.compareAndSwap`.
 *
 * Summary: Compare-and-swap MUST be atomic — stale expect rejected.
 *
 * @see RFCS/0015-*.md
 */

import { describe, it } from 'vitest';

describe('kv-cas: placeholder for RFC 0015', () => {
  it.todo("CAS with matching expect succeeds and updates value");
  it.todo("CAS with stale expect fails with `swapped:false` and returns actual");
});
