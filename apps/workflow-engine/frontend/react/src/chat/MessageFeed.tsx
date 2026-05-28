/**
 * Scrollable message feed with auto-scroll-to-bottom on new content.
 * EVERY message that carries `activeInterrupt` (assistant turns AND
 * workflow_run bubbles) renders the matching interrupt card via the
 * `CardHost` registry below itself — the chat thread is where the
 * user takes action. The right-side `WorkflowProgressPanel` is for
 * *tracking* the run's shape, not for responding to gates.
 *
 * **History (informational, no API impact):**
 *   - 2026-05-24 — progress UI moved out of the bubble into the
 *     right-side panel; interrupt cards moved with it.
 *   - 2026-05-25 — interrupt cards REVERTED to the chat thread per
 *     user feedback that the split forced users to swivel between
 *     two surfaces every gate. The panel now shows a pointer chip.
 *
 * **Current prop surface:** `onCancelWorkflowRun` was removed during
 * the 2026-05-24 split (cancel lives on the panel); added
 * `onOpenWorkflowProgress` (callback to focus a run + open the panel)
 * and `focusedWorkflowMessageId` (mirrors panel state so the bubble's
 * "View progress" link can flip to "Showing in panel"). Adopters
 * forking this file need to thread these through.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { WorkflowRunBubble } from './WorkflowRunBubble.js';
import { CardHost } from './registry/CardHost.js';
import { HitlDecisionCard } from './HitlDecisionCard.js';
import { WorkflowCompletionCard } from './WorkflowCompletionCard.js';
import { ArtifactPreviewModal } from './ArtifactPreviewModal.js';
import type { ChatMessage } from './hooks/useChatSession.js';

/** Normalize historical `@<slug>` user-message text to `/<slug>` when
 *  the message is immediately followed by a `workflow_run` bubble.
 *
 *  Why this exists: the 2026-05-28 mention-symbol swap moved workflow
 *  dispatch from `@` to `/`. New chats write `/<slug>` directly (see
 *  `runWorkflowMention` in `useChatSession.ts`), but chats persisted
 *  before the swap still have `@<slug>` in their user-message content.
 *  Without normalization, an old chat reads "I dispatched the
 *  workflow with `@uppercase`" while a new chat reads "with
 *  `/uppercase`" — the same surface, two syntaxes.
 *
 *  The transformation is purely display-time: the persisted content
 *  stays as-is on disk (it's an immutable history record). The
 *  workflow-run bubble it precedes already shows `/slug` from the
 *  `workflowRun.slug` field via the B3 update.
 *
 *  We narrow the transformation to user messages immediately before a
 *  `workflow_run` so we don't accidentally rewrite an actual `@`-prefixed
 *  literal in a non-workflow user message. */
function normalizeWorkflowMentions(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.map((m, i) => {
    if (m.role !== 'user') return m;
    if (typeof m.content !== 'string') return m;
    const next = messages[i + 1];
    if (!next || next.role !== 'workflow_run') return m;
    if (!/^@[a-z0-9][a-z0-9-]*(\s|$)/i.test(m.content)) return m;
    return { ...m, content: '/' + m.content.slice(1) };
  });
}

function runIdFor(m: ChatMessage): string {
  // `workflow_run` messages carry the dispatched runId on their state.
  // Assistant messages set meta.runId after createRun resolves. If
  // neither is present we pass an empty string — the card will surface
  // a no-op resolve to the user rather than a 4xx.
  return m.workflowRun?.runId ?? m.meta?.runId ?? '';
}

interface Props {
  messages: readonly ChatMessage[];
  tenantId: string;
  onResolveInterrupt: (messageId: string, value: unknown) => Promise<void>;
  /** Open the workflow-progress side panel + focus the bubble's run. */
  onOpenWorkflowProgress: (messageId: string) => void;
  /** Workflow-run message id currently shown in the side panel, if any. */
  focusedWorkflowMessageId: string | null;
  /** Re-run the prior user message for this assistant bubble. */
  onRegenerate?: (messageId: string) => void;
  /** Record / clear 👍 / 👎 on an assistant bubble. */
  onFeedback?: (messageId: string, feedback: 'positive' | 'negative' | null) => void;
  /** Open the BYOK settings wizard (from the error-card CTA). */
  onReconfigureBYOK?: () => void;
}

