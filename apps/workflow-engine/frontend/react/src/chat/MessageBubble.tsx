/**
 * Single chat message bubble. User vs assistant differentiated by:
 *   - alignment (right vs left)
 *   - background (accent vs surface-2)
 *   - text color (white vs default)
 *
 * Streaming bubbles get a subtle pulsing cursor at the end of content.
 * Bubbles with `meta.error` render in a warn-tinted state.
 */

import type { ChatMessage } from './hooks/useChatSession.js';

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props): JSX.Element {
  const isUser = message.role === 'user';
  const isError = !!message.meta?.error;

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: 'var(--max-bubble-width, 75ch)',
        padding: '8px 12px',
        borderRadius: 'var(--radius-bubble, 16px)',
        background: isError
          ? 'rgba(248, 113, 113, 0.1)'
          : isUser
            ? 'var(--color-msg-user-bg, var(--color-accent))'
            : 'var(--color-msg-assistant-bg, var(--color-surface-2))',
        color: isUser ? 'var(--color-msg-user-text, #ffffff)' : 'var(--color-text)',
        border: isError ? '1px solid var(--color-danger)' : '1px solid transparent',
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {message.content || (message.isStreaming && (
          <span style={{ opacity: 0.6 }}>Thinking…</span>
        ))}
        {message.isStreaming && message.content.length > 0 && (
          <span style={{
            display: 'inline-block',
            width: 8, height: 12,
            background: 'currentColor',
            marginLeft: 2,
            verticalAlign: 'text-bottom',
            opacity: 0.7,
            animation: 'openwop-pulse 1s steps(2, end) infinite',
          }} />
        )}
        {message.meta?.error && (
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>
            <strong>{message.meta.error.code}:</strong> {message.meta.error.message}
          </div>
        )}
        {!isUser && !message.isStreaming && message.meta && !message.meta.error && (
          <div className="muted" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
            {message.meta.provider && message.meta.model && (
              <span>{message.meta.provider}/{message.meta.model}</span>
            )}
            {message.meta.inputTokens != null && (
              <span> · in {message.meta.inputTokens}</span>
            )}
            {message.meta.outputTokens != null && (
              <span> · out {message.meta.outputTokens}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
