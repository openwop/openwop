import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ADMIN_NAV_GROUPS, chromeFor, navItemIsActive } from './features.js';
import { ChevronRightIcon } from '../ui/icons/index.js';
import { IconButton } from '../ui/IconButton.js';

const COLLAPSE_KEY = 'openwop.admin.railCollapsed';

/**
 * <AdminLayout> — the single Admin surface with its own embedded left rail
 * (white-label PRD §2: two-tier IA shipped as framework chrome, not a fork).
 *
 * Mounted as a PATHLESS layout route wrapping every admin-tier feature, so the
 * secondary admin rail stays pinned while you move between Organizations,
 * Keys, Capabilities, etc. The wrapped routes keep their original top-level
 * paths — existing deep links keep working; only the surrounding chrome
 * changes. Which routes render here is declared in the feature manifest
 * (`features.tsx` `tier: 'admin'`) — this component hard-codes nothing.
 *
 * The rail collapses to an icon strip (default expanded); the chevron toggle
 * persists the choice per browser.
 */
export function AdminLayout(): JSX.Element {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };
  // Width chrome still derives from the manifest: a `narrow` admin page (CLI,
  // demo-data) keeps its reading width inside the admin content column.
  const narrow = chromeFor(location.pathname) === 'narrow';
  return (
    <div className={`admin-shell${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="admin-rail" aria-label="Admin sections">
        <div className="admin-rail-head">
          {!collapsed && <div className="admin-rail-title">Admin</div>}
          <IconButton
            className="admin-rail-toggle"
            onClick={toggle}
            label={collapsed ? 'Expand admin menu' : 'Collapse admin menu'}
            aria-pressed={!collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
            icon={<ChevronRightIcon size={16} />}
          />
        </div>
        <nav>
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.label} className="admin-nav-group">
              {/* The root 'Admin' group (Overview) is header-less — the rail
                  title already names the tier. Headers also hide when the
                  rail collapses to the icon strip. */}
              {group.label !== 'Admin' && !collapsed
                ? <div className="admin-nav-group-label" aria-hidden>{group.label}</div>
                : null}
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = navItemIsActive(item, location.pathname);
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={`admin-nav-link${active ? ' is-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : item.hint}
                      >
                        <span className="admin-nav-icon" aria-hidden><Icon size={16} /></span>
                        <span className="admin-nav-label">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className={narrow ? 'admin-content admin-content--narrow' : 'admin-content'}>
        <Outlet />
      </div>
    </div>
  );
}
