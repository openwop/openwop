/**
 * mcp-server-prompt-roundtrip — placeholder scenario for RFC 0020 §A (prompts/list + prompts/get).
 *
 * Status: PLACEHOLDER. RFC 0020 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0020 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.mcp.serverMount.supported`.
 *
 * Summary: External client lists + retrieves an exposed prompt template.
 *
 * @see RFCS/0020-*.md
 */

import { describe, it } from 'vitest';

describe('mcp-server-prompt-roundtrip: placeholder for RFC 0020', () => {
  it.todo("prompts/list returns the exposed prompt");
  it.todo("prompts/get with arguments returns the rendered messages");
});
