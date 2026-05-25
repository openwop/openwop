/**
 * Chat header: model pill, web-search toggle, session-total cost chip,
 * new-chat button.
 */

import { ConfiguredProviderCard } from '../byok/ConfiguredProviderCard.js';
import type { BYOKActiveConfig } from '../byok/lib/useBYOKConfig.js';
import type { ChatSession } from './hooks/useChatSession.js';
import { formatUsd, sessionCostUsd } from './lib/cost.js';
import { GlobeIcon } from './icons/index.js';

interface Props {
  config: BYOKActiveConfig;
  onOpenSettings: () => void;
  onRemoveKey: () => void | Promise<void>;
  onNewChat: () => void;
  session: ChatSession;
  /** When non-null, render a globe-icon web-search toggle button. */
  onToggleWebSearch: (() => void) | null;
  webSearchEnabled: boolean;
  /** When non-null, render a tools toggle button. Anthropic only for v1. */
  onToggleTools: (() => void) | null;
  toolsEnabled: boolean;
  /** When set, render a hamburger-style history toggle in the header. */
  onToggleHistory?: () => void;
  historyOpen?: boolean;
  /** When set, render a right-side workflow-progress panel toggle. */
  onToggleProgress?: () => void;
  progressOpen?: boolean;
  /** Number of workflow_run messages in the session — small badge on
   *  the progress toggle button so users with multiple in-flight runs
   *  see at a glance how many the panel covers. */
  progressBadgeCount?: number;
}

export function ChatHeader({
  config,
  onOpenSettings,
  onRemoveKey,
  onNewChat,
  session,
  onToggleWebSearch,
  webSearchEnabled,
  onToggleTools,
  toolsEnabled,
  onToggleHistory,
  historyOpen,
  onToggleProgress,
  progressOpen,
  progressBadgeCount = 0,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {onToggleHistory && (
          <button
            type="button"
            className="secondary"
            onClick={onToggleHistory}
            aria-label={historyOpen ? 'Close chat history' : 'Open chat history'}
            aria-pressed={historyOpen}
            title="Saved chats"
            style={{ padding: '2px 8px', fontSize: 11, minHeight: 0, height: 24 }}
          >
            ☰
          </button>
        )}
        <ConfiguredProviderCard config={config} onChange={onOpenSettings} onRemoved={onRemoveKey} compact />
      </div>
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
            <GlobeIcon size={12} /> web{webSearchEnabled ? ' on' : ''}
          </button>
        )}
        {onToggleTools && (
          <button
            type="button"
            onClick={onToggleTools}
            title={toolsEnabled
              ? 'Tools ON — the AI can call saved workflows as tools this turn'
              : 'Tools off (click to enable). Lets the AI invoke saved workflows.'}
            aria-pressed={toolsEnabled}
            aria-label="Toggle workflow tools"
            style={{
              borderRadius: 12,
              padding: '2px 10px',
              fontSize: 11,
              background: toolsEnabled ? 'var(--color-accent)' : 'var(--color-surface-2)',
              color: toolsEnabled ? 'white' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              minHeight: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            🔧 tools{toolsEnabled ? ' on' : ''}
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
        {onToggleProgress && (
          <button
            type="button"
            className="secondary"
            onClick={onToggleProgress}
            aria-label={progressOpen ? 'Close workflow progress panel' : 'Open workflow progress panel'}
            aria-pressed={progressOpen}
            title="Workflow progress"
            style={{
              padding: '2px 8px',
              fontSize: 11,
              minHeight: 0,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span aria-hidden>≡</span>
            {progressBadgeCount > 0 && (
              <span style={{
                fontSize: 10,
                minWidth: 14,
                padding: '0 4px',
                borderRadius: 8,
                background: 'var(--color-accent, var(--clay))',
                color: 'white',
                textAlign: 'center',
                lineHeight: '14px',
              }}>{progressBadgeCount}</span>
            )}
          </button>
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
