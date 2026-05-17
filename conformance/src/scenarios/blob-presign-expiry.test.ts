/**
 * blob-presign-expiry — placeholder scenario for RFC 0019 §B point 1 (presigned URL expires at advertised TTL).
 *
 * Status: PLACEHOLDER. RFC 0019 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0019 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.blobStorage.presignSupported`.
 *
 * Summary: Presigned URLs MUST expire at the advertised TTL.
 *
 * @see RFCS/0019-*.md
 */

import { describe, it } from 'vitest';

describe('blob-presign-expiry: placeholder for RFC 0019', () => {
  it.todo("presign with ttl=60 → URL works during the window, returns 403 after");
});
