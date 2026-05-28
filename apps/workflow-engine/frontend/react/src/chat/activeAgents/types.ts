/**
 * Active-agents panel — shared row shape.
 *
 * Lives next to the panel component because the hook (D1) + the
 * activation glue (D3) + the chat dispatcher (D2) all need the same
 * row shape and it's owned by the activeAgents/ surface, not by the
 * top-level chat/types.ts (which is the canonical session shape).
 */

/** One row rendered in the panel. Matches the persisted shape in
 *  `ChatSession.activeAgents.lineup` plus the synthesised default
 *  assistant row that's never persisted. */
export interface ActiveAgentRow {
  agentId: string;
  persona: string;
  slug: string;
  modelClass: string;
  /** Empty for the synthesised default assistant. */
  addedAt: string;
}
