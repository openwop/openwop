/**
 * mcp-server-sampling-bridge — placeholder scenario for RFC 0020 §A point 3 (sampling/createMessage → ctx.callAI).
 *
 * Status: PLACEHOLDER. RFC 0020 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0020 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.mcp.serverMount.samplingBridge`.
 *
 * Summary: Inbound sampling/createMessage routes through the workflow-chosen LLM (BYOK consent preserved).
 *
 * @see RFCS/0020-*.md
 */

import { describe, it } from 'vitest';

describe('mcp-server-sampling-bridge: placeholder for RFC 0020', () => {
  it.todo("sampling/createMessage from external server is bridged to ctx.callAI and the result is returned");
});
