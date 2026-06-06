/**
 * The declarative feature manifest — the single source of truth for the app
 * shell (white-label PRD §3 "the paved path").
 *
 * Every route declares itself here once: its element, which IA *tier* it
 * belongs to (`workspace` = the product rail; `admin` = the platform/console
 * surface inside <AdminLayout>), which width *chrome* the shell gives it, and
 * (optionally) the nav entry that advertises it. Everything else derives:
 *
 *   - App.tsx renders <Routes> FROM this list (no hand-wired <Route>s),
 *   - Sidebar renders the workspace rail + the single Admin entry from it,
 *   - AdminLayout renders the embedded admin rail from it,
 *   - the ⌘K palette catalog derives from it,
 *   - width rules (`narrow`/`fullbleed`/`chat`) derive from it — the old
 *     `NARROW_ROUTES` set + ad-hoc regexes are gone, so they cannot drift.
 *
 * Adding a page = ONE entry here. Wiring a nav item, the admin chrome, and
 * the width tier all happen by declaration, not by editing layout code
 * (white-label PRD §2/§3 acceptance).
 */
import { lazy, type ComponentType, type ReactElement } from 'react';
import { Navigate, matchRoutes } from 'react-router-dom';
import {
  MessageSquareIcon, BotIcon, WorkflowIcon, PlayIcon, ColumnsIcon, UserIcon,
  InboxIcon, ActivityIcon, DatabaseIcon, FileTextIcon, PackageIcon,
  BuildingIcon, KeyIcon, ShieldIcon, TerminalIcon, SettingsIcon,
} from '../ui/icons/index.js';
import { ChatTab } from '../chat/ChatTab.js';
import { RunsIndexPage } from '../runs/RunsIndexPage.js';
import { RunDetailPage } from '../runs/RunDetailPage.js';
import { RunAuditPage } from '../runs/RunAuditPage.js';
import { RunComparePage } from '../runs/RunComparePage.js';
import { CommandCenterPage } from '../runs/CommandCenterPage.js';
import { NotificationsPage } from '../notifications/NotificationsPage.js';
import { CapabilitiesPanel } from '../discovery/CapabilitiesPanel.js';
const BuilderTab = lazy(() => import('../builder/BuilderTab.js').then((m) => ({ default: m.BuilderTab })));
const WorkflowsDashboard = lazy(() => import('../builder/WorkflowsDashboard.js').then((m) => ({ default: m.WorkflowsDashboard })));
import { PrivacyPage } from '../PrivacyPage.js';
import { CliPage } from '../CliPage.js';
import { PromptLibraryPage } from '../prompts/PromptLibraryPage.js';
import { KeysPage } from '../byok/KeysPage.js';
import { MemoryInspectorPage } from '../memory/MemoryInspectorPage.js';
const KanbanPage = lazy(() => import('../kanban/KanbanPage.js').then((m) => ({ default: m.KanbanPage })));
const RosterPage = lazy(() => import('../agents/RosterPage.js').then((m) => ({ default: m.RosterPage })));
const AgentsPage = lazy(() => import('../agents/AgentsPage.js').then((m) => ({ default: m.AgentsPage })));
const AgentDetailPage = lazy(() => import('../agents/AgentDetailPage.js').then((m) => ({ default: m.AgentDetailPage })));
const AgentInstallPage = lazy(() => import('../agents/AgentInstallPage.js').then((m) => ({ default: m.AgentInstallPage })));
const AgentNewPage = lazy(() => import('../agents/AgentNewPage.js').then((m) => ({ default: m.AgentNewPage })));
const AgentDashboardPage = lazy(() => import('../agents/AgentDashboardPage.js').then((m) => ({ default: m.AgentDashboardPage })));
const AgentWorkspacePage = lazy(() => import('../agents/AgentWorkspacePage.js').then((m) => ({ default: m.AgentWorkspacePage })));
const AgentCreateWizard = lazy(() => import('../agents/AgentCreateWizard.js').then((m) => ({ default: m.AgentCreateWizard })));
const WorkforcesGalleryPage = lazy(() => import('../workforces/WorkforcesGalleryPage.js').then((m) => ({ default: m.WorkforcesGalleryPage })));
const WorkforceOverviewPage = lazy(() => import('../workforces/WorkforceOverviewPage.js').then((m) => ({ default: m.WorkforceOverviewPage })));
const MigrationWizardPage = lazy(() => import('../workforces/MigrationWizardPage.js').then((m) => ({ default: m.MigrationWizardPage })));
import { DemoDataPage } from '../settings/DemoDataPage.js';
import { AdminOverviewPage } from '../settings/AdminOverviewPage.js';
import { OrgsPage } from '../orgs/OrgsPage.js';

