import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { RunsIndexPage } from './runs/RunsIndexPage.js';
import { RunDetailPage } from './runs/RunDetailPage.js';
import { CapabilitiesPanel } from './discovery/CapabilitiesPanel.js';
import { ChatTab } from './chat/ChatTab.js';
import { BuilderTab } from './builder/BuilderTab.js';
import { WorkflowsDashboard } from './builder/WorkflowsDashboard.js';
import { DemoHostBanner } from './builder/DemoHostBanner.js';
import { PrivacyPage } from './PrivacyPage.js';
import { PromptLibraryPage } from './prompts/PromptLibraryPage.js';
import { SignInButton } from './auth/SignInButton.js';

export function App() {
  const location = useLocation();
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
          <span>Open<em>WOP</em> <span className="app-header-sub">workflow-engine sample</span></span>
        </h1>
        <nav>
          <NavLink to="/" end>AI</NavLink>
          <NavLink to="/builder">Workflows</NavLink>
          <NavLink to="/prompts">Prompts</NavLink>
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/capabilities">Capabilities</NavLink>
        </nav>
        <div className="app-header-spacer" />
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
          <Route path="/runs" element={<RunsIndexPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/capabilities" element={<CapabilitiesPanel />} />
          <Route path="/builder" element={<WorkflowsDashboard />} />
          <Route path="/builder/:workflowId" element={<BuilderTab />} />
          <Route path="/prompts" element={<PromptLibraryPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Routes>
      </main>
      <footer className="app-footer">
        Sample / template code. Not production-hardened. ·{' '}
        <Link to="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}
