import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { NetworkPanel } from './devtools/NetworkPanel.js';
import { installNetworkRecorder } from './devtools/networkRecorder.js';
import { NotificationPanel } from './notifications/NotificationPanel.js';
import { useNotificationStore } from './notifications/notificationStore.js';
import { DemoHostBanner } from './builder/DemoHostBanner.js';
import { NotFoundPage } from './NotFoundPage.js';
import { Sidebar } from './chrome/Sidebar.js';
import { AppGate } from './chrome/AppGate.js';
import { AdminLayout } from './chrome/AdminLayout.js';
import { AutoSeedDemoData } from './chrome/AutoSeedDemoData.js';
import { FEATURES, chromeFor, isAdminPath } from './chrome/features.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { Toaster } from './ui/toast.js';
import { brand } from './brand/brand.js';

/**
 * The app shell renders ENTIRELY from the feature manifest
 * (`chrome/features.tsx`) — routes, the workspace/admin tier split, and the
 * width chrome all derive from declarations there. Adding a page means adding
 * ONE manifest entry; this file never changes (white-label PRD §2/§3).
 */
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

  // Width/scroll treatment is manifest-declared per route (`chrome:`), never
  // hand-listed here. Admin-tier routes render inside <AdminLayout>'s
  // two-column shell, which needs the full-bleed main.
  const chrome = chromeFor(location.pathname);
  const admin = isAdminPath(location.pathname);
  const mainClass = admin
    ? 'app-main app-main-fullbleed page-enter'
    : chrome === 'fullbleed'
      ? 'app-main app-main-fullbleed'
      : chrome === 'chat'
        ? 'app-main app-main--ai'
        : chrome === 'narrow'
          ? 'app-main app-main--narrow page-enter'
          : 'app-main page-enter';
  return (
    <AppGate>
    <div className={chrome === 'chat' ? 'app-shell app-shell--ai' : 'app-shell'}>
      <AutoSeedDemoData />
      {/* Persistent left rail: grouped workspace nav (Build / Operate) + the
          single Admin entry, collapsible, with the workspace/org switcher +
          account chrome. Chat stays first (feedback_chat_first_nav). */}
      <Sidebar netOpen={netOpen} onToggleNet={() => setNetOpen((v) => !v)} />
      <div className="app-body">
        <DemoHostBanner />
        <main className={mainClass}>
        <Routes>
          {FEATURES.filter((f) => f.tier !== 'admin').map((f) => (
            <Route key={f.path} path={f.path} element={f.element} />
          ))}
          {/* Admin tier: a PATHLESS layout route — admin pages keep their
              original deep-link paths while rendering inside the embedded
              collapsible admin rail. */}
          <Route element={<AdminLayout />}>
            {FEATURES.filter((f) => f.tier === 'admin').map((f) => (
              <Route key={f.path} path={f.path} element={f.element} />
            ))}
          </Route>
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
