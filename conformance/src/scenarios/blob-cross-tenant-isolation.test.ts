/**
 * blob-cross-tenant-isolation — placeholder scenario for RFC 0019 §B point 1 (per-bucket tenant isolation).
 *
 * Status: PLACEHOLDER. RFC 0019 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0019 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.blobStorage.supported`.
 *
 * Summary: host.blobStorage MUST isolate by tenant per bucket.
 *
 * @see RFCS/0019-*.md
 */

import { describe, it } from 'vitest';

describe('blob-cross-tenant-isolation: placeholder for RFC 0019', () => {
  it.todo("put under tenant A → get under tenant B with same key returns found:false");
});
