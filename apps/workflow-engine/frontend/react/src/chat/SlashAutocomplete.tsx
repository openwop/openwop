/**
 * Unified slash-prefix picker — shows both built-in commands AND
 * registered workflows in one popover, grouped under subheads.
 *
 * Replaces the previous `CommandAutocomplete` (commands only) as part
 * of the 2026-05-28 mention-symbol swap:
 *   `@` → agents (new) — see AgentMentionAutocomplete.tsx (phase B2)
 *   `/` → commands + workflows (this file) — was just commands before
 *
 * Trigger: text starts with `/` and has no space yet (args mode hides
 * the picker so commands like `/help search-term` can type freely).
 *
 * Keyboard:
 *   ↑ ↓     navigate (wraps around)
 *   Enter   apply highlighted row
 *   Tab     apply highlighted row (no submit-Enter race)
 *   Esc     dismiss
 *
 * On apply:
 *   - Command row → insert `/clear ` (or `/help`, etc.) into textarea.
 *     The submit path's `findCommand()` matches it on Enter.
 *   - Workflow row → insert `/hello-world ` into textarea. The submit
 *     path's `detectWorkflowSlashMention()` matches it on Enter and
 *     dispatches through `runWorkflowMention()`.
 *
 * Built-in commands sort first so newcomers see `/clear /help /stop`
 * before a long list of user-defined workflows. Workflows then sort
 * alphabetically. The two groups carry visible subheads ("Commands" /
 * "Workflows") so the user knows they're choosing between two
 * distinct surfaces, not one homogeneous list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands, type CommandRegistration } from './registry/CommandRegistry.js';
import {
  filterMentions,
  listWorkflowMentions,
  type WorkflowMentionEntry,
} from './lib/workflowMentions.js';

/** A row in the unified menu. The discriminator drives both the
 *  rendered shape (commands carry usage hint; workflows carry slug +
 *  description) and what `onPick` returns. */
type SlashRow =
  | { kind: 'command'; cmd: CommandRegistration }
  | { kind: 'workflow'; wf: WorkflowMentionEntry };

interface Props {
  text: string;
  /** Called with the new textarea contents on selection. The caller
   *  is responsible for focus + cursor placement. */
  onPick: (newText: string) => void;
  /** Called on Esc. Caller usually no-ops (the picker dismisses
   *  naturally on text change). */
  onDismiss: () => void;
}

export function SlashAutocomplete({ text, onPick, onDismiss }: Props): JSX.Element | null {
  const trimmed = text.trimStart();
  const shouldShow = trimmed.startsWith('/') && !trimmed.includes(' ');
  const query = shouldShow ? trimmed.slice(1) : '';

  // Re-source on every render so a newly-saved workflow shows up
  // without needing a route remount. `listWorkflowMentions()`
  // touches localStorage but the list is tiny.
  const allWorkflows = listWorkflowMentions();
  const commandMatches = useMemo(
    () => (shouldShow ? filterCommands(query) : []),
    [shouldShow, query],
  );
  const workflowMatches = useMemo(
    () => (shouldShow ? filterMentions(allWorkflows, query) : []),
    [shouldShow, allWorkflows, query],
  );

  // Single flat row list backs the keyboard handler + index math.
  // Order: all commands, then all workflows. Subhead rows live in
  // the rendered output but aren't part of `rows` (they're not
  // selectable).
  const rows: SlashRow[] = useMemo(() => {
    const out: SlashRow[] = [];
    for (const cmd of commandMatches) out.push({ kind: 'command', cmd });
    for (const wf of workflowMatches) out.push({ kind: 'workflow', wf });
    return out;
  }, [commandMatches, workflowMatches]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (!shouldShow) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (rows.length === 0) {
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
        setSelectedIdx((i) => (i + 1) % rows.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => (i - 1 + rows.length) % rows.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        // stopPropagation so the textarea's React onKeyDown doesn't
        // also see this Enter and submit the half-typed slash input.
        e.stopPropagation();
        const picked = rows[selectedIdx];
        if (picked) apply(picked);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, rows, selectedIdx]);

  function apply(row: SlashRow): void {
    if (row.kind === 'command') {
      // Match the legacy CommandAutocomplete behaviour: insert the
      // command name + a trailing space so the user can keep typing
      // args without a manual space press.
      onPick(`${row.cmd.name} `);
    } else {
      onPick(`/${row.wf.slug} `);
    }
  }

  const listRef = useRef<HTMLDivElement>(null);
  if (!shouldShow) return null;

  if (rows.length === 0) {
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
        No commands or workflows match <code>{trimmed}</code>. Try <code>/help</code>.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slash commands and workflows"
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
      {commandMatches.length > 0 && <Subhead label="Commands" />}
      {commandMatches.map((cmd, i) => (
        <CommandRow
          key={`cmd:${cmd.name}`}
          cmd={cmd}
          selected={i === selectedIdx}
          onClick={() => apply({ kind: 'command', cmd })}
          onHover={() => setSelectedIdx(i)}
        />
      ))}
      {workflowMatches.length > 0 && <Subhead label="Workflows" />}
      {workflowMatches.map((wf, wIdx) => {
        // wf's index in the flat `rows` array: all commands precede
        // any workflow, so its index is `commandMatches.length + wIdx`.
        const rowIdx = commandMatches.length + wIdx;
        return (
          <WorkflowRow
            key={`wf:${wf.workflowId}`}
            wf={wf}
            selected={rowIdx === selectedIdx}
            onClick={() => apply({ kind: 'workflow', wf })}
            onHover={() => setSelectedIdx(rowIdx)}
          />
        );
      })}
    </div>
  );
}

function Subhead({ label }: { label: string }): JSX.Element {
  return (
    <div
      style={{
        padding: '6px 8px 2px',
        fontSize: 10,
        fontFamily: 'var(--mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-muted)',
      }}
      aria-hidden
    >
      {label}
    </div>
  );
}

function CommandRow({
  cmd,
  selected,
  onClick,
  onHover,
}: {
  cmd: CommandRegistration;
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
        <code style={{ fontWeight: 600, fontSize: 12 }}>{cmd.name}</code>
        {cmd.usage && <code className="muted" style={{ fontSize: 11 }}>{cmd.usage}</code>}
      </div>
      <div className="muted" style={{ fontSize: 11 }}>{cmd.description}</div>
    </div>
  );
}

function WorkflowRow({
  wf,
  selected,
  onClick,
  onHover,
}: {
  wf: WorkflowMentionEntry;
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
        <code style={{ fontWeight: 600, fontSize: 12 }}>/{wf.slug}</code>
        <span className="muted" style={{ fontSize: 11 }}>{wf.displayName}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>{wf.description}</div>
    </div>
  );
}
