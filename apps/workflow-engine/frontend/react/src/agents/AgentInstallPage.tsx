/**
 * Install-from-registry browser — `/agents/install` (phase E3).
 *
 * Fetches `GET /v1/host/sample/registry/agent-packs` (BE scans the
 * local packs/ directory for `core.openwop.agents.*`). Each row
 * shows the pack's name, version, description, the personas it
 * ships, and an "Install" button for packs that aren't yet
 * registered in the in-process AgentRegistry. Installed packs show
 * "Installed" with no action.
 *
 * Install posts to `POST /v1/host/sample/registry/agent-packs/install`,
 * which invokes the existing `installPackFromRegistry` machinery
 * (signature verification, etc.). On success, the page refreshes
 * the list so the newly-installed pack flips to "Installed".
 *
 * Most agent packs auto-mount at boot via `mountLocalPacks.ts`, so
 * in the typical sample install the page is mostly "already
 * installed" rows — that's a honest reflection of the host's
 * state, not a UX bug.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listAvailableAgentPacks,
  installAgentPack,
  type AgentPackSummary,
} from '../client/agentsClient.js';

interface State {
  packs: readonly AgentPackSummary[];
  isLoading: boolean;
  error: string | null;
}

export function AgentInstallPage(): JSX.Element {
  const [state, setState] = useState<State>({ packs: [], isLoading: true, error: null });
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const packs = await listAvailableAgentPacks();
      setState({ packs, isLoading: false, error: null });
    } catch (err) {
      setState({
        packs: [],
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onInstall(pack: AgentPackSummary): Promise<void> {
    setInstallingName(pack.name);
    setInstallError(null);
    try {
      await installAgentPack(pack.name, pack.version);
      await refresh();
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingName(null);
    }
  }

  return (
    <section aria-labelledby="agent-install-heading">
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Link to="/agents" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          ← All agents
        </Link>
      </div>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h2 id="agent-install-heading" style={{ marginBottom: 'var(--space-1)' }}>
          Install from registry
        </h2>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Agent packs available in this host's local registry mirror.
          Most auto-mount at boot — those rows show "Installed".
        </p>
      </header>

      {state.isLoading && (
        <EmptyBlock>Loading available packs…</EmptyBlock>
      )}
      {state.error && (
        <EmptyBlock tone="error">Couldn't load pack list: {state.error}</EmptyBlock>
      )}
      {installError && (
        <div
          role="alert"
          style={{
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-danger)',
            background: 'color-mix(in oklch, var(--color-danger) 6%, transparent)',
            fontSize: 12.5,
          }}
        >
          Install failed: {installError}
        </div>
      )}
      {!state.isLoading && !state.error && state.packs.length === 0 && (
        <EmptyBlock>
          No agent packs in the local registry. Configure
          {' '}<code>OPENWOP_REGISTRY_URL</code> + restart the host to fetch
          from the public registry.
        </EmptyBlock>
      )}

      {state.packs.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.packs.map((pack) => (
            <PackRow
              key={pack.name}
              pack={pack}
              isInstalling={installingName === pack.name}
              onInstall={() => void onInstall(pack)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PackRow({
  pack,
  isInstalling,
  onInstall,
}: {
  pack: AgentPackSummary;
  isInstalling: boolean;
  onInstall: () => void;
}): JSX.Element {
  return (
    <li
      style={{
        padding: 'var(--space-3) var(--space-4)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <code style={{ fontSize: 13, fontWeight: 600 }}>{pack.name}</code>
          <span className="muted" style={{ fontSize: 11.5 }}>v{pack.version}</span>
          {pack.installed && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 8px',
                borderRadius: 10,
                background: 'color-mix(in oklch, var(--color-success) 14%, transparent)',
                color: 'var(--color-success)',
                fontFamily: 'var(--mono)',
              }}
            >
              installed
            </span>
          )}
        </div>
        {pack.description && (
          <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, marginBottom: 6 }}>
            {pack.description}
          </p>
        )}
        {pack.personas.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pack.personas.map((p) => (
              <span
                key={p}
                style={{
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  fontSize: 11,
                  color: 'var(--ink-2)',
                }}
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        {pack.installed ? (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={onInstall}
            disabled={isInstalling}
            style={{ fontSize: 12 }}
          >
            {isInstalling ? 'Installing…' : 'Install'}
          </button>
        )}
      </div>
    </li>
  );
}

function EmptyBlock({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'error';
}): JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--space-5)',
        border: `1px ${tone === 'error' ? 'solid' : 'dashed'} ${
          tone === 'error' ? 'var(--color-danger)' : 'var(--rule)'
        }`,
        borderRadius: 8,
        textAlign: 'center',
        color: tone === 'error' ? 'var(--color-danger)' : 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
