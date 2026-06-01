/**
 * PackBrowser — live registry browser (RFC 0003 / 0013 / 0043).
 *
 * A modal launched from the node palette. Pulls the public registry
 * index (all published packs, not just the ones this host installed at
 * boot) and lets the user search, inspect supply-chain provenance
 * (trust tier, signature method + key id, SRI integrity, SBOM) and see
 * which packs' nodes are already installed and draggable here.
 *
 * Installing a not-yet-installed pack into a running host is an operator
 * action (OPENWOP_INSTALL_PACKS / registry installer), so the browser is
 * read-only discovery; it links to the manifest, signature and SBOM and
 * flags installed typeIds rather than mutating the host.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  fetchRegistryIndex,
  fetchPackDetail,
  trustTierFor,
  TRUST_TIER_LABEL,
  registryUrl,
  sbomUrlFor,
  type PackIndexEntry,
  type PackDetail,
  type PackVersionRecord,
} from './registryClient.js';
import { CheckIcon, XIcon } from '../ui/icons/index.js';

interface Props {
  /** typeIds already in the merged local catalog (installed + draggable). */
  installedTypeIds: ReadonlySet<string>;
  onClose: () => void;
  /** §A6 — "use in builder": drop an installed pack node onto the canvas.
   *  Receives the node's typeId; the host resolves it to a builder kind and
   *  adds it. Omitted when the browser is opened outside a builder context. */
  onUseNode?: (typeId: string) => void;
}

const TIER_COLOR: Record<string, string> = {
  official: '#10b981',
  vendor: '#0ea5e9',
  community: '#8b5cf6',
  unknown: 'var(--ink-3)',
};

