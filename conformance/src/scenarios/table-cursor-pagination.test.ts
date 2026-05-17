/**
 * table-cursor-pagination — placeholder scenario for RFC 0016 §B point 3 (cursor pagination).
 *
 * Status: PLACEHOLDER. RFC 0016 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0016 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.tableStorage.supported`.
 *
 * Summary: query MUST support filter + cursor pagination.
 *
 * @see RFCS/0016-*.md
 */

import { describe, it } from 'vitest';

describe('table-cursor-pagination: placeholder for RFC 0016', () => {
  it.todo("first page returns N rows + nextCursor; second page resumes from nextCursor; final page returns nextCursor=null");
});
