/**
 * Workflow @-mention catalog for the chat input.
 *
 * Sources:
 *   - Hardcoded sample workflows (so mentions work without any
 *     builder-saved entries).
 *   - Every localStorage-saved workflow with ≥1 node.
 *
 * The chat input's `@` autocomplete renders one entry per workflow,
 * filters by `displayName` substring, and inserts the entry's `slug`
 * into the prompt (e.g. `@hello-uppercase `). The slug is a stable,
 * whitespace-free token the LLM sees in the user's message; if the
 * Tools toggle is on, the matching `toolName` is also advertised in
 * the run's `inputs.tools` list so the LLM can invoke the workflow
 * via `tool_use` when it decides to act on the mention.
 *
 * Slug collisions (two workflows with names that slugify identically)
 * resolve by appending `-2`, `-3`, … in the order returned.
 */

import { listSavedWorkflows } from '../../builder/persistence/localStore.js';

export interface WorkflowMentionEntry {
  /** Human-readable name shown in the popover row. */
  displayName: string;
  /** Whitespace-free token inserted after `@`. Stable across renders
   *  for the same workflow id. */
  slug: string;
  /** One-line description shown under the name in the popover. */
  description: string;
  /** Anthropic-safe tool name matching `buildAvailableTools()` output. */
  toolName: string;
  /** OpenWOP workflow id the backend dispatches when the LLM calls the tool. */
  workflowId: string;
}

interface SampleSource {
  displayName: string;
  description: string;
  workflowId: string;
}

const SAMPLE_SOURCES: SampleSource[] = [
  {
    displayName: 'Uppercase',
    description:
      'Uppercases the `text` field. Input: { text: string }. Returns the uppercased text.',
    workflowId: 'sample.demo.uppercase',
  },
];

export function listWorkflowMentions(): WorkflowMentionEntry[] {
  const out: WorkflowMentionEntry[] = [];
  const usedSlugs = new Set<string>();

  function push(displayName: string, description: string, workflowId: string): void {
    // Cloned templates carry " (from template)" — strip from the slug so
    // the `@mention` token stays short. Keep displayName so users can tell
    // which workflow originated from a template.
    const slugSource = displayName.replace(/\s*\(from template\)\s*$/i, '');
    const baseSlug = slugify(slugSource);
    let slug = baseSlug;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${n++}`;
    }
    usedSlugs.add(slug);
    out.push({
      displayName,
      slug,
      description,
      toolName: sanitizeToolName(workflowId),
      workflowId,
    });
  }

  for (const s of SAMPLE_SOURCES) {
    push(s.displayName, s.description, s.workflowId);
  }
  for (const wf of listSavedWorkflows()) {
    if (wf.nodes.length === 0) continue;
    const steps = wf.nodes.map((n) => n.name).join(' → ');
    push(wf.name, `${wf.nodes.length} node${wf.nodes.length === 1 ? '' : 's'}: ${steps}`, wf.id);
  }
  return out;
}

/** Returns the matched mention plus any trailing text the user typed
 *  after the `@<slug>` token. When `trailing` is non-empty, the chat
 *  dispatcher uses it to override the workflow's default first input
 *  field — so `@hello-uppercase hello` runs the workflow with
 *  `inputs.text = "hello"` instead of the template's default.
 *
 *  `null` means "this message isn't a workflow trigger" and the
 *  message routes through the normal LLM path. */
export interface MentionMatch {
  entry: WorkflowMentionEntry;
  /** Text after the `@<slug>` token; null when the message is a bare
   *  mention. Whitespace-only trailing strings collapse to null. */
  trailing: string | null;
}

export function detectMention(text: string): MentionMatch | null {
  const stripped = text.trim();
  // Capture the slug, then optionally capture everything after one or
  // more spaces. Examples that match:
  //   "@hello-uppercase"            → trailing: null
  //   "@hello-uppercase hello"      → trailing: "hello"
  //   "@hello-uppercase  hi there"  → trailing: "hi there"
  const match = /^@([a-z0-9][a-z0-9-]*)(?:\s+(.*))?$/i.exec(stripped);
  if (!match) return null;
  const slug = match[1]?.toLowerCase() ?? '';
  const entry = listWorkflowMentions().find((e) => e.slug === slug);
  if (!entry) return null;
  const trailingRaw = (match[2] ?? '').trim();
  return { entry, trailing: trailingRaw.length > 0 ? trailingRaw : null };
}

/** Back-compat wrapper for any caller that only wants the bare-mention
 *  signal. Returns the entry only when there's no trailing text. */
export function detectBareMention(text: string): WorkflowMentionEntry | null {
  const m = detectMention(text);
  return m && m.trailing === null ? m.entry : null;
}

/** Case-insensitive substring filter on `displayName`. Returns input
 *  order so the sample sources stay pinned to the top. */
export function filterMentions(
  entries: ReadonlyArray<WorkflowMentionEntry>,
  query: string,
): WorkflowMentionEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => e.displayName.toLowerCase().includes(q));
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'workflow';
}

function sanitizeToolName(id: string): string {
  // Mirrors availableTools.sanitizeToolName so the slug-inserted
  // mention text aligns with the tool name passed to the LLM.
  return `wf_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);
}
