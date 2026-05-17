/**
 * Workflow @-mention autocomplete popover.
 *
 * Mirrors the slash-command pattern in CommandAutocomplete.tsx but
 * activates anywhere in the textarea (not just at the start) and is
 * cursor-position-aware. Mention mode triggers when the character
 * immediately preceding the cursor is `@`, OR an unbroken token
 * starting with `@` (no whitespace) sits before the cursor and is
 * itself preceded by whitespace or start-of-string.
 *
 * Keyboard: ↑↓ navigate, Enter / Tab to apply, Esc dismisses. On
 * apply, the popover hands back the new text + the new cursor
 * position so ChatInput can restore selection in the DOM.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  filterMentions,
  listWorkflowMentions,
  type WorkflowMentionEntry,
} from './lib/workflowMentions.js';

interface Props {
  text: string;
  /** Current cursor position in the textarea (selectionStart). */
  cursorPos: number;
  /** Called when the user picks a mention. The popover supplies the
   *  rebuilt text and the new cursor position; the caller restores
   *  the DOM selection. */
  onPick: (newText: string, newCursorPos: number) => void;
  /** Called on Esc. Caller decides what dismissal means (commonly a
   *  no-op — typing past the mention dismisses naturally). */
  onDismiss: () => void;
}

interface MentionState {
  /** Index of the `@` character. */
  atPos: number;
  /** Query substring between `@` and cursor (may be empty). */
  query: string;
}

/** Find an active mention near the cursor, or null if not in mention
 *  mode. The mention is active when, scanning leftward from the
 *  cursor, we hit `@` before any whitespace, AND the `@` is preceded
 *  by whitespace or start-of-string. */
function detectMention(text: string, cursorPos: number): MentionState | null {
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = text.charAt(i);
    if (ch === '@') {
      const prev = i === 0 ? '' : text.charAt(i - 1);
      if (prev === '' || /\s/.test(prev)) {
        return { atPos: i, query: text.substring(i + 1, cursorPos) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export function WorkflowMentionAutocomplete({
  text,
  cursorPos,
  onPick,
  onDismiss,
}: Props): JSX.Element | null {
  // Re-read mentions on every render so newly-saved workflows show up
  // without needing a route remount. listSavedWorkflows() touches
  // localStorage on each call but the list is tiny.
  const entries = listWorkflowMentions();
  const mention = detectMention(text, cursorPos);
  const query = mention?.query ?? '';
  const matches = useMemo(
    () => (mention ? filterMentions(entries, query) : []),
    [entries, mention, query],
  );

  const [selectedIdx, setSelectedIdx] = useState(0);
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, mention?.atPos]);

  const apply = useCallback(
    (picked: WorkflowMentionEntry): void => {
      if (!mention) return;
      const before = text.substring(0, mention.atPos);
      const after = text.substring(mention.atPos + 1 + query.length);
      const insertion = `@${picked.slug} `;
      const newText = before + insertion + after;
      const newCursorPos = before.length + insertion.length;
      onPick(newText, newCursorPos);
    },
    [mention, query, text, onPick],
  );

  useEffect(() => {
    if (!mention) return;
    function onKey(e: KeyboardEvent): void {
      if (matches.length === 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => (i + 1) % matches.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => (i - 1 + matches.length) % matches.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        // stopPropagation so the textarea's React onKeyDown does NOT
        // also see this Enter and submit the half-typed message.
        e.stopPropagation();
        const picked = matches[selectedIdx];
        if (picked) apply(picked);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mention, matches, selectedIdx, onDismiss, apply]);

  const listRef = useRef<HTMLDivElement>(null);

  if (!mention) return null;

  if (matches.length === 0) {
    return (
      <div
        ref={listRef}
        style={{
          position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: 8,
          fontSize: 12,
          color: 'var(--color-text-muted)',
          zIndex: 10,
        }}
      >
        No workflows match <code>@{query}</code>. Save one in the Workflows tab first.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Workflow mentions"
      style={{
        position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 4,
        maxHeight: 240,
        overflowY: 'auto',
        zIndex: 10,
      }}
    >
      {matches.map((entry, i) => (
        <MentionRow
          key={entry.workflowId}
          entry={entry}
          selected={i === selectedIdx}
          onClick={() => apply(entry)}
          onHover={() => setSelectedIdx(i)}
        />
      ))}
      <div
        style={{
          padding: '4px 8px',
          marginTop: 2,
          fontSize: 11,
          color: 'var(--color-text-muted)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        Tip: enable the <strong>Tools</strong> toggle so the model can invoke the mentioned workflow.
      </div>
    </div>
  );
}

function MentionRow({
  entry,
  selected,
  onClick,
  onHover,
}: {
  entry: WorkflowMentionEntry;
  selected: boolean;
  onClick: () => void;
  onHover: () => void;
}): JSX.Element {
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseEnter={onHover}
      style={{
        padding: '6px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        background: selected ? 'var(--color-surface-2)' : 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ fontWeight: 600, fontSize: 12 }}>@{entry.slug}</code>
        <span className="muted" style={{ fontSize: 11 }}>{entry.displayName}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>{entry.description}</div>
    </div>
  );
}
