import { useEffect, useState } from 'react';
import { getCapabilities } from '../client/runsClient.js';
import { authedHeaders, config, fetchOpts } from '../client/config.js';
import { McpToolsPanel } from '../mcp/McpToolsPanel.js';
import { PageHeader } from '../ui/PageHeader.js';
import { A2APeerPanel } from '../peers/A2APeerPanel.js';
import { CheckIcon, CircleIcon } from '../ui/icons/index.js';

/** Render an advertised boolean as a tri-state glyph. `undefined` means the
 *  host hasn't declared the field; that's distinct from `false` (declared off). */
function boolGlyph(v: boolean | undefined): JSX.Element {
  if (v === true) return <span style={{ color: 'var(--color-success)' }}><CheckIcon size={14} /></span>;
  if (v === false) return <span style={{ color: 'var(--ink-3)' }}><CircleIcon size={14} /></span>;
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
interface ModelCapabilitiesAd {
  supported?: boolean;
  substitutionSupported?: boolean;
  // Per schemas/capabilities.schema.json §modelCapabilities.advertised:
  // flat list of capability identifiers (`structured-output`, `reasoning`, …),
  // not per-model rows.
  advertised?: string[];
}

interface ImplementationAd {
  name?: string;
  version?: string;
  vendor?: string;
}

interface Caps {
  implementation?: ImplementationAd;
  capabilities?: {
    hostSurfaces?: HostSurfaceAd[];
    profiles?: string[];
    auth?: { profiles?: string[] };
    envelopes?: {
      reasoning?: EnvelopeReasoningAd;
      reliability?: EnvelopeReliabilityAd;
      tierOneSubsetCompliance?: 'strict' | 'warn' | 'off';
    };
    modelCapabilities?: ModelCapabilitiesAd;
  };
}

/** Reference-host badge filenames served at `${config.siteBaseUrl}/badge/<host>.svg`.
 *  Map common implementation-name fragments to a published badge so a host
 *  that identifies as one of the references gets its credibility surface
 *  inline. Out-of-tree hosts (e.g. MyndHyve workflow-runtime) fall through
 *  to the generic "see leaderboard" affordance. Origin is config-driven so
 *  an air-gapped / fork deployment can point at its own badge mirror via
 *  `VITE_OPENWOP_SITE_URL` (the badge SVGs ship in this repo's
 *  `public/badge/` for same-origin serving). */
const KNOWN_BADGE_HOSTS: ReadonlyArray<{ match: RegExp; file: string; label: string }> = [
  { match: /postgres/i, file: 'postgres.svg', label: 'Postgres reference host' },
  { match: /sqlite/i, file: 'sqlite.svg', label: 'SQLite reference host' },
  { match: /python/i, file: 'python-in-memory.svg', label: 'Python in-memory reference host' },
  { match: /in.?memory|workflow.?engine/i, file: 'in-memory.svg', label: 'In-memory reference host' },
];

function matchBadgeFor(implName?: string): { url: string; label: string } | null {
  if (!implName) return null;
  for (const entry of KNOWN_BADGE_HOSTS) {
    if (entry.match.test(implName)) {
      return { url: `${config.siteBaseUrl}/badge/${entry.file}`, label: entry.label };
    }
  }
  return null;
}

const LEADERBOARD_URL = `${config.siteBaseUrl}/conformance/`;

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
      <PageHeader
        eyebrow="Discovery"
        title="Host capabilities"
        lede={<>What this host can actually run from the installed packs. Coverage is (runnable / total) where "runnable" means every required host surface is advertised. The remainder will return <code>HOST_CAPABILITY_MISSING</code> if executed here — the workflow still serializes and ships, so deploying to a fuller host stays cheap.</>}
      />
      <div className="card">
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
                  <td>{s.supported ? <CheckIcon size={14} /> : <CircleIcon size={14} />}</td>
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
              {' · '}{caps.capabilities.modelCapabilities.advertised?.length ?? 0} capabilities declared
            </p>
            {caps.capabilities.modelCapabilities.advertised?.length ? (
              <p style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                {caps.capabilities.modelCapabilities.advertised.map((c) => <code key={c} style={{ marginRight: 8 }}>{c}</code>)}
              </p>
            ) : null}
          </>
        ) : (
          !error && <div className="muted">Host doesn't advertise <code>modelCapabilities</code> yet.</div>
        )}
      </div>

      <McpToolsPanel />
      <A2APeerPanel />

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

      <ConformanceProfilesCard caps={caps} />
    </section>
  );
}

/** Per `plans/app-buildable-now-on-existing-protocol.md` §21 — render the
 *  connected host's implementation identity + advertised profile set + a
 *  conformance-badge affordance. The badge is embedded when the implementation
 *  name matches a published reference-host badge (openwop.dev/badge/*.svg);
 *  out-of-tree hosts get a leaderboard link instead. Always shows the
 *  Implementation row so an operator can copy the exact `{name, version, vendor}`
 *  for a bug report. */
function ConformanceProfilesCard({ caps }: { caps: Caps | null }): JSX.Element {
  const impl = caps?.implementation ?? {};
  const interruptProfiles = caps?.capabilities?.profiles ?? [];
  const authProfiles = caps?.capabilities?.auth?.profiles ?? [];
  const allProfiles = [...new Set([...interruptProfiles, ...authProfiles])].sort();
  const badge = matchBadgeFor(impl.name);
  return (
    <div className="card">
      <h2>Conformance &amp; profiles</h2>
      <p className="muted">
        The connected host's identity + every profile it advertises through{' '}
        <code>capabilities.profiles[]</code> and <code>capabilities.auth.profiles[]</code>{' '}
        — the surfaces an external implementer can rely on. See the{' '}
        <a href={LEADERBOARD_URL} target="_blank" rel="noreferrer">
          conformance leaderboard
        </a>{' '}
        for the cross-host pass-rate matrix.
      </p>
      <table className="cap-table">
        <tbody>
          <tr>
            <th className="cap-table-label">Implementation</th>
            <td>
              {impl.name ? <code>{impl.name}</code> : <span className="muted">—</span>}
              {impl.version ? <> <span className="muted">v{impl.version}</span></> : null}
              {impl.vendor ? <> <span className="muted">· {impl.vendor}</span></> : null}
            </td>
          </tr>
          <tr>
            <th className="cap-table-label">Profiles claimed ({allProfiles.length})</th>
            <td>
              {allProfiles.length === 0 ? (
                <span className="muted">none advertised</span>
              ) : (
                <div className="cap-chip-list">
                  {allProfiles.map((p) => (
                    <code key={p}>{p}</code>
                  ))}
                </div>
              )}
            </td>
          </tr>
          <tr>
            <th className="cap-table-label">Reference-host badge</th>
            <td>
              {badge ? (
                <a href={LEADERBOARD_URL} target="_blank" rel="noreferrer" title={badge.label}>
                  <img className="cap-badge-img" src={badge.url} alt={`${badge.label} conformance badge`} />
                </a>
              ) : (
                <span className="muted">
                  No published badge for this implementation. Hosts that match a reference (in-memory, sqlite, postgres, python) get one inline; see the{' '}
                  <a href={LEADERBOARD_URL} target="_blank" rel="noreferrer">leaderboard</a>{' '}
                  for all published hosts.
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
