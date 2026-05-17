/**
 * search-bm25-roundtrip — placeholder scenario for RFC 0018 §D (search roundtrip).
 *
 * Status: PLACEHOLDER. RFC 0018 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0018 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.searchIndex.supported`.
 *
 * Summary: index then query returns relevant documents.
 *
 * @see RFCS/0018-*.md
 */

import { describe, it } from 'vitest';

describe('search-bm25-roundtrip: placeholder for RFC 0018', () => {
  it.todo("index 3 docs → query returns relevance-ranked hits");
});
