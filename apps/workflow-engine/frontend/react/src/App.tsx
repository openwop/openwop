import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { RunsIndexPage } from './runs/RunsIndexPage.js';
import { NetworkPanel } from './devtools/NetworkPanel.js';
import { installNetworkRecorder } from './devtools/networkRecorder.js';
import { RunDetailPage } from './runs/RunDetailPage.js';
import { RunAuditPage } from './runs/RunAuditPage.js';
import { CommandCenterPage } from './runs/CommandCenterPage.js';
import { NotificationsPage } from './notifications/NotificationsPage.js';
import { RunComparePage } from './runs/RunComparePage.js';
import { CapabilitiesPanel } from './discovery/CapabilitiesPanel.js';
import { ChatTab } from './chat/ChatTab.js';
import { BuilderTab } from './builder/BuilderTab.js';
import { WorkflowsDashboard } from './builder/WorkflowsDashboard.js';
import { DemoHostBanner } from './builder/DemoHostBanner.js';
import { PrivacyPage } from './PrivacyPage.js';
import { CliPage } from './CliPage.js';
import { NotFoundPage } from './NotFoundPage.js';
import { PromptLibraryPage } from './prompts/PromptLibraryPage.js';
import { KeysPage } from './byok/KeysPage.js';
import { MemoryInspectorPage } from './memory/MemoryInspectorPage.js';
import { KanbanPage } from './kanban/KanbanPage.js';
import { RosterPage } from './agents/RosterPage.js';
import { SignInButton } from './auth/SignInButton.js';
import { NotificationBell } from './notifications/NotificationBell.js';
import { NotificationPanel } from './notifications/NotificationPanel.js';
import { useNotificationStore } from './notifications/notificationStore.js';
import { NavDropdown } from './chrome/NavDropdown.js';
import { AgentsPage } from './agents/AgentsPage.js';
import { AgentDetailPage } from './agents/AgentDetailPage.js';
import { AgentNewPage } from './agents/AgentNewPage.js';
import { AgentInstallPage } from './agents/AgentInstallPage.js';

