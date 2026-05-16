/**
 * Auto-resizing textarea + send button. MyndHyve pattern:
 *   - Enter sends; Shift+Enter newlines
 *   - max-height 120px (~3 rows); scrolls beyond
 *   - send button disabled when (empty) OR (sending)
 *
 * Slash-commands / @-mentions / attachments are out of Phase 1 scope.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Reason the send button is disabled, shown in title tooltip. */
  disabledReason?: string;
}

export function ChatInput({ onSend, disabled, placeholder, disabledReason }: Props): JSX.Element {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: clamp scrollHeight to var(--chat-input-height-max) (120px).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  function submit(): void {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
    }
  }

  const canSend = !disabled && text.trim().length > 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      padding: 8,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-pill, 24px)',
    }}>
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={placeholder ?? 'Ask anything…'}
        disabled={disabled}
        spellCheck={false}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          maxHeight: 'var(--chat-input-height-max, 120px)',
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 14,
          color: 'var(--color-text)',
          width: '100%',
        }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSend}
        title={!canSend && disabledReason ? disabledReason : 'Send (Enter)'}
        style={{
          borderRadius: '50%',
          minWidth: 36, width: 36, height: 36,
          padding: 0,
          fontSize: 16,
        }}
        aria-label="Send"
      >
        ↑
      </button>
    </div>
  );
}
