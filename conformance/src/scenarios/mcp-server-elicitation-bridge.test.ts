/**
 * mcp-server-elicitation-bridge — placeholder scenario for RFC 0020 §A point 3 (elicitation/create → ctx.suspend).
 *
 * Status: PLACEHOLDER. RFC 0020 is at `Draft` status as of 2026-05-17.
 * This scenario lands as `it.todo()` so the contract surface is tracked.
 * Promote to live assertions when:
 *   1. RFC 0020 reaches `Active` status, AND
 *   2. The matching capability block lands in `schemas/capabilities.schema.json`, AND
 *   3. At least one reference host advertises `capabilities.mcp.serverMount.elicitationBridge`.
 *
 * Summary: Inbound elicitation/create suspends the run on a typed form and resumes on accept/decline/cancel.
 *
 * @see RFCS/0020-*.md
 */

import { describe, it } from 'vitest';

describe('mcp-server-elicitation-bridge: placeholder for RFC 0020', () => {
  it.todo("elicitation/create with a flat schema suspends the run");
  it.todo("accept response resumes with payload; decline + cancel paths round-trip correctly");
});
