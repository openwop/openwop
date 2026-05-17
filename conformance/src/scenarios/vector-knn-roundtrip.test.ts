/**
 * vector-knn-roundtrip — placeholder scenario for RFC 0018 §D (vector roundtrip).
 *
 * Status: PLACEHOLDER. RFC 0018 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0018 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.vectorStore.supported`.
 *
 * Summary: upsert then query returns the same vectors in top-k order.
 *
 * @see RFCS/0018-*.md
 */

import { describe, it } from 'vitest';

describe('vector-knn-roundtrip: placeholder for RFC 0018', () => {
  it.todo("upsert 10 vectors → query with one of them returns it as top-1");
  it.todo("topK respects the configured limit");
});
