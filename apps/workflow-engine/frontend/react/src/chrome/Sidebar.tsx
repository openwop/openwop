import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { brand } from '../brand/brand.js';
import { BrandMark } from '../brand/BrandMark.js';
import { SignInButton } from '../auth/SignInButton.js';
import { NotificationBell } from '../notifications/NotificationBell.js';
import { BuildingIcon, MenuIcon, ChevronRightIcon, SearchIcon, SettingsIcon } from '../ui/icons/index.js';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import { WORKSPACE_NAV, navItemIsActive } from './features.js';
import { isAdminPath } from './features.js';

const COLLAPSE_KEY = 'openwop.sidebar.collapsed';

export function Sidebar({ netOpen, onToggleNet }: { netOpen: boolean; onToggleNet: () => void }): JSX.Element {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  // Mobile: the rail is an off-canvas drawer; close it on every route change.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <>
      {/* Mobile launcher — only shown ≤860px via CSS; opens the drawer. */}
      <button
        type="button"
        className="app-sidebar-launcher"
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
      >
        <MenuIcon size={18} />
      </button>
      {drawerOpen && <div className="app-sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden />}

      <aside
        className={`app-sidebar${collapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-open' : ''}`}
        aria-label="Primary"
      >
        <div className="app-sidebar-head">
          <Link to="/" className="app-sidebar-brand" aria-label="OpenWOP home">
            <BrandMark />
          </Link>
          <button
            type="button"
            className="app-sidebar-collapse"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={collapsed}
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <MenuIcon size={16} />
          </button>
        </div>

        {/* Workspace / org switcher — the org-context slot. Links to the
            Organizations surface (RFC 0049); a future phase can hydrate it
            with a real org list. */}
        <Link to="/orgs" className="app-workspace-switcher" title="Workspace + organizations">
          <span className="app-workspace-icon" aria-hidden><BuildingIcon size={16} /></span>
          <span className="app-workspace-meta">
            <span className="app-workspace-eyebrow">Workspace</span>
            <span className="app-workspace-name">{brand.instanceName}</span>
          </span>
          <span className="app-workspace-caret" aria-hidden><ChevronRightIcon size={14} /></span>
        </Link>

        {/* Discoverable entry to the ⌘K command palette (the hotkey also works
            globally). Dispatches a custom event the palette listens for. */}
        <button
          type="button"
          className="app-cmdk-trigger"
          onClick={() => window.dispatchEvent(new Event('openwop:cmdk'))}
          title="Search + jump to anything (⌘K)"
        >
          <span className="app-cmdk-icon" aria-hidden><SearchIcon size={15} /></span>
          <span className="app-cmdk-label">Search…</span>
          <kbd className="app-cmdk-kbd" aria-hidden>⌘K</kbd>
        </button>

        <nav className="app-sidebar-nav" aria-label="Sections">
          {WORKSPACE_NAV.map((group) => (
            <div key={group.label} className="app-nav-group">
              <div className="app-nav-group-label" aria-hidden>{group.label}</div>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = navItemIsActive(item, location.pathname);
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={`app-nav-link${active ? ' is-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={item.hint}
                      >
                        <span className="app-nav-icon" aria-hidden><Icon size={16} /></span>
                        <span className="app-nav-label">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {/* The admin tier surfaces as ONE pinned entry (white-label PRD §2):
              everything platform/config lives behind it, inside <AdminLayout>'s
              embedded rail. Active whenever any admin-tier route is open. */}
          <div className="app-nav-group app-nav-group--admin">
            <ul>
              <li>
                <NavLink
                  to="/admin"
                  className={`app-nav-link${isAdminPath(location.pathname) ? ' is-active' : ''}`}
                  aria-current={isAdminPath(location.pathname) ? 'page' : undefined}
                  title="Platform configuration + console"
                >
                  <span className="app-nav-icon" aria-hidden><SettingsIcon size={16} /></span>
                  <span className="app-nav-label">Admin</span>
                </NavLink>
              </li>
            </ul>
          </div>
        </nav>

        <div className="app-sidebar-foot">
          <button
            type="button"
            className="secondary btn-sm app-sidebar-net"
            onClick={onToggleNet}
            aria-label="Open network inspector"
            aria-expanded={netOpen}
            title="Show every REST + SSE call the app is making"
          >
            Network
          </button>
          <ThemeToggle />
          <div className="app-sidebar-account-row">
            <NotificationBell />
            <SignInButton />
          </div>
        </div>
      </aside>
    </>
  );
}
