import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { RunsIndexPage } from './runs/RunsIndexPage.js';
import { NetworkPanel } from './devtools/NetworkPanel.js';
import { installNetworkRecorder } from './devtools/networkRecorder.js';
import { RunDetailPage } from './runs/RunDetailPage.js';
import { CommandCenterPage } from './runs/CommandCenterPage.js';
import { HitlInboxPage } from './runs/HitlInboxPage.js';
import { RunComparePage } from './runs/RunComparePage.js';
import { CapabilitiesPanel } from './discovery/CapabilitiesPanel.js';
import { ChatTab } from './chat/ChatTab.js';
import { BuilderTab } from './builder/BuilderTab.js';
import { WorkflowsDashboard } from './builder/WorkflowsDashboard.js';
import { DemoHostBanner } from './builder/DemoHostBanner.js';
import { PrivacyPage } from './PrivacyPage.js';
import { NotFoundPage } from './NotFoundPage.js';
import { PromptLibraryPage } from './prompts/PromptLibraryPage.js';
import { KeysPage } from './byok/KeysPage.js';
import { SignInButton } from './auth/SignInButton.js';

export function App() {
  const location = useLocation();
  // Network inspector toggle — installs the fetch interceptor on first
  // mount so calls made before the panel is opened are still captured.
  // Idempotent: installNetworkRecorder() short-circuits after the first
  // call so HMR / StrictMode double-renders don't double-wrap fetch.
  useEffect(() => { installNetworkRecorder(); }, []);
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
          {/* Order matters — Chat first since it's the surface most
              users land on; @-mention from there is how they discover
              the workflow orchestration. Workflows and the deeper
              tools follow. */}
          <NavLink to="/" end>Chat</NavLink>
          <NavLink to="/builder">Workflows</NavLink>
          <NavLink to="/prompts">Prompts</NavLink>
          <NavLink to="/keys">Keys</NavLink>
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/mission">Mission Control</NavLink>
          <NavLink to="/inbox">Inbox</NavLink>
          <NavLink to="/capabilities">Capabilities</NavLink>
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
          <Route path="/mission" element={<CommandCenterPage />} />
          <Route path="/inbox" element={<HitlInboxPage />} />
          <Route path="/compare" element={<RunComparePage />} />
          <Route path="/capabilities" element={<CapabilitiesPanel />} />
          <Route path="/builder" element={<WorkflowsDashboard />} />
          <Route path="/builder/:workflowId" element={<BuilderTab />} />
          <Route path="/prompts" element={<PromptLibraryPage />} />
          <Route path="/keys" element={<KeysPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
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
    </div>
  );
}
