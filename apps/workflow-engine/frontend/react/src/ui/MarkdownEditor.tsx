/**
 * MarkdownEditor — a lightweight Markdown editing surface for the agent
 * persona/instructions/task surfaces. A textarea with a formatting toolbar
 * (bold, italic, heading, link, bullet/numbered/check lists, quote, inline
 * code, code block), a Write ⇄ Preview toggle (preview renders through the
 * shared `ui/Markdown` renderer), a character count with optional max, and
 * optional localStorage-backed draft autosave.
 *
 * Deliberately NOT a WYSIWYG/contenteditable editor: the underlying value is
 * always Markdown text (what the host stores + what `ui/Markdown` renders), so
 * the editor stays a thin, controlled wrapper over a <textarea>. The toolbar
 * mutates the textarea's selection and bubbles the new string up via onChange.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Markdown } from './Markdown.js';
import {
  BoldIcon,
  ItalicIcon,
  HeadingIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  CodeIcon,
  CodeBlockIcon,
} from './icons/index.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

interface ToolbarAction {
  key: string;
  label: string;
  icon: JSX.Element;
  /** Wrap the selection with `prefix`…`suffix` (inline emphasis / code). */
  wrap?: { prefix: string; suffix: string; placeholder: string };
  /** Prefix each selected line (lists / quote / heading). */
  linePrefix?: string;
  /** Insert a fenced code block around the selection. */
  fence?: boolean;
  /** Insert a markdown link `[text](url)`. */
  link?: boolean;
}

const ICON = 14;

