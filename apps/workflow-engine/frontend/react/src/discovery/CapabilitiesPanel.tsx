import { useEffect, useState } from 'react';
import { getCapabilities } from '../client/runsClient.js';
import { authedHeaders, config, fetchOpts } from '../client/config.js';

interface HostSurfaceAd {
  name: string;
  supported: boolean;
  implementation?: string;
  note?: string;
}

interface CatalogNode {
  typeId: string;
  packName?: string;
  source: 'local' | 'pack';
  requiresHostSurfaces?: string[];
  missingHostSurfaces?: string[];
}

interface Caps {
  capabilities?: {
    hostSurfaces?: HostSurfaceAd[];
  };
}

interface CatalogResp {
  nodes: CatalogNode[];
}

export function CapabilitiesPanel() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [catalog, setCatalog] = useState<CatalogResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getCapabilities() as Promise<Caps>,
      fetch(`${config.baseUrl}/v1/host/sample/node-catalog`, fetchOpts({
        headers: authedHeaders(),
      })).then((r) => r.json() as Promise<CatalogResp>),
    ])
      .then(([c, k]) => {
        if (cancelled) return;
        setCaps(c);
        setCatalog(k);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const surfaces = caps?.capabilities?.hostSurfaces ?? [];
  const nodes = catalog?.nodes ?? [];
  const runnable = nodes.filter((n) => !n.missingHostSurfaces || n.missingHostSurfaces.length === 0);
  const blocked = nodes.length - runnable.length;

  // Group blocked nodes by their first missing surface — so users see
  // "12 nodes need host.mcp" rather than 12 separate rows.
  const blockedBySurface = new Map<string, number>();
  for (const n of nodes) {
    const m = n.missingHostSurfaces ?? [];
    if (m.length === 0) continue;
    const key = m[0]!;
    blockedBySurface.set(key, (blockedBySurface.get(key) ?? 0) + 1);
  }

  return (
    <section>
      <div className="card">
        <h2>Pack coverage</h2>
        <p className="muted">
          What this host can actually run from the installed packs. Coverage is
          (runnable / total) where "runnable" means every required host surface is
          advertised. The remainder will return <code>HOST_CAPABILITY_MISSING</code>
          if executed here — the workflow still serializes and ships, so deploying
          to a fuller host stays cheap.
        </p>
        {error && <div className="alert error">{error}</div>}
        {catalog ? (
          <>
            <p>
              <strong>{runnable.length}</strong> runnable
              {' / '}<strong>{nodes.length}</strong> total
              {blocked > 0 ? <> · <strong>{blocked}</strong> blocked</> : null}
            </p>
            {blockedBySurface.size > 0 ? (
              <table className="cap-table">
                <thead>
                  <tr><th>Blocked by surface</th><th>Nodes</th></tr>
                </thead>
                <tbody>
                  {[...blockedBySurface.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([s, n]) => (
                      <tr key={s}><td><code>{s}</code></td><td>{n}</td></tr>
                    ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          !error && <div className="muted">Loading…</div>
        )}
      </div>

      <div className="card">
        <h2>Host surfaces</h2>
        <p className="muted">
          Live render of <code>capabilities.hostSurfaces</code>. The
          <em> implementation</em> column tells you what's backing each surface
          — values like <code>in-memory</code> or <code>sqlite-in-memory</code>
          mean the surface is demo-grade. Phase 6 swaps these with real-backend
          adapters from <code>examples/hosts/postgres</code>.
        </p>
        {surfaces.length > 0 ? (
          <table className="cap-table">
            <thead>
              <tr><th>Surface</th><th>Supported</th><th>Implementation</th><th>Note</th></tr>
            </thead>
            <tbody>
              {surfaces.map((s) => (
                <tr key={s.name}>
                  <td><code>{s.name}</code></td>
                  <td>{s.supported ? '✓' : '○'}</td>
                  <td>{s.implementation ? <code>{s.implementation}</code> : <span className="muted">—</span>}</td>
                  <td className="muted">{s.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !error && <div className="muted">Loading…</div>
        )}
      </div>

      <div className="card">
        <h2>Raw advertisement</h2>
        <p className="muted">
          Full <code>GET /.well-known/openwop</code> payload.
        </p>
        {caps ? (
          <pre>{JSON.stringify(caps, null, 2)}</pre>
        ) : (
          !error && <div className="muted">Loading…</div>
        )}
      </div>
    </section>
  );
}
