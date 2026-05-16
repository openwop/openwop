/**
 * Slash-command autocomplete popover.
 *
 * Mounts above the ChatInput when the current text starts with '/'
 * and doesn't contain a space (entering "args mode" hides it).
 * Keyboard: ↑↓ navigate, Enter / Tab to apply, Esc dismisses.
 */

import { useEffect, useRef, useState } from 'react';
import { filterCommands, type CommandRegistration } from './registry/CommandRegistry.js';

interface Props {
  /** Current text in the textarea — used to filter the list. */
  text: string;
  /** Called when the user picks a command. The string includes the
   *  leading slash (e.g. `/clear`). */
  onPick: (commandName: string) => void;
  /** Called when the user dismisses (Esc). */
  onDismiss: () => void;
}

export function CommandAutocomplete({ text, onPick, onDismiss }: Props): JSX.Element | null {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Show only when text starts with '/' and has no space (args mode).
  const trimmed = text.trimStart();
  const shouldShow = trimmed.startsWith('/') && !trimmed.includes(' ');
  const query = shouldShow ? trimmed.slice(1) : '';
  const matches = shouldShow ? filterCommands(query) : [];

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (!shouldShow) return;
    function onKey(e: KeyboardEvent): void {
      if (matches.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % matches.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + matches.length) % matches.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        // Only intercept when our popover is visible AND no modifier.
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        const picked = matches[selectedIdx];
        if (picked) onPick(picked.name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shouldShow, matches, selectedIdx, onPick, onDismiss]);

  if (!shouldShow) return null;
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
        No command matches <code>{trimmed}</code>. Try <code>/help</code>.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slash commands"
      style={{
        position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 4,
        maxHeight: 220,
        overflowY: 'auto',
        zIndex: 10,
      }}
    >
      {matches.map((cmd, i) => (
        <CommandRow
          key={cmd.name}
          cmd={cmd}
          selected={i === selectedIdx}
          onClick={() => onPick(cmd.name)}
          onHover={() => setSelectedIdx(i)}
        />
      ))}
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