export function MessageFeed({
  messages,
  tenantId,
  onResolveInterrupt,
  onOpenWorkflowProgress,
  focusedWorkflowMessageId,
  onRegenerate,
  onFeedback,
  onReconfigureBYOK,
}: Props): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  // Display-time normalization for the 2026-05-28 mention-symbol swap.
  // Pre-swap chats have `@<workflow-slug>` in user-message content;
  // we render them as `/<workflow-slug>` to match the new syntax.
  // Memoize so we don't rewalk + re-rewrite on every render that
  // doesn't change messages.
  const displayMessages = useMemo(() => normalizeWorkflowMentions(messages), [messages]);

  // Auto-scroll on new messages OR content change (streaming deltas).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Artifact preview modal state. Single global instance so multiple
  // completion cards in history (one per past workflow run in this
  // session) share the same modal without each component owning one.
  const [preview, setPreview] = useState<{
    nodeId: string;
    label: string;
    output: unknown;
  } | null>(null);

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: 'var(--chat-feed-pad, 16px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {displayMessages.map((m) => (
        <div key={m.id}>
          {m.role === 'workflow_run'
            ? <WorkflowRunBubble
                message={m}
                onOpenProgress={onOpenWorkflowProgress}
                isFocusedInPanel={m.id === focusedWorkflowMessageId}
              />
            : <MessageBubble
                message={m}
                {...(onRegenerate ? { onRegenerate } : {})}
                {...(onFeedback ? { onFeedback } : {})}
                {...(onReconfigureBYOK ? { onReconfigureBYOK } : {})}
              />}
          {/* Inline interrupt card — renders below the bubble for
              every message kind (chat-turn AND workflow_run). The
              right-side WorkflowProgressPanel is for *tracking* the
              run's overall shape (step list, status, outputs); the
              chat thread is where the user takes the action. Keeping
              the approval / clarification card here means the user
              doesn't have to swivel between two surfaces to respond. */}
          {m.activeInterrupt && (
            <div style={{ marginLeft: 12, marginRight: 'max(0px, calc(100% - var(--max-bubble-width, 75ch) - 12px))' }}>
              <CardHost
                cardType={`interrupt.${m.activeInterrupt.kind}`}
                payload={m.activeInterrupt}
                context={{
                  runId: runIdFor(m),
                  nodeId: m.activeInterrupt.nodeId,
                  tenantId,
                }}
                onAction={async (_actionId, payload) => {
                  await onResolveInterrupt(m.id, payload);
                }}
              />
            </div>
          )}
          {/* Persistent HITL decision artifacts — one per resolved
              interrupt. Survives `activeInterrupt` flipping to null.
              Renders only the resolved entries; an open interrupt is
              still shown above via the interactive CardHost. */}
          {m.workflowRun?.interruptHistory?.filter((h) => h.resolvedAt).map((entry) => (
            <div
              key={`decision-${entry.interruptId}`}
              style={{ marginLeft: 12, marginRight: 'max(0px, calc(100% - var(--max-bubble-width, 75ch) - 12px))' }}
            >
              <HitlDecisionCard entry={entry} />
            </div>
          ))}
          {/* Workflow-completion artifact — renders once the run
              reaches a terminal state. Each terminal node surfaces a
              View button that opens the shared preview modal. */}
          {m.role === 'workflow_run' && m.workflowRun && (
            <div style={{ marginLeft: 12, marginRight: 'max(0px, calc(100% - var(--max-bubble-width, 75ch) - 12px))' }}>
              <WorkflowCompletionCard
                run={m.workflowRun}
                onPreviewArtifact={(nodeId, output, label) =>
                  setPreview({ nodeId, output, label })
                }
              />
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
      <ArtifactPreviewModal
        open={preview !== null}
        nodeId={preview?.nodeId ?? ''}
        label={preview?.label ?? ''}
        output={preview?.output}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