export function App() {
  const location = useLocation();
  // Network inspector toggle — installs the fetch interceptor on first
  // mount so calls made before the panel is opened are still captured.
  // Idempotent: installNetworkRecorder() short-circuits after the first
  // call so HMR / StrictMode double-renders don't double-wrap fetch.
  useEffect(() => { installNetworkRecorder(); }, []);
  // Bootstrap the notification store — hydrate via REST + attach SSE
  // for live deltas. Idempotent: `connect()` no-ops if already connected.
  const connectNotifications = useNotificationStore((s) => s.connect);
  const disconnectNotifications = useNotificationStore((s) => s.disconnect);
  useEffect(() => {
    void connectNotifications();
    return () => disconnectNotifications();
  }, [connectNotifications, disconnectNotifications]);
  const [netOpen, setNetOpen] = useState(false);
  // The builder canvas is its own scroll/zoom region — bypass the
  // centered 1200px-wide .app-main constraint so the canvas can fill
  // the viewport. All other routes use the normal main container.
  // Full-bleed only for the canvas (`/builder/:workflowId`), not the
  // dashboard list at `/builder`, which uses the centered main column.
  const fullBleed = /^\/builder\/[^/]+/.test(location.pathname);
  // The AI chat page is a fixed-height app surface: page itself must
  // not scroll, the message feed inside owns the scroll. Lock the shell
  // to 100vh and let .app-main flex-fill so ChatSidebar can take what
  // remains after header + banner + footer.
  const isChatPage = location.pathname === '/';
  return (
    <div className={isChatPage ? 'app-shell app-shell--ai' : 'app-shell'}>
      <DemoHostBanner />
      <header className="app-header">
        <h1 className="brand-mark">
          <img src="/OpenWOP.svg" alt="" aria-hidden="true" />
          <span>Open<em>WOP</em> <span className="app-header-sub">workflow engine</span></span>
        </h1>
        <nav>
          {/* Chat stays top-level — the most-used entry point. The
              other 8 nav items used to be flat siblings here; they're
              now grouped into three submenu parents (Build / Operate /
              Settings) so the bar stays scannable as the surface grows
              (Agents tab added 2026-05-28). The submenu visual rhythm
              matches the marketing site's `.nav-dropdown` pattern in
              public/styles.css — same hover-bridge, caret rotation,
              and click-toggle behaviour, retokenized onto the app's
              --clay / --paper palette so the two sites read as one
              family.

              Ordering rationale:
                Build    — surfaces you author at (create work)
                Operate  — surfaces you observe at (watch work happen)
                Settings — config that doesn't change per session

              Chat first per feedback_chat_first_nav memory. */}
          <NavLink to="/" end>Chat</NavLink>
          <NavDropdown
            label="Build"
            items={[
              { label: 'Workflows', to: '/builder', hint: 'Author + run multi-node graphs' },
              { label: 'Agents', to: '/agents', hint: 'Persona-driven LLM workers' },
              { label: 'Roster', to: '/roster', hint: 'Named agents + workflow portfolios + org-chart' },
              { label: 'Prompts', to: '/prompts', hint: 'Reusable templates + variables' },
            ]}
          />
          <NavDropdown
            label="Operate"
            items={[
              { label: 'Runs', to: '/runs', hint: 'Per-run event streams + replay' },
              { label: 'Boards', to: '/boards', hint: 'Kanban work surface — card → run trigger' },
              { label: 'Inbox', to: '/inbox', hint: 'Notifications + approvals' },
              { label: 'Mission Control', to: '/mission', hint: 'Live fleet view across runs' },
              { label: 'Memory', to: '/memory', hint: 'Tenant-attributed memory writes' },
            ]}
          />
          {/* CLI lives in Settings — it's a dev/admin surface
              adjacent to BYOK keys + capabilities discovery, not an
              authoring or operate surface. Added during the rebase
              of `feat/agents-tab` onto `e55ce3cb feat(app): in-app
              /cli page`. */}
          <NavDropdown
            label="Settings"
            items={[
              { label: 'Keys', to: '/keys', hint: 'BYOK credentials + provider config' },
              { label: 'Capabilities', to: '/capabilities', hint: 'What this host advertises' },
              { label: 'CLI', to: '/cli', hint: 'In-app CLI quickstart + command catalog' },
            ]}
          />
        </nav>
        <div className="app-header-spacer" />
        <button
          type="button"
          className="secondary app-header-net-toggle"
          onClick={() => setNetOpen((v) => !v)}
          aria-label="Open network inspector"
          aria-expanded={netOpen}
          title="Show every REST + SSE call the app is making"
        >
          Network
        </button>
        <NotificationBell />
        <SignInButton />
      </header>
      <main
        className={
          fullBleed
            ? 'app-main app-main-fullbleed'
            : isChatPage
              ? 'app-main app-main--ai'
              : 'app-main'
        }
      >
        <Routes>
          <Route path="/" element={<ChatTab />} />
          {/* The nav label says "Chat" but the route stays "/" so existing
              bookmarks don't break. Add a /chat alias so users who type
              the URL based on the nav label land somewhere useful. */}
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/runs" element={<RunsIndexPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/runs/:runId/audit" element={<RunAuditPage />} />
          <Route path="/mission" element={<CommandCenterPage />} />
          <Route path="/inbox" element={<NotificationsPage />} />
          <Route path="/compare" element={<RunComparePage />} />
          <Route path="/capabilities" element={<CapabilitiesPanel />} />
          <Route path="/builder" element={<WorkflowsDashboard />} />
          <Route path="/builder/:workflowId" element={<BuilderTab />} />
          <Route path="/prompts" element={<PromptLibraryPage />} />
          <Route path="/keys" element={<KeysPage />} />
          <Route path="/memory" element={<MemoryInspectorPage />} />
          <Route path="/boards" element={<KanbanPage />} />
          <Route path="/roster" element={<RosterPage />} />
          {/* Agents tab — list + detail + create (E2) + install (E3)
              + fork (E4 also lands on /agents/new with ?fork= query). */}
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentNewPage />} />
          <Route path="/agents/install" element={<AgentInstallPage />} />
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/cli" element={<CliPage />} />
          {/* Catch-all: the SPA host rewrites every path to index.html, so an
              unmatched URL must resolve here rather than render a blank main. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <footer className="app-footer">
        Sample / template code. Not production-hardened. ·{' '}
        <Link to="/privacy">Privacy</Link>
      </footer>
      <NetworkPanel open={netOpen} onClose={() => setNetOpen(false)} />
      <NotificationPanel />
    </div>
  );
}