export type IconCmp = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Which shell the route renders in. `workspace` = the primary product rail;
 *  `admin` = inside <AdminLayout>'s embedded collapsible rail (deep-link paths
 *  unchanged — the layout route is pathless). */
export type FeatureTier = 'workspace' | 'admin';

/** Width/scroll treatment the shell gives the route's <main>. Shell-owned —
 *  pages set NO max-width of their own (DESIGN.app.md). */
export type FeatureChrome = 'default' | 'narrow' | 'fullbleed' | 'chat';

export interface FeatureNav {
  /** Group header within the tier ('Build' / 'Operate' for workspace;
   *  admin entries render as one flat rail, group label unused there but
   *  still shown in the ⌘K palette catalog). */
  group: string;
  label: string;
  icon: IconCmp;
  hint: string;
  /** Exact-match only (Chat lives at "/", which would otherwise prefix-match everything). */
  end?: boolean;
  /** Sibling routes that must NOT light this item (e.g. /agents vs /agents/templates). */
  notUnder?: string[];
}

export interface FeatureRoute {
  /** react-router path pattern (`/runs/:runId`). */
  path: string;
  element: ReactElement;
  tier: FeatureTier;
  /** Defaults to 'default'. */
  chrome?: FeatureChrome;
  /** Present = the route appears in its tier's nav (and the ⌘K palette). */
  nav?: FeatureNav;
}

