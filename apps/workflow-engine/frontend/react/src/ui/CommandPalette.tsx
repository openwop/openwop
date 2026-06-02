import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV, type IconCmp } from '../chrome/navItems.js';
import { SearchIcon, PlayIcon, BotIcon, ScaleIcon, DatabaseIcon } from './icons/index.js';

/**
 * <CommandPalette> — the app-wide ⌘K / Ctrl+K jump-to-anything (gap #2).
 * Opens over any surface, fuzzy-substring filters across every nav
 * destination + a few quick actions, full keyboard control (↑↓ + Enter,
 * Esc to dismiss). Token-only styling under `.cmdk-*` in global.css.
 * Mounted once at the app shell; manages its own open state + hotkey.
 */

interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: IconCmp;
  to: string;
}

// Quick actions beyond raw navigation — the verbs an operator reaches for.
const ACTIONS: Command[] = [
  { id: 'act-new-run', label: 'Create a run', hint: 'Submit a workflow on the sample host', group: 'Actions', icon: PlayIcon, to: '/runs' },
  { id: 'act-new-agent', label: 'New agent', hint: 'Create a named AI coworker', group: 'Actions', icon: BotIcon, to: '/agents/new' },
  { id: 'act-compare', label: 'Compare runs', hint: 'Diff two run executions', group: 'Actions', icon: ScaleIcon, to: '/compare' },
  { id: 'act-reseed', label: 'Re-seed demo data', hint: 'Reset the built-in demo roster', group: 'Actions', icon: DatabaseIcon, to: '/demo-data' },
];

const COMMANDS: Command[] = [
  ...NAV.flatMap((g) => g.items.map((it) => ({
    id: `nav-${it.to}`, label: it.label, hint: it.hint, group: g.label, icon: it.icon, to: it.to,
  }))),
  ...ACTIONS,
];

export function CommandPalette(): JSX.Element | null {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => { setOpen(false); setQuery(''); setActive(0); }, []);

  // Global hotkey: ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    // A discoverable entry point (the rail's "Search" button) dispatches this
    // so users who don't know the shortcut can still reach the palette.
    function onOpenEvent() { setOpen(true); }
    window.addEventListener('keydown', onKey);
    window.addEventListener('openwop:cmdk', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('openwop:cmdk', onOpenEvent);
    };
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [query]);

  const activate = useCallback((cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    nav(cmd.to);
  }, [close, nav]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); activate(results[active]); return; }
  }

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  return (
    <div className="cmdk-scrim" onClick={close} role="presentation">
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input-row">
          <span className="cmdk-input-icon" aria-hidden><SearchIcon size={16} /></span>
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            placeholder="Jump to a page or action…"
            aria-label="Search commands"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>
        {results.length === 0 ? (
          <div className="cmdk-empty">No matches for “{query}”.</div>
        ) : (
          <ul className="cmdk-list" ref={listRef} role="listbox" aria-label="Commands">
            {results.map((cmd, idx) => {
              const Icon = cmd.icon;
              return (
                <li key={cmd.id} data-idx={idx} role="option" aria-selected={idx === active}>
                  <button
                    type="button"
                    className={`cmdk-item${idx === active ? ' is-active' : ''}`}
                    onMouseMove={() => setActive(idx)}
                    onClick={() => activate(cmd)}
                  >
                    <span className="cmdk-item-icon" aria-hidden><Icon size={15} /></span>
                    <span className="cmdk-item-label">{cmd.label}</span>
                    <span className="cmdk-item-group">{cmd.group}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘</kbd><kbd>K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
