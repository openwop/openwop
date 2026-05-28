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
  /** Toggle the left rail (which hosts History / Progress / Agents
   *  tabs). The single button replaces the three per-panel toggles
   *  the header used to render. */
  onToggleRail?: () => void;
  railOpen?: boolean;
  /** Sum of workflow_runs + activated agents — surfaced as a badge on
   *  the rail toggle so the user sees pending work without opening
   *  the rail. */
  railBadgeCount?: number;
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
  onToggleRail,
  railOpen,
  railBadgeCount = 0,
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
        {onToggleRail && (
          <button
            type="button"
            className="secondary"
            onClick={onToggleRail}
            aria-label={railOpen ? 'Close chat tools' : 'Open chat tools'}
            aria-pressed={railOpen}
            title="History, workflow progress, and active agents"
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
            <span aria-hidden>☰</span>
            {railBadgeCount > 0 && (
              <span style={{
                fontSize: 10,
                minWidth: 14,
                padding: '0 4px',
                borderRadius: 8,
                background: 'var(--color-accent, var(--clay))',
                color: 'white',
                textAlign: 'center',
                lineHeight: '14px',
              }}>{railBadgeCount}</span>
            )}
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
        {messageCount > 0 && (
          <button type="button" className="secondary" onClick={onNewChat} style={{ fontSize: 11 }} aria-label="New chat">
            New chat
          </button>
        )}
      </div>
    </div>
  );
}
