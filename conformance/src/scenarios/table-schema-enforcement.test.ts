/**
 * table-schema-enforcement — placeholder scenario for RFC 0016 §B point 2 (schema declaration on first insert).
 *
 * Status: PLACEHOLDER. RFC 0016 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0016 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.tableStorage.supported`.
 *
 * Summary: Subsequent rows MUST conform to the schema established on first insert.
 *
 * @see RFCS/0016-*.md
 */

import { describe, it } from 'vitest';

describe('table-schema-enforcement: placeholder for RFC 0016', () => {
  it.todo("first insert declares schema; subsequent insert with wrong column type is rejected");
});
