import { NavLink, Route, Routes } from 'react-router-dom';
import { RunsIndexPage } from './runs/RunsIndexPage.js';
import { RunDetailPage } from './runs/RunDetailPage.js';
import { CapabilitiesPanel } from './discovery/CapabilitiesPanel.js';
import { ChatTab } from './chat/ChatTab.js';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>OpenWOP — workflow-engine sample</h1>
        <nav>
          <NavLink to="/ai">AI</NavLink>
          <NavLink to="/" end>Runs</NavLink>
          <NavLink to="/capabilities">Capabilities</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<RunsIndexPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="/capabilities" element={<CapabilitiesPanel />} />
          <Route path="/ai" element={<ChatTab />} />
        </Routes>
      </main>
      <footer className="app-footer">
        Sample / template code. Not production-hardened.
      </footer>
    </div>
  );
}