// Grouped IA (renamed 2026-06-04 per David): Workspace = the day-to-day
// product surfaces (Chat · Agents · Boards · Inbox); Author = workflow
// authoring; admin tier = platform/config that doesn't change per session.
// Chat stays first (feedback_chat_first_nav).
export const FEATURES: FeatureRoute[] = [
  // ── workspace · the day-to-day product surfaces ────────────────────────
  {
    path: '/', element: <ChatTab />, tier: 'workspace', chrome: 'chat',
    nav: { group: 'Workspace', label: 'Chat', icon: MessageSquareIcon, hint: 'Conversational entry point', end: true },
  },
  // The nav label says "Chat" but the route stays "/" so existing bookmarks
  // don't break; /chat redirects for users who type the nav label as a URL.
  { path: '/chat', element: <Navigate to="/" replace />, tier: 'workspace' },
  {
    path: '/agents', element: <AgentDashboardPage />, tier: 'workspace',
    nav: { group: 'Workspace', label: 'Agents', icon: BotIcon, hint: 'Your digital workforce — named AI coworkers', notUnder: ['/agents/templates'] },
  },
  { path: '/agents/new', element: <AgentCreateWizard />, tier: 'workspace', chrome: 'narrow' },
  // Raw single-form authoring (also the ?fork= target) — kept for the
  // fork-to-customize flow from a pack/template agent.
  { path: '/agents/fork', element: <AgentNewPage />, tier: 'workspace', chrome: 'narrow' },
  { path: '/agents/install', element: <AgentInstallPage />, tier: 'workspace', chrome: 'narrow' },
  // Per-agent workspace (a roster id) — the agents-demo PRD's primary surface.
  { path: '/agents/:agentId', element: <AgentWorkspacePage />, tier: 'workspace' },
  // Governed workforces (EP0) — a business function as a supervised agent
  // cluster: purpose/policy, telemetry, agent specs. Read-only in EP0.
  {
    path: '/workforces', element: <WorkforcesGalleryPage />, tier: 'workspace',
    nav: { group: 'Workspace', label: 'Workforces', icon: BuildingIcon, hint: 'Governed agent workforces — purpose, telemetry, autonomy' },
  },
  { path: '/workforces/:workforceId', element: <WorkforceOverviewPage />, tier: 'workspace' },
  // Workflow Migration journey wizard (EP1 MG-0) — guided 6-stage onboarding.
  { path: '/workforces/:workforceId/migrate', element: <MigrationWizardPage />, tier: 'workspace', chrome: 'narrow' },
  {
    path: '/builder', element: <WorkflowsDashboard />, tier: 'workspace',
    nav: { group: 'Author', label: 'Workflows', icon: WorkflowIcon, hint: 'Author + edit workflows' },
  },
  // The canvas is its own scroll/zoom region — full viewport, no centered column.
  { path: '/builder/:workflowId', element: <BuilderTab />, tier: 'workspace', chrome: 'fullbleed' },

  // ── workspace · (Boards/Inbox continue the Workspace group; Workflows
  //    above carries the Author group) ──────────────────────────────────────
  // /workforce merged into /agents (2026-06-04) — redirect keeps bookmarks.
  { path: '/workforce', element: <Navigate to="/agents" replace />, tier: 'workspace' },
  {
    path: '/boards', element: <KanbanPage />, tier: 'workspace',
    nav: { group: 'Workspace', label: 'Boards', icon: ColumnsIcon, hint: 'Kanban — card → run trigger' },
  },
  {
    path: '/inbox', element: <NotificationsPage />, tier: 'workspace',
    nav: { group: 'Workspace', label: 'Inbox', icon: InboxIcon, hint: 'Notifications + approvals' },
  },
  { path: '/privacy', element: <PrivacyPage />, tier: 'workspace', chrome: 'narrow' },

  // ── admin (platform/console — one flat rail inside <AdminLayout>) ──────
  {
    path: '/admin', element: <AdminOverviewPage />, tier: 'admin',
    nav: { group: 'Admin', label: 'Overview', icon: SettingsIcon, hint: 'Admin home', end: true },
  },
  // ─ Operations: observe + drive run state (relocated from the workspace
  //   tier 2026-06-04 — the day-to-day view is /agents' ledger).
  {
    path: '/mission', element: <CommandCenterPage />, tier: 'admin',
    nav: { group: 'Operations', label: 'Mission Control', icon: ActivityIcon, hint: 'Live fleet view across runs' },
  },
  {
    path: '/runs', element: <RunsIndexPage />, tier: 'admin',
    nav: { group: 'Operations', label: 'Runs', icon: PlayIcon, hint: 'Execution history + detail' },
  },
  { path: '/runs/:runId', element: <RunDetailPage />, tier: 'admin' },
  { path: '/runs/:runId/audit', element: <RunAuditPage />, tier: 'admin' },
  { path: '/compare', element: <RunComparePage />, tier: 'admin' },
  // ─ Workforce: the configuration side of the named agents.
  {
    path: '/agents/templates', element: <AgentsPage />, tier: 'admin',
    nav: { group: 'Workforce', label: 'Agent templates', icon: PackageIcon, hint: 'Installed manifest agents + packs' },
  },
  { path: '/agents/templates/:agentId', element: <AgentDetailPage />, tier: 'admin', chrome: 'narrow' },
  {
    path: '/roster', element: <RosterPage />, tier: 'admin',
    nav: { group: 'Workforce', label: 'Org chart', icon: UserIcon, hint: 'Roster + org-chart editor (descriptive only — confers no authority)' },
  },
  // ─ Platform: inspection + tooling surfaces.
  {
    path: '/prompts', element: <PromptLibraryPage />, tier: 'admin',
    nav: { group: 'Platform', label: 'Prompts', icon: FileTextIcon, hint: 'Reusable templates + variables' },
  },
  {
    path: '/memory', element: <MemoryInspectorPage />, tier: 'admin',
    nav: { group: 'Platform', label: 'Memory', icon: DatabaseIcon, hint: 'Tenant-attributed memory writes' },
  },
  {
    path: '/capabilities', element: <CapabilitiesPanel />, tier: 'admin',
    nav: { group: 'Platform', label: 'Capabilities', icon: ShieldIcon, hint: 'What this host advertises' },
  },
  {
    path: '/cli', element: <CliPage />, tier: 'admin', chrome: 'narrow',
    nav: { group: 'Platform', label: 'CLI', icon: TerminalIcon, hint: 'In-app CLI quickstart + catalog' },
  },
  // ─ Access & data: identity, credentials, and the demo dataset.
  {
    path: '/orgs', element: <OrgsPage />, tier: 'admin',
    nav: { group: 'Access & data', label: 'Organizations', icon: BuildingIcon, hint: 'Orgs, teams, members + RBAC' },
  },
  {
    path: '/keys', element: <KeysPage />, tier: 'admin',
    nav: { group: 'Access & data', label: 'Keys', icon: KeyIcon, hint: 'BYOK credentials + provider config' },
  },
  {
    path: '/demo-data', element: <DemoDataPage />, tier: 'admin', chrome: 'narrow',
    nav: { group: 'Access & data', label: 'Demo data', icon: DatabaseIcon, hint: 'Re-seed the built-in demo roster' },
  },
];