function actions(compact: boolean): readonly ToolbarAction[] {
  const full: ToolbarAction[] = [
    { key: 'bold', label: 'Bold', icon: <BoldIcon size={ICON} />, wrap: { prefix: '**', suffix: '**', placeholder: 'bold text' } },
    { key: 'italic', label: 'Italic', icon: <ItalicIcon size={ICON} />, wrap: { prefix: '_', suffix: '_', placeholder: 'italic text' } },
    { key: 'heading', label: 'Heading', icon: <HeadingIcon size={ICON} />, linePrefix: '## ' },
    { key: 'link', label: 'Link', icon: <LinkIcon size={ICON} />, link: true },
    { key: 'ul', label: 'Bulleted list', icon: <ListIcon size={ICON} />, linePrefix: '- ' },
    { key: 'ol', label: 'Numbered list', icon: <ListOrderedIcon size={ICON} />, linePrefix: '1. ' },
    { key: 'check', label: 'Checklist', icon: <CheckSquareIcon size={ICON} />, linePrefix: '- [ ] ' },
    { key: 'quote', label: 'Quote', icon: <QuoteIcon size={ICON} />, linePrefix: '> ' },
    { key: 'code', label: 'Inline code', icon: <CodeIcon size={ICON} />, wrap: { prefix: '`', suffix: '`', placeholder: 'code' } },
    { key: 'codeblock', label: 'Code block', icon: <CodeBlockIcon size={ICON} />, fence: true },
  ];
  // Compact surfaces (board cards) get just the inline-emphasis essentials.
  return compact ? full.filter((a) => ['bold', 'italic', 'link', 'ul', 'code'].includes(a.key)) : full;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** Soft maximum — flagged in the count + an inline notice, not hard-enforced. */
  maxLength?: number;
  monospace?: boolean;
  /** localStorage key. When set, in-progress text is autosaved and offered
   *  for recovery on mount if a newer draft exists. */
  autosaveKey?: string;
  /** Fewer toolbar buttons + no Preview tab (e.g. small board-card fields). */
  compact?: boolean;
  ariaLabel?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  rows = 6,
  placeholder,
  maxLength,
  monospace = false,
  autosaveKey,
  compact = false,
  ariaLabel,
}: MarkdownEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<string | null>(null);
  const tabId = useId();

  // On mount: surface a recoverable draft if one was autosaved and differs
  // from the value the parent loaded (e.g. a refresh mid-edit).
  useEffect(() => {
    if (!autosaveKey) return;
    try {
      const saved = window.localStorage.getItem(autosaveKey);
      if (saved && saved !== value && saved.trim()) setRecoverable(saved);
    } catch {
      /* localStorage unavailable (private mode); skip draft recovery */
    }
    // intentionally mount-only — value churn during editing must not re-offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave of in-progress text.
  useEffect(() => {
    if (!autosaveKey) return;
    const t = setTimeout(() => {
      try {
        if (value.trim()) {
          window.localStorage.setItem(autosaveKey, value);
          setDraftStatus('Draft saved');
        } else {
          window.localStorage.removeItem(autosaveKey);
          setDraftStatus(null);
        }
      } catch {
        /* ignore quota / private-mode errors */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [value, autosaveKey]);

  const apply = useCallback(
    (action: ToolbarAction) => {
      const ta = ref.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.slice(start, end);
      let next = value;
      let caretStart = start;
      let caretEnd = end;

      if (action.wrap) {
        const body = selected || action.wrap.placeholder;
        const insert = `${action.wrap.prefix}${body}${action.wrap.suffix}`;
        next = value.slice(0, start) + insert + value.slice(end);
        caretStart = start + action.wrap.prefix.length;
        caretEnd = caretStart + body.length;
      } else if (action.fence) {
        const body = selected || 'code';
        const insert = `\n\`\`\`\n${body}\n\`\`\`\n`;
        next = value.slice(0, start) + insert + value.slice(end);
        caretStart = start + 5; // after "\n```\n"
        caretEnd = caretStart + body.length;
      } else if (action.link) {
        const text = selected || 'link text';
        const insert = `[${text}](https://)`;
        next = value.slice(0, start) + insert + value.slice(end);
        // place caret inside the (url) parens
        caretStart = start + insert.length - 1;
        caretEnd = caretStart;
      } else if (action.linePrefix) {
        // Prefix every line touched by the selection (or the caret's line).
        const lp = action.linePrefix;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const segEnd = end > start ? end : start;
        const before = value.slice(0, lineStart);
        const region = value.slice(lineStart, segEnd);
        const after = value.slice(segEnd);
        const prefixed = region
          .split('\n')
          .map((ln) => (ln.startsWith(lp) ? ln : lp + ln))
          .join('\n');
        next = before + prefixed + after;
        caretStart = lineStart;
        caretEnd = lineStart + prefixed.length;
      }

      onChange(next);
      // Restore focus + selection after React commits the new value.
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(caretStart, caretEnd);
      });
    },
    [value, onChange],
  );

  const over = maxLength != null && value.length > maxLength;

  return (
    <div>
      <div
        className="action-bar"
        style={{ gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: 'var(--space-1)', alignItems: 'center' }}
        role="toolbar"
        aria-label="Formatting"
      >
        {actions(compact).map((a) => (
          <button
            key={a.key}
            type="button"
            className="secondary btn-sm"
            title={a.label}
            aria-label={a.label}
            disabled={mode === 'preview'}
            onClick={() => apply(a)}
            style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0, padding: '2px 6px' }}
          >
            {a.icon}
          </button>
        ))}
        {!compact ? (
          <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 'var(--space-1)' }}>
            <button
              type="button"
              className={mode === 'write' ? 'primary btn-sm' : 'secondary btn-sm'}
              aria-pressed={mode === 'write'}
              onClick={() => setMode('write')}
            >
              Write
            </button>
            <button
              type="button"
              className={mode === 'preview' ? 'primary btn-sm' : 'secondary btn-sm'}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              Preview
            </button>
          </div>
        ) : null}
      </div>

      {recoverable != null ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap',
            fontSize: '0.78rem', marginBottom: 'var(--space-1)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '4px 8px',
            background: 'var(--color-surface-2)',
          }}
        >
          <span style={muted}>An unsaved draft was found.</span>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => { onChange(recoverable); setRecoverable(null); }}
          >
            Restore draft
          </button>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => {
              if (autosaveKey) { try { window.localStorage.removeItem(autosaveKey); } catch { /* ignore */ } }
              setRecoverable(null);
            }}
          >
            Discard
          </button>
        </div>
      ) : null}

      {mode === 'write' ? (
        <textarea
          ref={ref}
          id={tabId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="ui-input"
          style={{ width: '100%', fontFamily: monospace ? 'var(--font-mono, monospace)' : 'inherit', fontSize: '0.85rem' }}
        />
      ) : (
        <div
          className="surface-card"
          style={{ padding: 'var(--space-2) var(--space-2-5)', minHeight: `${rows * 1.4}em` }}
        >
          {value.trim() ? <Markdown>{value}</Markdown> : <span style={muted}>Nothing to preview yet.</span>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        <span style={{ ...muted, fontSize: '0.72rem' }}>
          {draftStatus ?? 'Markdown supported'}
        </span>
        {maxLength != null ? (
          <span style={{ fontSize: '0.72rem', color: over ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
            {value.length} / {maxLength}
          </span>
        ) : (
          <span style={{ ...muted, fontSize: '0.72rem' }}>{value.length} chars</span>
        )}
      </div>
      {over ? (
        <div style={{ fontSize: '0.72rem', color: 'var(--color-danger)', marginTop: 2 }}>
          Over the suggested {maxLength} characters — consider trimming.
        </div>
      ) : null}
    </div>
  );
}
