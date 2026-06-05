/**
 * Auto-resizing textarea + send / stop / mic buttons + pending-audio
 * attachment chip.
 *
 * Voice input uses MediaRecorder (multi-modal). The recorded audio
 * blob is attached to the next send() as a ContentPart, and the
 * model (Gemini today; Anthropic/OpenAI Phase 4 v2) transcribes
 * implicitly as part of its response. Bypasses the Web Speech API
 * entirely — no Google-cloud dependency, works in Firefox.
 *
 * Keyboard contract:
 *   - Enter (no modifier) → send
 *   - Shift+Enter → newline
 *   - Esc (while streaming) → cancel
 */

import { useEffect, useRef, useState } from 'react';
import { useAudioRecorder, blobToBase64, type RecordedAudio } from './hooks/useAudioRecorder.js';
import { SlashAutocomplete } from './SlashAutocomplete.js';
import { AgentMentionAutocomplete } from './AgentMentionAutocomplete.js';
import { MicIcon, SendIcon, StopIcon, PaperclipIcon, XIcon, AlertIcon } from '../ui/icons/index.js';
import {
  fileToContentPart,
  attachmentRejectionReason,
  isImageMime,
  mimeOf,
  ATTACHMENT_ACCEPT,
} from '../client/mediaClient.js';
import type { ContentPart } from './hooks/useChatSession.js';

interface PendingAudio {
  id: string;
  audio: RecordedAudio;
}

interface PendingFile {
  id: string;
  file: File;
  isImage: boolean;
  /** Object URL for an image thumbnail; revoked on remove/submit. */
  previewUrl?: string;
}

interface Props {
  onSend: (text: string, attachments?: readonly ContentPart[]) => void;
  /** When provided AND `disabled` is true (turn in flight), Send morphs into Stop. */
  onCancel?: (() => void | Promise<void>) | null;
  disabled?: boolean;
  placeholder?: string;
  /** Reason the send button is disabled, shown in title tooltip. */
  disabledReason?: string;
  /** Hint that the active provider supports audio input. When false,
   *  the mic still records, but on send we'll surface a clear error
   *  rather than ship audio to an incompatible model. */
  supportsAudioInput?: boolean;
  /** Hint that the active model accepts image input (vision). When false,
   *  an attached image is flagged with a "switch models" warning. */
  supportsImageInput?: boolean;
  /** Hint that the active model accepts PDF documents (Anthropic / Gemini).
   *  Text files (.txt/.md/.json/.csv) inline as text and work everywhere. */
  supportsPdfInput?: boolean;
}

