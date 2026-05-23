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
import { BackendStatusCard } from './BackendStatusCard.js';
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

  // Unified adaptive card for the loading-OR-error state. Replaces
  // the prior two-card flow (Spinning up → The demo is resting) that
  // flashed two distinct messages at the user. BackendStatusCard
  // reads localStorage `lastSuccessAt` to predict warm/cold, then
  // adapts its copy over elapsed time + on error — same chrome
  // throughout so the transition is invisible. See
  // chat/BackendStatusCard.tsx for the phase machine.
  if (isLoading || error) {
    return (
      <BackendStatusCard
        error={error}
        backendUrl={import.meta.env.VITE_OPENWOP_BASE_URL}
      />
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