// ── Derivations (consumers render these; never re-declare nav/width data) ──

export interface NavItem extends FeatureNav { to: string }
export interface NavGroup { label: string; items: NavItem[] }

function navGroups(routes: FeatureRoute[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const f of routes) {
    if (!f.nav) continue;
    let g = groups.find((x) => x.label === f.nav!.group);
    if (!g) { g = { label: f.nav.group, items: [] }; groups.push(g); }
    g.items.push({ ...f.nav, to: f.path });
  }
  return groups;
}

/** The primary product rail (Sidebar): workspace-tier groups only. The admin
 *  tier appears there as ONE pinned entry (Sidebar renders it explicitly). */
export const WORKSPACE_NAV: NavGroup[] = navGroups(FEATURES.filter((f) => f.tier === 'workspace'));

/** The embedded admin rail (<AdminLayout>), grouped. The root 'Admin' group
 *  (Overview) renders header-less — the rail's own title already says Admin. */
export const ADMIN_NAV_GROUPS: NavGroup[] = navGroups(FEATURES.filter((f) => f.tier === 'admin'));

/** Flat admin catalog (the /admin overview card grid). */
export const ADMIN_NAV: NavItem[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items);

/** The full catalog (⌘K palette): workspace groups + the Admin group. */
export const NAV: NavGroup[] = navGroups(FEATURES);

export function navItemIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  const under = pathname === item.to || pathname.startsWith(`${item.to}/`);
  if (!under) return false;
  return !(item.notUnder ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// matchRoutes applies react-router's own specificity ranking, so
// `/agents/templates` wins over `/agents/:agentId` exactly as <Routes> would —
// the manifest never needs to be order-sensitive.
const MATCHABLE = FEATURES.map((f) => ({ path: f.path }));

export function featureFor(pathname: string): FeatureRoute | null {
  const matches = matchRoutes(MATCHABLE, pathname);
  if (!matches || matches.length === 0) return null;
  const matchedPath = matches[matches.length - 1]?.route.path;
  return FEATURES.find((f) => f.path === matchedPath) ?? null;
}

/** Shell width/scroll treatment for the current location. */
export function chromeFor(pathname: string): FeatureChrome {
  return featureFor(pathname)?.chrome ?? 'default';
}

/** True when the location renders inside the admin chrome. */
export function isAdminPath(pathname: string): boolean {
  return featureFor(pathname)?.tier === 'admin';
}
