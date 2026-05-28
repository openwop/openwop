/**
 * Top-nav dropdown menu — the primitive that lets the app header group
 * related routes under a single trigger (Build ▾ → Workflows, Agents,
 * Prompts, etc.) instead of carrying 9+ flat top-level items.
 *
 * Visual + interaction parity with the marketing site's `.nav-dropdown`
 * pattern (`public/styles.css:154-224`):
 *   - hover, focus-within, and `.is-open` (click-toggled) all reveal the
 *     menu — touch users get click-toggle without losing hover-fast
 *     desktop UX
 *   - 14px invisible "::after" hover-bridge between trigger + menu so
 *     the cursor crossing the gap doesn't dismiss the menu
 *   - caret rotates 180° when open
 *
 * A11y:
 *   - trigger is a real `<button type="button">` with
 *     `aria-haspopup="menu"` + `aria-expanded` reflecting state
 *   - menu carries `role="menu"`, children carry `role="menuitem"`
 *   - Escape closes + returns focus to trigger
 *   - ArrowDown from trigger moves focus into the first item; ArrowUp /
 *     ArrowDown navigate within the menu; Home/End jump to first/last
 *   - Click-outside closes
 *   - Trigger gets `.active` when any child route is the current path,
 *     so users can see at a glance which submenu owns the current page
 *
 * Mobile (<760px) handling is deferred — the app today doesn't have a
 * hamburger drawer and the nav overflows on narrow screens (`app-header
 * nav` flex-wraps). A future mobile-nav pass should collapse all
 * dropdowns into a vertical stack, the marketing-site equivalent of
 * `.nav-drawer`. For phase A2 the dropdowns work on desktop, which
 * matches every other surface in this app.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';

export interface NavDropdownItem {
  /** Visible label — UPPERCASE styling comes from the CSS, write
   *  it Title-case here. */
  label: string;
  /** React-router target. Internal-only — no external links allowed
   *  in this primitive; the app's external surfaces (Privacy, etc.)
   *  live in the footer. */
  to: string;
  /** Optional secondary line under the label, e.g.
   *  "Author, install, fork agents". One short sentence, no period. */
  hint?: string;
}

interface Props {
  /** Trigger label, e.g. "Build". Title-case; CSS uppercases. */
  label: string;
  /** Menu rows. Order = render order. */
  items: readonly NavDropdownItem[];
  /** Optional custom icon / extras rendered to the left of the
   *  trigger label. Used for things like a notification dot. */
  leading?: ReactNode;
}

export function NavDropdown({ label, items, leading }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Mark the trigger as `.active` when any child route is the current
  // path. NavLink's own .active mechanism only fires on <a>, so we
  // compute it here. Prefix match handles nested routes like
  // /agents/:agentId beneath an "Agents" parent.
  const isAnyChildActive = useMemo(() => {
    return items.some((it) => {
      if (location.pathname === it.to) return true;
      if (it.to !== '/' && location.pathname.startsWith(it.to + '/')) return true;
      return false;
    });
  }, [items, location.pathname]);

  // Close on outside-click. Only attached while open so we're not
  // listening to document mousedown on every page across every
  // dropdown in the header.
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e: MouseEvent): void => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  // Close on route change — clicking a menu item navigates, and we
  // want the menu to dismiss visibly when that happens.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const focusFirstItem = useCallback(() => {
    const first = menuRef.current?.querySelector<HTMLAnchorElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  const focusLastItem = useCallback(() => {
    const all = menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]');
    all?.[all.length - 1]?.focus();
  }, []);

  const onTriggerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      // setTimeout(0) lets React commit the open=true render so the
      // menu items exist in the DOM before we try to focus one.
      setTimeout(focusFirstItem, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setTimeout(focusLastItem, 0);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }, [open, focusFirstItem, focusLastItem]);

  const onMenuKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx < 0 || idx === items.length - 1 ? 0 : idx + 1;
      items[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx <= 0 ? items.length - 1 : idx - 1;
      items[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      // Tab out of the menu closes it. We don't preventDefault — let
      // the browser take focus to the next focusable element.
      setOpen(false);
    }
  }, []);

  return (
    <div
      ref={rootRef}
      className={[
        'nav-dropdown',
        open ? 'is-open' : '',
        isAnyChildActive ? 'active' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        ref={triggerRef}
        type="button"
        className="nav-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {leading}
        {label}
        <span className="nav-caret" aria-hidden>▾</span>
      </button>
      <div
        ref={menuRef}
        className="nav-dropdown-menu"
        role="menu"
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            role="menuitem"
            // Tab order inside the menu uses sequential focus, not
            // arrow keys — the arrow-key handler above wins so users
            // can still arrow through quickly. Tab leaves the menu
            // entirely (and our Tab handler closes the menu).
            tabIndex={open ? 0 : -1}
          >
            <span className="nav-dropdown-menu-label">{item.label}</span>
            {item.hint && (
              <span className="nav-dropdown-menu-hint">{item.hint}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
