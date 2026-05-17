/**
 * Builds the list of workflow-bound tools the chat can invoke when the
 * Tools toggle is on. Single source of truth: `listWorkflowMentions()`,
 * which combines hardcoded sample workflows + every localStorage-saved
 * workflow. The mention slug is woven into the description so the LLM
 * can map an `@-mention` in the user's prompt onto the matching tool.
 *
 * Tool names MUST match Anthropic's `^[a-zA-Z0-9_-]{1,64}$` constraint;
 * `workflowMentions.sanitizeToolName` enforces that.
 */

import { listWorkflowMentions } from './workflowMentions.js';

export interface ChatToolBinding {
  /** Anthropic-safe tool name. */
  name: string;
  /** Description shown to the LLM. */
  description: string;
  /** OpenWOP workflowId that the backend dispatches. */
  workflowId: string;
}

export function buildAvailableTools(): ChatToolBinding[] {
  return listWorkflowMentions().map((m) => ({
    name: m.toolName,
    description: `Mention: @${m.slug}. ${m.description}`,
    workflowId: m.workflowId,
  }));
}
