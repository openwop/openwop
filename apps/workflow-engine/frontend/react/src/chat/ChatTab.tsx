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
    return <div className="muted" style={{ padding: 24 }}>Loading…</div>;
  }

  if (error) {
    return (
      <div className="alert error" style={{ margin: 24 }}>
        Cannot reach backend: <code>{error}</code>
        <div style={{ marginTop: 8, fontSize: 12 }}>
          Is the BE running at <code>{import.meta.env.VITE_OPENWOP_BASE_URL ?? 'http://localhost:8080'}</code>?
        </div>
      </div>
    );
  }

  const needsWizard = !config || !isValid || forceWizard;

  if (needsWizard) {
    return (
      <BYOKWizard
        onComplete={async (cfg) => {
          await setConfig(cfg);
          setForceWizard(false);
        }}
        onCancel={forceWizard ? () => setForceWizard(false) : undefined}
      />
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
