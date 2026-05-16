/**
 * Chat header: model pill, session-total cost chip, new-chat button.
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
}

export function ChatHeader({ config, onOpenSettings, onRemoveKey, onNewChat, session }: Props): JSX.Element {
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
