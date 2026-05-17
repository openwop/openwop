/**
 * mcp-server-resource-roundtrip — placeholder scenario for RFC 0020 §A (resources/list + resources/read).
 *
 * Status: PLACEHOLDER. RFC 0020 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0020 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.mcp.serverMount.supported`.
 *
 * Summary: External client lists + reads an exposed resource.
 *
 * @see RFCS/0020-*.md
 */

import { describe, it } from 'vitest';

describe('mcp-server-resource-roundtrip: placeholder for RFC 0020', () => {
  it.todo("resources/list returns the exposed resource");
  it.todo("resources/read returns the bound content");
});
