/**
 * Auto-resizing textarea + send / stop / mic buttons.
 *
 * Keyboard contract:
 *   - Enter (no modifier) → send
 *   - Shift+Enter → newline
 *   - Esc (while streaming) → cancel
 *
 * Mic button shown only when the browser supports SpeechRecognition.
 * During recording, the textarea shows the interim transcript live;
 * on stop, the final transcript replaces the contents (user can edit
 * before sending).
 */

import { useEffect, useRef, useState } from 'react';
import { useVoiceInput } from './hooks/useVoiceInput.js';
import { CommandAutocomplete } from './CommandAutocomplete.js';

interface Props {
  onSend: (text: string) => void;
  /** When provided AND `disabled` is true (turn in flight), Send morphs into Stop. */
  onCancel?: (() => void | Promise<void>) | null;
  disabled?: boolean;
  placeholder?: string;
  /** Reason the send button is disabled, shown in title tooltip. */
  disabledReason?: string;
}

export function ChatInput({ onSend, onCancel, disabled, placeholder, disabledReason }: Props): JSX.Element {
  const [text, setText] = useState('');
  /** Saved text when voice recording starts, so the interim transcript
   *  doesn't clobber what the user already typed. */
  const textBeforeVoiceRef = useRef('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const voice = useVoiceInput({
    onInterim: (interim) => {
      setText((textBeforeVoiceRef.current ? textBeforeVoiceRef.current + ' ' : '') + interim);
    },
    onFinal: (final) => {
      setText((textBeforeVoiceRef.current ? textBeforeVoiceRef.current + ' ' : '') + final);
    },
  });

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
    textBeforeVoiceRef.current = '';
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && disabled && onCancel) {
      e.preventDefault();
      void onCancel();
    }
  }

  function toggleVoice(): void {
    if (voice.isRecording) {
      voice.stop();
    } else {
      // Snapshot current text so voice transcript appends rather than replaces.
      textBeforeVoiceRef.current = text;
      voice.start();
    }
  }

  const canSend = !disabled && text.trim().length > 0;

  return (
    <div style={{ position: 'relative' }}>
      <CommandAutocomplete
        text={text}
        onPick={(name) => { setText(name + ' '); taRef.current?.focus(); }}
        onDismiss={() => { /* The Esc handler in onKey will already cancel a stream; here we just want to dismiss the popover, which is automatic when text changes — no-op. */ }}
      />
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
          placeholder={voice.isRecording ? 'Listening…' : (placeholder ?? 'Ask anything…')}
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
        {voice.isSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={disabled && !voice.isRecording}
            title={voice.isRecording ? 'Stop recording' : 'Start voice input'}
            aria-label={voice.isRecording ? 'Stop voice input' : 'Start voice input'}
            aria-pressed={voice.isRecording}
            style={{
              borderRadius: '50%',
              minWidth: 36, width: 36, height: 36,
              padding: 0,
              fontSize: 16,
              background: voice.isRecording ? 'var(--color-danger)' : 'var(--color-surface-2)',
              color: voice.isRecording ? 'white' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              animation: voice.isRecording ? 'openwop-mic-pulse 1.2s ease-in-out infinite' : 'none',
            }}
          >
            🎤
          </button>
        )}
        {disabled && onCancel ? (
          <button
            type="button"
            onClick={() => { void onCancel(); }}
            title="Stop generating (Esc)"
            aria-label="Stop generating"
            style={{
              borderRadius: '50%',
              minWidth: 36, width: 36, height: 36,
              padding: 0,
              background: 'var(--color-danger)',
              color: 'white',
            }}
          >
            <span style={{ display: 'inline-block', width: 10, height: 10, background: 'currentColor', verticalAlign: 'middle' }} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            title={!canSend && disabledReason ? disabledReason : 'Send (Enter)'}
            aria-label="Send"
            style={{
              borderRadius: '50%',
              minWidth: 36, width: 36, height: 36,
              padding: 0,
              fontSize: 16,
            }}
          >
            ↑
          </button>
        )}
      </div>
      {voice.error && (
        <div className="alert error" style={{ marginTop: 6, fontSize: 11 }}>{voice.error}</div>
      )}
    </div>
  );
}
