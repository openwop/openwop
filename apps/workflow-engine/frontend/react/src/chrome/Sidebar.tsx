import { useEffect, useState, type ComponentType } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BrandMark } from '../brand/BrandMark.js';
import { SignInButton } from '../auth/SignInButton.js';
import { NotificationBell } from '../notifications/NotificationBell.js';
import {
  MessageSquareIcon, BotIcon, WorkflowIcon, PlayIcon, ColumnsIcon, UserIcon,
  InboxIcon, ActivityIcon, DatabaseIcon, FileTextIcon, PackageIcon,
  BuildingIcon, KeyIcon, ShieldIcon, TerminalIcon, MenuIcon, ChevronRightIcon,
} from '../ui/icons/index.js';

type IconCmp = ComponentType<{ size?: number; strokeWidth?: number }>;

interface NavItem {
  label: string;
  to: string;
  icon: IconCmp;
  hint: string;
  /** Exact-match only (Chat lives at "/", which would otherwise prefix-match everything). */
  end?: boolean;
  /** Sibling routes that must NOT light this item (e.g. /agents vs /agents/templates). */
  notUnder?: string[];
}
interface NavGroup { label: string; items: NavItem[] }

// Grouped IA (Phase 1): Build = surfaces you author at; Operate = surfaces you
// observe at; Admin = config that doesn't change per session. Chat stays first
// (feedback_chat_first_nav). Mirrors the prior Advanced/Settings dropdown
// contents, now a persistent rail. Icons from the app-wide Lucide set (§5.2).
const NAV: NavGroup[] = [
  {
    label: 'Build',
    items: [
      { label: 'Chat', to: '/', icon: MessageSquareIcon, hint: 'Conversational entry point', end: true },
      { label: 'Agents', to: '/agents', icon: BotIcon, hint: 'Your named AI coworkers', notUnder: ['/agents/templates'] },
      { label: 'Workflows', to: '/builder', icon: WorkflowIcon, hint: 'Author + edit workflows' },
      { label: 'Runs', to: '/runs', icon: PlayIcon, hint: 'Execution history + detail' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { label: 'Boards', to: '/boards', icon: ColumnsIcon, hint: 'Kanban — card → run trigger' },
      { label: 'Roster', to: '/roster', icon: UserIcon, hint: 'Roster + org-chart editor' },
      { label: 'Inbox', to: '/inbox', icon: InboxIcon, hint: 'Notifications + approvals' },
      { label: 'Mission Control', to: '/mission', icon: ActivityIcon, hint: 'Live fleet view across runs' },
      { label: 'Memory', to: '/memory', icon: DatabaseIcon, hint: 'Tenant-attributed memory writes' },
      { label: 'Prompts', to: '/prompts', icon: FileTextIcon, hint: 'Reusable templates + variables' },
      { label: 'Agent templates', to: '/agents/templates', icon: PackageIcon, hint: 'Installed manifest agents + packs' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Organizations', to: '/orgs', icon: BuildingIcon, hint: 'Orgs, teams, members + RBAC' },
      { label: 'Keys', to: '/keys', icon: KeyIcon, hint: 'BYOK credentials + provider config' },
      { label: 'Capabilities', to: '/capabilities', icon: ShieldIcon, hint: 'What this host advertises' },
      { label: 'Demo data', to: '/demo-data', icon: DatabaseIcon, hint: 'Re-seed the built-in demo roster' },
      { label: 'CLI', to: '/cli', icon: TerminalIcon, hint: 'In-app CLI quickstart + catalog' },
    ],
  },
];

function itemIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  const under = pathname === item.to || pathname.startsWith(`${item.to}/`);
  if (!under) return false;
  return !(item.notUnder ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

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
            <span className="app-workspace-name">Demo host</span>
          </span>
          <span className="app-workspace-caret" aria-hidden><ChevronRightIcon size={14} /></span>
        </Link>

        <nav className="app-sidebar-nav" aria-label="Sections">
          {NAV.map((group) => (
            <div key={group.label} className="app-nav-group">
              <div className="app-nav-group-label" aria-hidden>{group.label}</div>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = itemIsActive(item, location.pathname);
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
        </nav>

        <div className="app-sidebar-foot">
          <div className="app-sidebar-utils">
            <NotificationBell />
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
          </div>
          <SignInButton />
        </div>
      </aside>
    </>
  );
}
