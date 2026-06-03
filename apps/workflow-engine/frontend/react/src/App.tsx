import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import { NotificationPanel } from './notifications/NotificationPanel.js';
import { useNotificationStore } from './notifications/notificationStore.js';
import { Sidebar } from './chrome/Sidebar.js';
import { AppGate } from './chrome/AppGate.js';
import { AutoSeedDemoData } from './chrome/AutoSeedDemoData.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { Toaster } from './ui/toast.js';
import { AgentsPage } from './agents/AgentsPage.js';
import { AgentDetailPage } from './agents/AgentDetailPage.js';
import { AgentInstallPage } from './agents/AgentInstallPage.js';
import { AgentNewPage } from './agents/AgentNewPage.js';
import { AgentDashboardPage } from './agents/AgentDashboardPage.js';
import { AgentWorkspacePage } from './agents/AgentWorkspacePage.js';
import { AgentCreateWizard } from './agents/AgentCreateWizard.js';
import { DemoDataPage } from './settings/DemoDataPage.js';
import { brand } from './brand/brand.js';
import { OrgsPage } from './orgs/OrgsPage.js';

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
  // Narrow content tier (.app-main--narrow, 760px): forms + single-column
  // reads where a full-width column reads poorly. Everything else uses the
  // wide default. Width is shell-owned — pages set NO max-width of their own.
  const NARROW_ROUTES = new Set<string>([
    '/agents/new',
    '/agents/fork',
    '/agents/install',
    '/demo-data',
    '/privacy',
    '/cli',
  ]);
  const isNarrow =
    NARROW_ROUTES.has(location.pathname) ||
    /^\/agents\/templates\/[^/]+/.test(location.pathname); // agent detail (not the list)
  return (
    <AppGate>
    <div className={isChatPage ? 'app-shell app-shell--ai' : 'app-shell'}>
      <AutoSeedDemoData />
      {/* Persistent left rail (Phase 1): grouped Build / Operate / Admin nav,
          collapsible, with the workspace/org switcher + account chrome. Replaces
          the former top-nav + Advanced/Settings dropdowns. Chat stays first
          (feedback_chat_first_nav). */}
      <Sidebar netOpen={netOpen} onToggleNet={() => setNetOpen((v) => !v)} />
      <div className="app-body">
        <DemoHostBanner />
        <main
          className={
            fullBleed
              ? 'app-main app-main-fullbleed'
              : isChatPage
                ? 'app-main app-main--ai'
                : isNarrow
                  ? 'app-main app-main--narrow page-enter'
                  : 'app-main page-enter'
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
          <Route path="/demo-data" element={<DemoDataPage />} />
          <Route path="/orgs" element={<OrgsPage />} />
          <Route path="/memory" element={<MemoryInspectorPage />} />
          <Route path="/boards" element={<KanbanPage />} />
          <Route path="/roster" element={<RosterPage />} />
          {/* Agents experience (agents-demo PRD): the dashboard of named
              coworkers is the primary `/agents`; the manifest-agent inventory
              moves under `/agents/templates`. The per-agent workspace lives at
              `/agents/:agentId` (a roster id). */}
          <Route path="/agents" element={<AgentDashboardPage />} />
          <Route path="/agents/new" element={<AgentCreateWizard />} />
          {/* Raw single-form authoring (also the ?fork= target) — kept for the
              fork-to-customize flow from a pack/template agent. */}
          <Route path="/agents/fork" element={<AgentNewPage />} />
          <Route path="/agents/install" element={<AgentInstallPage />} />
          <Route path="/agents/templates" element={<AgentsPage />} />
          <Route path="/agents/templates/:agentId" element={<AgentDetailPage />} />
          <Route path="/agents/:agentId" element={<AgentWorkspacePage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/cli" element={<CliPage />} />
          {/* Catch-all: the SPA host rewrites every path to index.html, so an
              unmatched URL must resolve here rather than render a blank main. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </main>
        <footer className="app-footer">
          {brand.footerText} ·{' '}
          <Link to="/privacy">Privacy</Link>
        </footer>
      </div>
      <NetworkPanel open={netOpen} onClose={() => setNetOpen(false)} />
      <NotificationPanel />
      <CommandPalette />
      <Toaster />
    </div>
    </AppGate>
  );
}
