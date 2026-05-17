/**
 * sql-injection-rejection — placeholder scenario for RFC 0018 §C `sql-parametric-only` invariant.
 *
 * Status: PLACEHOLDER. RFC 0018 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0018 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.sql.supported`.
 *
 * Summary: host.sql MUST reject non-parametric queries that inline user input.
 *
 * @see RFCS/0018-*.md
 */

import { describe, it } from 'vitest';

describe('sql-injection-rejection: placeholder for RFC 0018', () => {
  it.todo("query({ sql: \"SELECT * FROM users WHERE id = '\" + userInput + \"'\", params: [] }) is rejected");
  it.todo("query({ sql: 'SELECT * FROM users WHERE id = ?', params: [userInput] }) succeeds");
});
