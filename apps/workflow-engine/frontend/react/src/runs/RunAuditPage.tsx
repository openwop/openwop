/**
 * Dedicated per-run audit-log viewer.
 *
 * The shipped per-run Operations panel (`RunOpsPanel.tsx`) has an inline
 * "Verify audit integrity" button that shows a compact one-line result.
 * This page is the full surface called for in plan Item #13:
 *
 *   - re-runs `client.audit.verify(0, lastSeq)` on mount + on click
 *   - shows the chain-valid status as a prominent banner
 *   - lists every signed checkpoint with its merkle root + signature,
 *     ordered by sequence — the "audit timeline"
 *   - lists every detected anomaly with full expected/actual hashes
 *     (not just the short prefixes the side panel shows)
 *   - exports the full `AuditVerifyResult` as JSON for offline review
 *     or out-of-band re-verification via `scripts/verify-audit-checkpoints.mjs`
 *
 * Capability-gated on the host advertising the
 * `openwop-audit-log-integrity` auth profile (`spec/v1/auth-profiles.md`).
 * When absent, the page renders an explanatory placeholder rather than
 * 500'ing on the `audit.verify` call.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuditVerifyResult, RunEventDoc } from '@openwop/openwop';
import { getSdkClient, getCapabilities, pollEvents } from '../client/runsClient.js';

export function RunAuditPage() {
  const { runId = '' } = useParams();
  const [auditProfile, setAuditProfile] = useState<boolean | null>(null);
  const [events, setEvents] = useState<RunEventDoc[]>([]);
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gate the page on the host advertising openwop-audit-log-integrity.
  // Without the profile the audit.verify endpoint 404s, so it's better
  // to render a friendly explainer than to surface a network error.
  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((caps) => {
        const profiles = ((caps.auth as { profiles?: string[] } | undefined)?.profiles) ?? [];
        if (!cancelled) setAuditProfile(profiles.includes('openwop-audit-log-integrity'));
      })
      .catch(() => { if (!cancelled) setAuditProfile(false); });
    return () => { cancelled = true; };
  }, []);

  // Replay the public event log so we know lastSeq — verify(0, lastSeq)
  // covers the full run. Re-runs once on initial render; the user can
  // re-verify via the button if the run extends after this page loads.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    pollEvents(runId, 0)
      .then((poll) => { if (!cancelled) setEvents([...poll.events]); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [runId]);

  const lastSeq = events.reduce((m, e) => Math.max(m, e.sequence), 0);

  const runVerify = useCallback(async () => {
    if (auditProfile !== true) return;
    setVerifying(true);
    setError(null);
    try {
      const r = await getSdkClient().audit.verify(0, lastSeq);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }, [auditProfile, lastSeq]);

  // Auto-verify once we have both the profile gate result and the events.
  useEffect(() => {
    if (auditProfile === true && lastSeq > 0 && result === null && !verifying) {
      void runVerify();
    }
  }, [auditProfile, lastSeq, result, verifying, runVerify]);

  function onDownload() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${runId}-audit-checkpoints.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <h1 style={{ flex: 1, margin: 0 }}>Audit log — <code style={{ fontSize: 14 }}>{runId}</code></h1>
        <Link to={`/runs/${runId}`} className="linklike" style={{ fontSize: 13 }}>← Back to run</Link>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Append-only hash chain + Merkle-rooted signed checkpoints per the{' '}
        <code>openwop-audit-log-integrity</code> profile (RFC 0009 / 0010).
        Verification re-runs <code>client.audit.verify(0, {lastSeq})</code>
        on demand and the export bundles the full <code>AuditVerifyResult</code>{' '}
        for offline re-verification via{' '}
        <code>scripts/verify-audit-checkpoints.mjs</code>.
      </p>

      {auditProfile === false && (
        <div className="alert warning">
          <strong>Host does not advertise <code>openwop-audit-log-integrity</code>.</strong>{' '}
          The audit endpoint is unavailable. Configure the host to advertise the profile via{' '}
          <code>auth.profiles</code> on <code>/.well-known/openwop</code> to enable verification.
        </div>
      )}

      {auditProfile === true && (
        <>
          <div className="button-row" style={{ marginBottom: 12 }}>
            <button type="button" onClick={() => void runVerify()} disabled={verifying || lastSeq === 0}>
              {verifying ? 'Verifying…' : 'Re-verify'}
            </button>
            <button type="button" className="secondary" onClick={onDownload} disabled={!result}>
              Download checkpoints (JSON)
            </button>
          </div>

          {error && <div className="alert error">{error}</div>}

          {result && (
            <>
              <div
                className={`alert ${result.chainValid ? 'success' : 'error'}`}
                role="status"
                style={{ marginBottom: 12 }}
              >
                <strong>{result.chainValid ? '✓ Hash chain valid' : '✕ Hash chain INVALID'}</strong>
                {' — '}
                seq {result.fromSeq}–{result.toSeq} ·{' '}
                {result.checkpoints.length} checkpoint{result.checkpoints.length === 1 ? '' : 's'}
                {typeof result.checkpointsValid === 'boolean' && (
                  <>
                    {' · '}
                    checkpoint signatures {result.checkpointsValid ? 'valid' : 'INVALID'}
                  </>
                )}
                {result.anomalies.length > 0 && (
                  <>
                    {' · '}
                    {result.anomalies.length} anomal{result.anomalies.length === 1 ? 'y' : 'ies'}
                  </>
                )}
              </div>

              {result.anomalies.length > 0 && (
                <div className="card" style={{ borderColor: '#fecaca', background: '#fef2f2', marginBottom: 12 }}>
                  <h2 style={{ fontSize: 16, marginTop: 0 }}>Anomalies</h2>
                  <table style={{ width: '100%', fontSize: 12, fontFamily: 'monospace' }}>
                    <thead>
                      <tr style={{ textAlign: 'left' }}>
                        <th>at seq</th>
                        <th>expected prevHash</th>
                        <th>actual prevHash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.anomalies.map((a) => (
                        <tr key={a.atSeq} style={{ borderTop: '1px solid #fecaca' }}>
                          <td>{a.atSeq}</td>
                          <td style={{ overflowWrap: 'anywhere', paddingRight: 8 }}>{a.expectedPrevHash}</td>
                          <td style={{ overflowWrap: 'anywhere' }}>{a.actualPrevHash}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="card" style={{ marginBottom: 0 }}>
                <h2 style={{ fontSize: 16, marginTop: 0 }}>
                  Checkpoint timeline ({result.checkpoints.length})
                </h2>
                {result.checkpoints.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    No signed checkpoints in this range. The host emits a checkpoint per
                    its configured cadence (typically every <code>capabilities.audit.checkpointInterval</code>{' '}
                    events); short or in-progress runs may not have one yet.
                  </p>
                ) : (
                  <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {result.checkpoints.map((c) => (
                      <li
                        key={c.atSequence}
                        style={{
                          borderTop: '1px solid #e5e7eb',
                          padding: '8px 0',
                          display: 'grid',
                          gridTemplateColumns: '90px 1fr',
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        <span className="muted">seq {c.atSequence}</span>
                        <div>
                          <div style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                            <strong>checkpoint:</strong> {c.checkpoint}
                          </div>
                          <div style={{ fontFamily: 'monospace', overflowWrap: 'anywhere', marginTop: 2 }}>
                            <strong>merkleRoot:</strong> {c.merkleRoot}
                          </div>
                          <div style={{ fontFamily: 'monospace', overflowWrap: 'anywhere', marginTop: 2 }}>
                            <strong>signature:</strong> {c.signature}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}

          {!result && !error && auditProfile === true && (
            <p className="muted" style={{ fontSize: 13 }}>
              {lastSeq === 0 ? 'Loading run events…' : 'Running initial verification…'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
