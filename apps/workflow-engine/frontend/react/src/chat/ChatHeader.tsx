/**
 * Chat header: model pill, web-search toggle, session-total cost chip,
 * new-chat button.
 */

import { ConfiguredProviderCard } from '../byok/ConfiguredProviderCard.js';
import type { BYOKActiveConfig } from '../byok/lib/useBYOKConfig.js';
import type { ChatSession } from './hooks/useChatSession.js';
import { formatUsd, sessionCostUsd } from './lib/cost.js';

interface Props {
  config: BYOKActiveConfig;
  onOpenSettings: () => void;
  onRemoveKey: () => void | Promise<void>;
  onNewChat: () => void;
  session: ChatSession;
  /** When non-null, render a 🌐 web-search toggle button. */
  onToggleWebSearch: (() => void) | null;
  webSearchEnabled: boolean;
}

export function ChatHeader({
  config,
  onOpenSettings,
  onRemoveKey,
  onNewChat,
  session,
  onToggleWebSearch,
  webSearchEnabled,
}: Props): JSX.Element {
  const totalCost = sessionCostUsd(session);
  const messageCount = session.messages.length;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 16px',
      borderBottom: '1px solid var(--color-border)',
      gap: 8,
    }}>
      <ConfiguredProviderCard config={config} onChange={onOpenSettings} onRemoved={onRemoveKey} compact />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {onToggleWebSearch && (
          <button
            type="button"
            onClick={onToggleWebSearch}
            title={webSearchEnabled ? 'Web search ON — next turn uses provider-native search' : 'Web search off (click to enable)'}
            aria-pressed={webSearchEnabled}
            aria-label="Toggle web search"
            style={{
              borderRadius: 12,
              padding: '2px 10px',
              fontSize: 11,
              background: webSearchEnabled ? 'var(--color-accent)' : 'var(--color-surface-2)',
              color: webSearchEnabled ? 'white' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              minHeight: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            🌐 web{webSearchEnabled ? ' on' : ''}
          </button>
        )}
        {totalCost > 0 && (
          <span
            className="status-badge"
            title={`Total session cost: ${formatUsd(totalCost)}`}
            style={{ fontSize: 11 }}
          >
            Σ {formatUsd(totalCost)}
          </span>
        )}
        {messageCount > 0 && (
          <button type="button" className="secondary" onClick={onNewChat} style={{ fontSize: 11 }} aria-label="New chat">
            New chat
          </button>
        )}
      </div>
    </div>
  );
}
