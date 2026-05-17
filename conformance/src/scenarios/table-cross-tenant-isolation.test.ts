/**
 * table-cross-tenant-isolation — placeholder scenario for RFC 0016 §B point 1 (cross-tenant isolation).
 *
 * Status: PLACEHOLDER. RFC 0016 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0016 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.tableStorage.supported`.
 *
 * Summary: host.tableStorage MUST partition rows by tenant.
 *
 * @see RFCS/0016-*.md
 */

import { describe, it } from 'vitest';

describe('table-cross-tenant-isolation: placeholder for RFC 0016', () => {
  it.todo("insert under tenant A → query under tenant B returns 0 rows for the same table+filter");
});
