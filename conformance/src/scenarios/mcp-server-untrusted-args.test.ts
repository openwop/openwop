/**
 * mcp-server-untrusted-args — placeholder scenario for RFC 0020 §D (untrusted boundary + inputSchema validation).
 *
 * Status: PLACEHOLDER. RFC 0020 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0020 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.mcp.serverMount.supported`.
 *
 * Summary: tools/call.arguments MUST validate against the declared inputSchema before workflow start.
 *
 * @see RFCS/0020-*.md
 */

import { describe, it } from 'vitest';

describe('mcp-server-untrusted-args: placeholder for RFC 0020', () => {
  it.todo("tools/call with arguments missing a required field is rejected with isError:true");
  it.todo("tools/call with arguments containing wrong types is rejected before the run starts");
});
