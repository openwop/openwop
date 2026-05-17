/**
 * Scrollable message feed with auto-scroll-to-bottom on new content.
 * Each assistant bubble renders any attached interrupt card via the
 * registry below itself.
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
}

export function MessageFeed({ messages, tenantId, onResolveInterrupt }: Props): JSX.Element {
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
          {m.role === 'workflow_run' ? <WorkflowRunBubble message={m} /> : <MessageBubble message={m} />}
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