export function PackBrowser({ installedTypeIds, onClose, onUseNode }: Props) {
  const [packs, setPacks] = useState<PackIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRegistryIndex()
      .then((idx) => { if (!cancelled) setPacks(idx.packs); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!packs) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? packs.filter((p) =>
          `${p.name} ${p.description} ${p.tags.join(' ')} ${p.typeIds.join(' ')}`.toLowerCase().includes(q))
      : packs;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [packs, query]);

  return (
    <div className="pack-browser-overlay" role="dialog" aria-modal="true" aria-label="Pack registry">
      <div className="pack-browser">
        <header className="pack-browser-header">
          <strong style={{ flex: 1 }}>Pack registry</strong>
          {packs && <span className="muted" style={{ fontSize: 12 }}>{packs.length} published</span>}
          <button type="button" className="secondary" onClick={onClose} aria-label="Close"><XIcon size={14} /></button>
        </header>
        <div className="pack-browser-search">
          <input
            type="search"
            placeholder="Search packs, tags, typeIds…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {error && <div className="alert error" style={{ margin: 8 }}>Registry unreachable: {error}</div>}
        {!packs && !error && <div className="muted" style={{ padding: 16 }}>Loading registry…</div>}
        <div className="pack-browser-body">
          <ul className="pack-browser-list">
            {filtered.map((p) => {
              const tier = trustTierFor(p.name);
              const installedCount = p.typeIds.filter((t) => installedTypeIds.has(t)).length;
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    className={`pack-browser-row${selected === p.name ? ' pack-browser-row-selected' : ''}`}
                    onClick={() => setSelected(p.name)}
                  >
                    <span className="pack-tier-dot" style={{ background: TIER_COLOR[tier] }} aria-hidden />
                    <span className="pack-browser-row-name">{p.name}</span>
                    {p.yanked && <span className="pack-flag pack-flag-danger">yanked</span>}
                    {p.deprecated && !p.yanked && <span className="pack-flag">deprecated</span>}
                    {installedCount > 0 && (
                      <span className="pack-flag pack-flag-ok" title={`${installedCount} typeId(s) installed`}>
                        installed
                      </span>
                    )}
                    <span className="muted pack-browser-row-counts">
                      {p.nodeCount}n{p.agentCount > 0 ? ` ${p.agentCount}a` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
            {packs && filtered.length === 0 && <li className="muted" style={{ padding: 8 }}>No packs match.</li>}
          </ul>
          <div className="pack-browser-detail">
            {selected ? (
              <PackDetailView name={selected} installedTypeIds={installedTypeIds} onUseNode={onUseNode} />
            ) : (
              <p className="muted" style={{ padding: 16 }}>Select a pack to view its manifest, signature, trust tier and SBOM.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PackDetailView({
  name,
  installedTypeIds,
  onUseNode,
}: {
  name: string;
  installedTypeIds: ReadonlySet<string>;
  onUseNode?: (typeId: string) => void;
}) {
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchPackDetail(name)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [name]);

  if (error) return <div className="alert error" style={{ margin: 8 }}>{error}</div>;
  if (!detail) return <div className="muted" style={{ padding: 16 }}>Loading {name}…</div>;

  const tier = trustTierFor(detail.name);
  const latest = detail.versions.find((v) => v.version === detail.latest) ?? detail.versions[detail.versions.length - 1];

  return (
    <div className="pack-detail">
      <div className="pack-detail-head">
        <h3>{detail.name}</h3>
        <span className="pack-tier-badge" style={{ borderColor: TIER_COLOR[tier], color: TIER_COLOR[tier] }}>
          {TRUST_TIER_LABEL[tier]}
        </span>
      </div>
      <p className="pack-detail-desc">{detail.description}</p>
      <p className="muted" style={{ fontSize: 12 }}>
        {detail.author && <>by {detail.author} · </>}
        {detail.license} ·{' '}
        {detail.homepage && <a href={detail.homepage} target="_blank" rel="noreferrer">homepage</a>}
        {detail.homepage && detail.repository && ' · '}
        {detail.repository && <a href={detail.repository} target="_blank" rel="noreferrer">repo</a>}
      </p>

      {latest && (
        <div className="pack-detail-provenance">
          <h4>Latest {latest.version}</h4>
          <dl>
            <dt>Signature</dt>
            <dd>
              {latest.signingMethod} · key <code>{latest.signingKeyId}</code> ·{' '}
              <a href={registryUrl(latest.signatureUrl)} target="_blank" rel="noreferrer">.sig</a>
            </dd>
            <dt>Integrity (SRI)</dt>
            <dd><code className="pack-sri">{latest.integrity}</code></dd>
            <dt>Artifacts</dt>
            <dd>
              <a href={registryUrl(latest.manifestUrl)} target="_blank" rel="noreferrer">manifest</a> ·{' '}
              <a href={sbomUrlFor(latest)} target="_blank" rel="noreferrer">SBOM</a> ·{' '}
              <a href={registryUrl(latest.tarballUrl)} target="_blank" rel="noreferrer">tarball</a>
            </dd>
          </dl>
        </div>
      )}

      <h4>Type IDs ({detail.typeIds.length})</h4>
      <ul className="pack-typeid-list">
        {detail.typeIds.map((t) => {
          const installed = installedTypeIds.has(t);
          return (
            <li key={t}>
              <code>{t}</code>
              {installed
                ? <span className="pack-flag pack-flag-ok">installed</span>
                : <span className="muted pack-flag">not installed</span>}
              {installed && onUseNode && (
                <button
                  type="button"
                  className="secondary pack-use-node"
                  style={{ marginLeft: 6, padding: '1px 8px', fontSize: 11, minHeight: 0 }}
                  onClick={() => onUseNode(t)}
                  title="Add this node to the builder canvas"
                >
                  + canvas
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {detail.versions.length > 1 && (
        <details className="pack-versions">
          <summary className="muted">All versions ({detail.versions.length})</summary>
          <ul>
            {[...detail.versions].reverse().map((v) => (
              <li key={v.version}>
                <code>{v.version}</code>
                {v.yanked && <span className="pack-flag pack-flag-danger">yanked</span>}
                {v.deprecated && !v.yanked && <span className="pack-flag">deprecated</span>}
                <span className="muted" style={{ fontSize: 11 }}> {v.publishedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <InstallGuidance detail={detail} latest={latest} installedTypeIds={installedTypeIds} />
    </div>
  );
}

/** Turns the "not installed" dead-end into actionable operator guidance:
 *  the exact `OPENWOP_INSTALL_PACKS=<name>@<version>` line to set + restart.
 *  (On-demand install from the browser is deferred behind a trust-tier +
 *  auth model — RFC 0043; see plans/pack-install-rfc0043-multitenancy.md.) */
function InstallGuidance({
  detail,
  latest,
  installedTypeIds,
}: {
  detail: PackDetail;
  latest: PackVersionRecord | undefined;
  installedTypeIds: ReadonlySet<string>;
}) {
  const [copied, setCopied] = useState(false);
  const installedCount = detail.typeIds.filter((t) => installedTypeIds.has(t)).length;
  const allInstalled = detail.typeIds.length > 0 && installedCount === detail.typeIds.length;
  if (allInstalled) {
    return (
      <p className="muted pack-detail-install-note">
        <CheckIcon size={12} /> All of this pack&apos;s nodes are installed — drag them onto the canvas from the palette.
      </p>
    );
  }
  const installLine = `OPENWOP_INSTALL_PACKS=${detail.name}@${latest?.version ?? detail.latest}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installLine);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = installLine;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="pack-detail-install-note">
      <p className="muted" style={{ marginBottom: 4 }}>
        {installedCount > 0
          ? `${installedCount}/${detail.typeIds.length} of this pack's nodes are installed.`
          : 'Not installed on this host.'}{' '}
        The browser is read-only discovery — to add it, an operator sets this on the host env and restarts:
      </p>
      <div className="pack-install-cmd">
        <code>{installLine}</code>
        <button type="button" className="secondary" onClick={copy} title="Copy the install env line">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        On-demand install from the browser is deferred behind a trust-tier + auth model (RFC 0043).
      </p>
    </div>
  );
}
