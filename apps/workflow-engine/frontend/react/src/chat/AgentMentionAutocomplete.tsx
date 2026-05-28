/**
 * Agent @-mention autocomplete popover.
 *
 * Replaces the cursor-aware behaviour of the old
 * `WorkflowMentionAutocomplete` on the `@` trigger, with one
 * material difference: the popover now lists installed *agents*
 * (sourced from `GET /v1/agents` via `useAgentMentions()`), not
 * workflows. Workflows have moved to the unified `/` picker
 * (`SlashAutocomplete.tsx`) as of the 2026-05-28 mention-symbol swap.
 *
 * Trigger: when scanning leftward from the cursor we hit `@` before
 * any whitespace, AND the `@` is preceded by whitespace or
 * start-of-string. Identical detection rule to the previous workflow
 * picker — only the data source + display row changes.
 *
 * Keyboard: ↑↓ navigate, Enter / Tab to apply, Esc dismisses.
 *
 * On apply: rebuilds the textarea text with `@<persona-slug> ` and
 * hands back the new cursor position so ChatInput can restore DOM
 * selection. The actual *activation* of the agent (adding it to the
 * active-agents side panel + switching the currently-routing agent)
 * lands in phase D3, driven by the submit path's
 * `detectAgentMention()` check. For phase B2 this picker is purely a
 * text-insertion affordance.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  filterAgentMentions,
  useAgentMentions,
  type AgentMentionEntry,
} from './lib/agentMentions.js';

interface Props {
  text: string;
  cursorPos: number;
  onPick: (newText: string, newCursorPos: number) => void;
  onDismiss: () => void;
}

interface MentionState {
  /** Index of the `@` character. */
  atPos: number;
  /** Query substring between `@` and cursor (may be empty). */
  query: string;
}

/** Locate an active mention near the cursor. Symmetric to the
 *  previous workflow-mention detector — `@` must be preceded by
 *  whitespace or start-of-string, and there must be no whitespace
 *  between `@` and the cursor. */
function detectMentionState(text: string, cursorPos: number): MentionState | null {
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

export function AgentMentionAutocomplete({
  text,
  cursorPos,
  onPick,
  onDismiss,
}: Props): JSX.Element | null {
  const { entries, isLoading, error } = useAgentMentions();
  const mention = detectMentionState(text, cursorPos);
  const query = mention?.query ?? '';
  const matches = useMemo(
    () => (mention ? filterAgentMentions(entries, query) : []),
    [entries, mention, query],
  );

  const [selectedIdx, setSelectedIdx] = useState(0);
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, mention?.atPos]);

  const apply = useCallback(
    (picked: AgentMentionEntry): void => {
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
    if (!mention) return undefined;
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

  // Empty-state branches: distinct copy for "still loading", "host
  // doesn't have any agents installed", and "user query matches
  // nothing". Each tells the user something different about how to
  // recover — generic "no matches" hides the load + zero-installed
  // cases behind the same text.
  if (isLoading && entries.length === 0) {
    return (
      <EmptyPanel listRef={listRef}>
        Loading agents…
      </EmptyPanel>
    );
  }
  if (error) {
    return (
      <EmptyPanel listRef={listRef} tone="error">
        Couldn't load agents: {error}.
      </EmptyPanel>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyPanel listRef={listRef}>
        No agents installed yet. Visit the <strong>Agents</strong> tab to
        install one from the registry or author your own.
      </EmptyPanel>
    );
  }
  if (matches.length === 0) {
    return (
      <EmptyPanel listRef={listRef}>
        No agents match <code>@{query}</code>.
      </EmptyPanel>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Agent mentions"
      style={{
        position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 4,
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 10,
      }}
    >
      {matches.map((entry, i) => (
        <AgentRow
          key={entry.agentId}
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
        Tip: @-mentioning an agent adds it to your active-agents lineup and
        switches the conversation through it.
      </div>
    </div>
  );
}

function EmptyPanel({
  listRef,
  children,
  tone = 'muted',
}: {
  listRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
  tone?: 'muted' | 'error';
}): JSX.Element {
  return (
    <div
      ref={listRef}
      style={{
        position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
        background: 'var(--color-surface)',
        border: `1px solid ${tone === 'error' ? 'var(--color-danger)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)',
        padding: 8,
        fontSize: 12,
        color: tone === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)',
        zIndex: 10,
      }}
    >
      {children}
    </div>
  );
}

function AgentRow({
  entry,
  selected,
  onClick,
  onHover,
}: {
  entry: AgentMentionEntry;
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code style={{ fontWeight: 600, fontSize: 12 }}>@{entry.slug}</code>
        <span className="muted" style={{ fontSize: 11 }}>{entry.displayName}</span>
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 8,
            background: 'var(--color-surface-2)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--mono)',
          }}
        >
          {entry.modelClass}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>{entry.description}</div>
    </div>
  );
}
