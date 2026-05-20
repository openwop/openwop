import { useEffect, useState } from 'react';
import { getCapabilities } from '../client/runsClient.js';
import { authedHeaders, config, fetchOpts } from '../client/config.js';

/** Render an advertised boolean as a tri-state glyph. `undefined` means the
 *  host hasn't declared the field; that's distinct from `false` (declared off). */
function boolGlyph(v: boolean | undefined): JSX.Element {
  if (v === true) return <span style={{ color: 'var(--color-success)' }}>✓</span>;
  if (v === false) return <span style={{ color: 'var(--ink-3)' }}>○</span>;
  return <span className="muted">—</span>;
}

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

interface EnvelopeReasoningAd {
  supported?: boolean;
  promptDirective?: 'mandatory' | 'advisory' | 'off';
}
interface EnvelopeReliabilityAd {
  supported?: boolean;
  events?: string[];
  completion?: {
    distinguishesTruncation?: boolean;
    truncationBudgetMultiplier?: number;
  };
}
interface ModelCapabilityRow {
  provider: string;
  model: string;
  capabilities: string[];
}
interface ModelCapabilitiesAd {
  supported?: boolean;
  substitutionSupported?: boolean;
  advertised?: ModelCapabilityRow[];
}

interface Caps {
  capabilities?: {
    hostSurfaces?: HostSurfaceAd[];
    envelopes?: {
      reasoning?: EnvelopeReasoningAd;
      reliability?: EnvelopeReliabilityAd;
      tierOneSubsetCompliance?: 'strict' | 'warn' | 'off';
    };
    modelCapabilities?: ModelCapabilitiesAd;
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
        <h2>Envelope discipline</h2>
        <p className="muted">
          What this host promises about LLM-emission envelopes — the inbound
          payload shape every AI node serves into the run. Three sub-surfaces
          per <a href="https://github.com/openwop/openwop/blob/main/RFCS/0030-envelope-reasoning-and-tier-one-subset.md">RFC 0030</a>,
          {' '}<a href="https://github.com/openwop/openwop/blob/main/RFCS/0032-envelope-reliability-events.md">0032</a>,
          {' '}<a href="https://github.com/openwop/openwop/blob/main/RFCS/0033-envelope-completion-contract.md">0033</a>.
          When a row reads <code>—</code>, the host hasn't advertised that surface yet.
        </p>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          When the reliability events below fire on a run, they surface live in the AI chat as
          inline chips inside the assistant bubble (retries, refusals, truncations, model
          substitutions, prose-to-JSON coercions, partial-payload recoveries).
        </p>
        {caps ? (
          <table className="cap-table">
            <thead>
              <tr><th>Surface</th><th>Value</th><th>Note</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>envelopes.reasoning.supported</code></td>
                <td>{boolGlyph(caps.capabilities?.envelopes?.reasoning?.supported)}</td>
                <td className="muted">RFC 0030 §A — optional <code>reasoning</code> string on envelope payloads</td>
              </tr>
              <tr>
                <td><code>envelopes.reasoning.promptDirective</code></td>
                <td>{caps.capabilities?.envelopes?.reasoning?.promptDirective
                  ? <code>{caps.capabilities.envelopes.reasoning.promptDirective}</code>
                  : <span className="muted">—</span>}</td>
                <td className="muted">how aggressively the host prompts the model to populate it</td>
              </tr>
              <tr>
                <td><code>envelopes.tierOneSubsetCompliance</code></td>
                <td>{caps.capabilities?.envelopes?.tierOneSubsetCompliance
                  ? <code>{caps.capabilities.envelopes.tierOneSubsetCompliance}</code>
                  : <span className="muted">—</span>}</td>
                <td className="muted">RFC 0030 §B — host's posture on the OpenAI ∩ Anthropic ∩ Gemini schema subset</td>
              </tr>
              <tr>
                <td><code>envelopes.reliability.supported</code></td>
                <td>{boolGlyph(caps.capabilities?.envelopes?.reliability?.supported)}</td>
                <td className="muted">RFC 0032 — host emits retry / refusal / truncation events</td>
              </tr>
              <tr>
                <td><code>envelopes.reliability.events</code></td>
                <td>{caps.capabilities?.envelopes?.reliability?.events?.length
                  ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{caps.capabilities.envelopes.reliability.events.join(', ')}</span>
                  : <span className="muted">—</span>}</td>
                <td className="muted">which reliability event types this host actually emits</td>
              </tr>
              <tr>
                <td><code>envelopes.reliability.completion.distinguishesTruncation</code></td>
                <td>{boolGlyph(caps.capabilities?.envelopes?.reliability?.completion?.distinguishesTruncation)}</td>
                <td className="muted">RFC 0033 — host branches retry strategy on truncation vs schema-violation</td>
              </tr>
              <tr>
                <td><code>envelopes.reliability.completion.truncationBudgetMultiplier</code></td>
                <td>{typeof caps.capabilities?.envelopes?.reliability?.completion?.truncationBudgetMultiplier === 'number'
                  ? <code>×{caps.capabilities.envelopes.reliability.completion.truncationBudgetMultiplier}</code>
                  : <span className="muted">—</span>}</td>
                <td className="muted">how much extra output budget the host gives on a truncation retry</td>
              </tr>
            </tbody>
          </table>
        ) : (
          !error && <div className="muted">Loading…</div>
        )}
      </div>

      <div className="card">
        <h2>Model capabilities</h2>
        <p className="muted">
          Per <a href="https://github.com/openwop/openwop/blob/main/RFCS/0031-envelope-variants-and-model-capabilities.md">RFC 0031</a> — what each
          installed provider/model can do (function-calling, vision, streaming, etc.), and whether
          this host will silently substitute a fallback model when the workflow asks for a capability
          the configured model lacks. Substitution is observable via the <code>model.capability.substituted</code> event.
        </p>
        {caps?.capabilities?.modelCapabilities ? (
          <>
            <p>
              <strong>{caps.capabilities.modelCapabilities.supported ? 'Advertised' : 'Not advertised'}</strong>
              {' · '}substitution {caps.capabilities.modelCapabilities.substitutionSupported ? 'on' : 'off'}
              {' · '}{caps.capabilities.modelCapabilities.advertised?.length ?? 0} models declared
            </p>
            {caps.capabilities.modelCapabilities.advertised?.length ? (
              <table className="cap-table">
                <thead>
                  <tr><th>Provider</th><th>Model</th><th>Capabilities</th></tr>
                </thead>
                <tbody>
                  {caps.capabilities.modelCapabilities.advertised.map((row) => (
                    <tr key={`${row.provider}/${row.model}`}>
                      <td><code>{row.provider}</code></td>
                      <td><code>{row.model}</code></td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{row.capabilities.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          !error && <div className="muted">Host doesn't advertise <code>modelCapabilities</code> yet.</div>
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
