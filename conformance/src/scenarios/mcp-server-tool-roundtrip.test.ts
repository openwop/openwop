/**
 * mcp-server-tool-roundtrip — placeholder scenario for RFC 0020 §A (tools/list + tools/call).
 *
 * Status: PLACEHOLDER. RFC 0020 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0020 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.mcp.serverMount.supported`.
 *
 * Summary: External MCP client discovers and invokes a workflow exposed via core.openwop.mcp.expose-tool.
 *
 * @see RFCS/0020-*.md
 */

import { describe, it } from 'vitest';

describe('mcp-server-tool-roundtrip: placeholder for RFC 0020', () => {
  it.todo("tools/list returns the exposed workflow");
  it.todo("tools/call with valid arguments completes the run and returns CallToolResult");
});
