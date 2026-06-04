/**
 * Back-compat barrel: the nav catalog now DERIVES from the declarative feature
 * manifest (`features.tsx`) — the single source of truth for routes, tiers,
 * width chrome, and nav entries. Consumers (Sidebar, ⌘K palette) import the
 * same names they always did; the hand-maintained list is gone, so the nav can
 * no longer drift from the route table (white-label PRD §3).
 */
export {
  NAV,
  WORKSPACE_NAV,
  ADMIN_NAV,
  navItemIsActive,
  type IconCmp,
  type NavItem,
  type NavGroup,
} from './features.js';
