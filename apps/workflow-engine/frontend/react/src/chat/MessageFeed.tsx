/**
 * Scrollable message feed with auto-scroll-to-bottom on new content.
 * Each assistant bubble renders any attached interrupt card via the
 * registry below itself.
 *
 * **Prop change 2026-05-24** — `workflow_run` progress UI moved out of
 * the chat bubble into the right-side `WorkflowProgressPanel`. Props
 * were renamed accordingly: `onCancelWorkflowRun` removed (cancel now
 * lives on the panel); added `onOpenWorkflowProgress` (callback to
 * focus a run + open the panel) and `focusedWorkflowMessageId`
 * (mirrors panel state so the bubble's "View progress" link can flip
 * to "Showing in panel"). Adopters with a vendor fork of MessageFeed
 * need to thread the new props through.
 */

import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { WorkflowRunBubble } from './WorkflowRunBubble.js';
import { CardHost } from './registry/CardHost.js';
import type { ChatMessage } from './hooks/useChatSession.js';

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

  // Auto-scroll on new messages OR content change (streaming deltas).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: 'var(--chat-feed-pad, 16px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {messages.map((m) => (
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
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
