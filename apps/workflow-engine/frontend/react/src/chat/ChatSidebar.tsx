/**
 * Chat sidebar — the full chat surface. Three zones (header / feed /
 * input) inside a vertical flex container.
 */

import { ChatHeader } from './ChatHeader.js';
import { ChatInput } from './ChatInput.js';
import { MessageFeed } from './MessageFeed.js';
import { WelcomeCard } from './WelcomeCard.js';
import { useChatSession } from './hooks/useChatSession.js';
import type { BYOKActiveConfig } from '../byok/lib/useBYOKConfig.js';

interface Props {
  config: BYOKActiveConfig;
  onOpenSettings: () => void;
  onRemoveKey: () => void | Promise<void>;
  tenantId?: string;
}

export function ChatSidebar({ config, onOpenSettings, onRemoveKey, tenantId = 'demo' }: Props): JSX.Element {
  const { session, isSending, error, send, reset, resolveInterrupt } = useChatSession();

  const disabledReason = isSending ? 'A turn is in flight — wait for the response.' : undefined;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 100px)',
      maxHeight: 900,
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      background: 'var(--color-surface)',
      overflow: 'hidden',
    }}>
      <ChatHeader
        config={config}
        onOpenSettings={onOpenSettings}
        onRemoveKey={onRemoveKey}
        onNewChat={reset}
        messageCount={session.messages.length}
      />

      {session.messages.length === 0 ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <WelcomeCard onPickSuggestion={(text) => send(text, config)} />
        </div>
      ) : (
        <MessageFeed
          messages={session.messages}
          tenantId={tenantId}
          onResolveInterrupt={resolveInterrupt}
        />
      )}

      {error && (
        <div className="alert error" style={{ margin: 8, fontSize: 12 }}>{error}</div>
      )}

      <div style={{ padding: 12, borderTop: '1px solid var(--color-border)' }}>
        <ChatInput
          onSend={(text) => send(text, config)}
          disabled={isSending}
          disabledReason={disabledReason}
          placeholder={isSending ? 'Generating…' : 'Ask anything…'}
        />
      </div>
    </div>
  );
}
