/**
 * sql-transaction-atomicity — placeholder scenario for RFC 0018 §B point 3 (transaction atomicity).
 *
 * Status: PLACEHOLDER. RFC 0018 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0018 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.sql.transactions`.
 *
 * Summary: transactions MUST be atomic; partial failure rolls back.
 *
 * @see RFCS/0018-*.md
 */

import { describe, it } from 'vitest';

describe('sql-transaction-atomicity: placeholder for RFC 0018', () => {
  it.todo("transaction with N statements where N-th fails → no rows from earlier statements visible");
});
