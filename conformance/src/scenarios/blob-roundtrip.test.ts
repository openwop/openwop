/**
 * blob-roundtrip — placeholder scenario for RFC 0019 §C.
 *
 * Status: PLACEHOLDER. RFC 0019 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0019 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.blobStorage.supported`.
 *
 * Summary: put then get returns the same content + size + etag.
 *
 * @see RFCS/0019-*.md
 */

import { describe, it } from 'vitest';

describe('blob-roundtrip: placeholder for RFC 0019', () => {
  it.todo("put binary content → get returns identical bytes");
  it.todo("get of non-existent key returns found:false");
});
