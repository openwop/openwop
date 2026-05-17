import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { RunsIndexPage } from './runs/RunsIndexPage.js';
import { RunDetailPage } from './runs/RunDetailPage.js';
import { CapabilitiesPanel } from './discovery/CapabilitiesPanel.js';
import { ChatTab } from './chat/ChatTab.js';
import { BuilderTab } from './builder/BuilderTab.js';

export function App() {
  const location = useLocation();
  // The builder canvas is its own scroll/zoom region — bypass the
  // centered 1200px-wide .app-main constraint so the canvas can fill
  // the viewport. All other routes use the normal main container.
  const fullBleed = location.pathname.startsWith('/builder');
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>OpenWOP — workflow-engine sample</h1>
        <nav>
          <NavLink to="/ai">AI</NavLink>
          <NavLink to="/builder">Workflows</NavLink>
          <NavLink to="/" end>Runs</NavLink>
          <NavLink to="/capabilities">Capabilities</NavLink>
        </nav>
      </header>
      <main className={fullBleed ? 'app-main app-main-fullbleed' : 'app-main'}>
        <Routes>
          <Route path="/" element={<RunsIndexPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/capabilities" element={<CapabilitiesPanel />} />
          <Route path="/ai" element={<ChatTab />} />
          <Route path="/builder" element={<BuilderTab />} />
          <Route path="/builder/:workflowId" element={<BuilderTab />} />
        </Routes>
      </main>
      <footer className="app-footer">
        Sample / template code. Not production-hardened.
      </footer>
    </div>
  );
}
