/**
 * Top-level AI tab — gates the chat surface on BYOK being configured.
 *
 * State machine:
 *   - useBYOKConfig is loading → spinner
 *   - no active config OR config's credentialRef missing on BE → wizard
 *   - settings drawer open → wizard (with cancel)
 *   - otherwise → ChatSidebar
 *
 * The user can always swap providers / models / keys from the chat
 * header without losing their session (the chat session is keyed by id,
 * not by provider).
 */

import { useEffect, useState } from 'react';
import { BYOKWizard } from '../byok/BYOKWizard.js';
import { useBYOKConfig } from '../byok/lib/useBYOKConfig.js';
import { ChatSidebar } from './ChatSidebar.js';
import { registerDefaultCards } from './registry/defaultCards.js';

// Ensure the 4 built-in interrupt cards are registered at first render.
registerDefaultCards();

export function ChatTab(): JSX.Element {
  const { config, isValid, isLoading, error, setConfig, refresh } = useBYOKConfig();
  const [forceWizard, setForceWizard] = useState(false);

  // Auto-refresh storedRefs when the tab becomes visible (e.g., after
  // the user resolves an issue in another tab).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  if (isLoading) {
    // Same editorial-postcard chrome as the resting-server state. On
    // first load the user is usually waiting on the Cloud Run cold-
    // start (and our own session bootstrap). A bare "Loading…" line
    // looked broken; a card with a serif title + animated dots tells
    // the user the wait is intentional and short.
    return (
      <div className="backend-resting-wrap">
        <div className="backend-resting-card">
          <h2 className="backend-resting-title">
            Spinning up your demo server
            <span className="backend-spinup-ellipsis" aria-hidden="true">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </h2>
          <p className="backend-resting-body">
            The Cloud Run server spins down between visits to keep the sample
            cheap to host. The first request takes a moment to warm up — usually
            10–30 seconds.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    // Editorial postcard — replaces the prior red-bordered ".alert error"
    // box. The Cloud Run backend spins down between visits to keep the
    // sample cheap to host; a 401/network/timeout on the first request
    // most commonly means the user hit a cold-start (or a quiet
    // moment), not a real outage. Tone is calm + actionable; no red.
    return (
      <div className="backend-resting-wrap">
        <div className="backend-resting-card">
          <h2 className="backend-resting-title">The demo is resting</h2>
          <p className="backend-resting-body">
            The Cloud Run server spins down between visits to keep the sample
            cheap to host. Please refresh your browser.
          </p>
          {/* Detail visible to the curious + helpful for debugging. Muted
              so it doesn't dominate the postcard. */}
          <details className="backend-resting-detail">
            <summary>Technical detail</summary>
            <p>
              <code>{error}</code>
              <br />
              Backend URL:{' '}
              <code>
                {import.meta.env.VITE_OPENWOP_BASE_URL ?? 'http://localhost:8080'}
              </code>
            </p>
          </details>
        </div>
      </div>
    );
  }

  const needsWizard = !config || !isValid || forceWizard;

  if (needsWizard) {
    // .app-main--ai is now `overflow: hidden` so the chat surface
    // doesn't double-scroll past the sticky header. The wizard takes
    // its place here, so wrap it in its own scroll container so its
    // content stays reachable on short viewports.
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <BYOKWizard
          onComplete={async (cfg) => {
            await setConfig(cfg);
            setForceWizard(false);
          }}
          onCancel={forceWizard ? () => setForceWizard(false) : undefined}
        />
      </div>
    );
  }

  return (
    <ChatSidebar
      config={config!}
      onOpenSettings={() => setForceWizard(true)}
      onRemoveKey={async () => {
        await setConfig(null);
        setForceWizard(false);
      }}
    />
  );
}
