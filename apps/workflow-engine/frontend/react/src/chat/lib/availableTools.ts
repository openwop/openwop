/**
 * Builds the list of workflow-bound tools the chat can invoke when the
 * Tools toggle is on. Sources: the hardcoded sample workflows (so the
 * feature works without any builder use) + every localStorage-saved
 * workflow.
 *
 * Tool names MUST match Anthropic's `^[a-zA-Z0-9_-]{1,64}$` constraint;
 * we sanitize the workflowId by replacing `.` and `:` with `_` and
 * prefixing `wf_`.
 */

import { listSavedWorkflows } from '../../builder/persistence/localStore.js';

export interface ChatToolBinding {
  /** Anthropic-safe tool name. */
  name: string;
  /** Description shown to the LLM. */
  description: string;
  /** OpenWOP workflowId that the backend dispatches. */
  workflowId: string;
}

const SAMPLE_BINDINGS: ChatToolBinding[] = [
  {
    name: 'wf_sample_uppercase',
    description:
      'Uppercases the `text` field. Input: { text: string }. Returns the uppercased text.',
    workflowId: 'sample.demo.uppercase',
  },
];

export function buildAvailableTools(): ChatToolBinding[] {
  const builderBindings: ChatToolBinding[] = listSavedWorkflows()
    .filter((wf) => wf.nodes.length > 0)
    .map((wf) => ({
      name: sanitizeToolName(wf.id),
      description: `User-built workflow "${wf.name}" with ${wf.nodes.length} node(s): ${wf.nodes
        .map((n) => n.name)
        .join(' → ')}.`,
      workflowId: wf.id,
    }));
  // Deduplicate by name (sanitization could collide in pathological cases).
  const seen = new Set<string>();
  return [...SAMPLE_BINDINGS, ...builderBindings].filter((b) => {
    if (seen.has(b.name)) return false;
    seen.add(b.name);
    return true;
  });
}

function sanitizeToolName(id: string): string {
  return `wf_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);
}