export function ChatInput({
  onSend,
  onCancel,
  disabled,
  placeholder,
  disabledReason,
  supportsAudioInput,
  supportsImageInput,
  supportsPdfInput,
}: Props): JSX.Element {
  const [text, setText] = useState('');
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [pendingFiles, setPendingFiles] = useState<readonly PendingFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracked for the @-mention popover. Synced from onChange / onSelect
  // / onClick / onKeyUp on the textarea so the popover sees the live
  // caret position.
  const [cursorPos, setCursorPos] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function syncCursor(): void {
    const el = taRef.current;
    if (!el) return;
    setCursorPos(el.selectionStart ?? 0);
  }

  const recorder = useAudioRecorder();

  // Auto-resize: clamp scrollHeight to var(--chat-input-height-max) (120px).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Revoke any outstanding image-thumbnail object URLs on unmount.
  useEffect(() => () => {
    for (const f of pendingFiles) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
  }, [pendingFiles]);

  function addFiles(files: FileList | null): void {
    if (!files || files.length === 0) return;
    const accepted: PendingFile[] = [];
    let firstReason: string | null = null;
    for (const file of Array.from(files)) {
      const reason = attachmentRejectionReason(file);
      if (reason) { firstReason ??= reason; continue; }
      const isImage = isImageMime(mimeOf(file));
      accepted.push({
        id: crypto.randomUUID(),
        file,
        isImage,
        ...(isImage ? { previewUrl: URL.createObjectURL(file) } : {}),
      });
    }
    setAttachError(firstReason);
    if (accepted.length > 0) setPendingFiles((prev) => [...prev, ...accepted]);
  }

  function removeFile(id: string): void {
    setPendingFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }

  function clearPendingFiles(files: readonly PendingFile[]): void {
    for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    setPendingFiles([]);
  }

  async function submit(): Promise<void> {
    if (disabled) return;
    if (!text.trim() && !pendingAudio && pendingFiles.length === 0) return;
    const attachments: ContentPart[] = [];
    if (pendingAudio) {
      const dataBase64 = await blobToBase64(pendingAudio.audio.blob);
      attachments.push({
        type: 'audio',
        mimeType: pendingAudio.audio.mimeType,
        dataBase64,
        durationSeconds: pendingAudio.audio.durationSeconds,
      });
    }
    // Convert pending files (inline small / upload large). If any fail, abort
    // the send and surface the error rather than silently dropping the file.
    try {
      for (const pf of pendingFiles) {
        attachments.push(await fileToContentPart(pf.file));
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Attachment failed.');
      return;
    }
    onSend(text.trim(), attachments.length > 0 ? attachments : undefined);
    setText('');
    setPendingAudio(null);
    clearPendingFiles(pendingFiles);
    setAttachError(null);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Belt-and-braces: any popover (SlashAutocomplete, the @-mention
    // popover, future popovers) should stopPropagation on the native
    // event so React's synthetic handler never sees the key — but if
    // a future popover forgets, the `defaultPrevented` check here is
    // a backstop that prevents submitting a half-typed command/mention.
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && disabled && onCancel) {
      e.preventDefault();
      void onCancel();
    }
  }

  async function toggleVoice(): Promise<void> {
    if (recorder.isRecording) {
      const audio = await recorder.stop();
      if (audio) {
        setPendingAudio({ id: crypto.randomUUID(), audio });
      }
    } else {
      await recorder.start();
    }
  }

  const canSend = !disabled && (text.trim().length > 0 || pendingAudio !== null || pendingFiles.length > 0);

  return (
    <div style={{ position: 'relative' }}>
      {/* Unified slash picker — shows built-in commands AND
          registered workflows in one menu, grouped under subheads.
          Replaces the prior CommandAutocomplete after the 2026-05-28
          mention-symbol swap (`@` is now agents, `/` is unified). */}
      <SlashAutocomplete
        text={text}
        onPick={(newText) => { setText(newText); taRef.current?.focus(); }}
        onDismiss={() => { /* dismiss is implicit on text change */ }}
      />
      {/* `@` picker — agents only (was workflows pre-2026-05-28).
          Workflows live under `/` in SlashAutocomplete above. */}
      <AgentMentionAutocomplete
        text={text}
        cursorPos={cursorPos}
        onPick={(newText, newCursorPos) => {
          setText(newText);
          // Restore the cursor after React commits the new value.
          requestAnimationFrame(() => {
            const el = taRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(newCursorPos, newCursorPos);
            setCursorPos(newCursorPos);
          });
        }}
        onDismiss={() => { /* dismiss is implicit on text/cursor change */ }}
      />
      {pendingAudio && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            marginBottom: 6,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            fontSize: 12,
          }}
        >
          <MicIcon size={14} />
          <span style={{ flex: 1 }}>
            Voice attachment ({pendingAudio.audio.durationSeconds.toFixed(1)}s, {pendingAudio.audio.mimeType.split(';')[0]})
            {supportsAudioInput === false && (
              <span style={{ color: 'var(--color-warning)', marginLeft: 6 }}>
                — current model doesn't accept audio. Switch to a Gemini model or remove the attachment.
              </span>
            )}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => setPendingAudio(null)}
            style={{ padding: '2px 8px', fontSize: 11, minHeight: 0 }}
            aria-label="Remove voice attachment"
          >
            Remove
          </button>
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {pendingFiles.map((pf) => {
            const isPdf = pf.file.type === 'application/pdf';
            const cantSend =
              (pf.isImage && supportsImageInput === false) ||
              (isPdf && supportsPdfInput === false);
            return (
              <div
                key={pf.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  background: 'var(--color-surface-2)',
                  border: `1px solid ${cantSend ? 'var(--color-warning)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                  maxWidth: 220,
                }}
                title={cantSend ? "The current model can't read this attachment — switch to a vision/PDF-capable model." : pf.file.name}
              >
                {pf.isImage && pf.previewUrl ? (
                  <img
                    src={pf.previewUrl}
                    alt={pf.file.name}
                    style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 3 }}
                  />
                ) : (
                  <PaperclipIcon size={14} />
                )}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pf.file.name}
                </span>
                {cantSend && (
                  <span style={{ color: 'var(--color-warning)', display: 'inline-flex' }} title="Unsupported by the current model">
                    <AlertIcon size={12} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(pf.id)}
                  aria-label={`Remove ${pf.file.name}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--color-text-muted, var(--color-text))', minHeight: 0,
                  }}
                >
                  <XIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {attachError && (
        <div className="alert error" style={{ marginBottom: 6, fontSize: 11 }}>{attachError}</div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
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
          onChange={(e) => { setText(e.target.value); setCursorPos(e.target.selectionStart ?? 0); }}
          onKeyDown={onKey}
          onKeyUp={syncCursor}
          onSelect={syncCursor}
          onClick={syncCursor}
          placeholder={recorder.isRecording ? 'Recording…' : (placeholder ?? 'Ask anything…')}
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
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach a file (images, PDF, .txt/.md/.json/.csv)"
          aria-label="Attach a file"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%',
            minWidth: 36, width: 36, height: 36,
            padding: 0,
            background: 'var(--color-surface-2)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          <PaperclipIcon size={18} />
        </button>
        {recorder.isSupported && (
          <button
            type="button"
            onClick={() => { void toggleVoice(); }}
            disabled={disabled && !recorder.isRecording}
            title={recorder.isRecording ? 'Stop recording' : 'Record voice attachment'}
            aria-label={recorder.isRecording ? 'Stop voice recording' : 'Start voice recording'}
            aria-pressed={recorder.isRecording}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%',
              minWidth: 36, width: 36, height: 36,
              padding: 0,
              background: recorder.isRecording ? 'var(--color-danger)' : 'var(--color-surface-2)',
              color: recorder.isRecording ? 'white' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              animation: recorder.isRecording ? 'openwop-mic-pulse 1.2s ease-in-out infinite' : 'none',
            }}
          >
            <MicIcon size={18} />
          </button>
        )}
        {disabled && onCancel ? (
          <button
            type="button"
            onClick={() => { void onCancel(); }}
            title="Stop generating (Esc)"
            aria-label="Stop generating"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%',
              minWidth: 36, width: 36, height: 36,
              padding: 0,
              background: 'var(--color-danger)',
              color: 'white',
            }}
          >
            <StopIcon size={12} />
          </button>
        ) : (
          <button
            type="button"
            className="btn-accent-solid"
            onClick={() => { void submit(); }}
            disabled={!canSend}
            title={!canSend && disabledReason ? disabledReason : 'Send (Enter)'}
            aria-label="Send"
            style={{
              borderRadius: '50%',
              minWidth: 36, width: 36, height: 36,
              padding: 0,
              justifyContent: 'center',
            }}
          >
            <SendIcon size={16} />
          </button>
        )}
      </div>
      {recorder.error && (
        <div className="alert error" style={{ marginTop: 6, fontSize: 11 }}>{recorder.error}</div>
      )}
    </div>
  );
}
