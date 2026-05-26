/**
 * RunOpsPanel — operations surface for a run: audit-log verification
 * (RFC 0009/0010) and debug-bundle download (RFC 0009).
 *
 *  - "Verify integrity" calls the SDK `audit.verify(fromSeq, toSeq)`,
 *    which validates the append-only hash chain and returns signed
 *    checkpoints + any detected anomalies. Gated on the host advertising
 *    the `openwop-audit-log-integrity` auth profile; hidden otherwise.
 *  - "Download debug bundle" GETs `/v1/runs/:id/debug-bundle` (the
 *    production-profile bundle with truncation) and saves it as JSON for
 *    support/triage.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuditVerifyResult, RunEventDoc } from '@openwop/openwop';
import { getSdkClient, getCapabilities } from '../client/runsClient.js';
import { authedHeaders, config, fetchOpts } from '../client/config.js';

interface Props {
  runId: string;
  events: readonly RunEventDoc[];
}

export function RunOpsPanel({ runId, events }: Props) {
  const [auditProfile, setAuditProfile] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Pre-flight the audit profile so we only show Verify when the host
  // actually advertises openwop-audit-log-integrity.
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

  const maxSeq = events.reduce((m, e) => Math.max(m, e.sequence), 0);

  async function onVerify() {
    setVerifying(true);
    setError(null);
    setResult(null);
    try {
      const res = await getSdkClient().audit.verify(0, maxSeq);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  async function onDownloadBundle() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(
        `${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/debug-bundle`,
        fetchOpts({ headers: authedHeaders({ accept: 'application/json' }) }),
      );
      if (!res.ok) throw new Error(`debug-bundle returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-${runId}-debug-bundle.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card">
      <h2>Operations</h2>
      <div className="button-row">
        <button type="button" className="secondary" onClick={onDownloadBundle} disabled={downloading}>
          {downloading ? 'Preparing…' : 'Download debug bundle'}
        </button>
        {auditProfile && (
          <button type="button" className="secondary" onClick={onVerify} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Verify audit integrity'}
          </button>
        )}
        {auditProfile && (
          <Link
            to={`/runs/${runId}/audit`}
            className="secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            title="Full audit-log timeline + checkpoint export"
          >
            View full audit log →
          </Link>
        )}
      </div>
      {auditProfile === false && (
        <p className="muted" style={{ fontSize: 12 }}>
          Host does not advertise the <code>openwop-audit-log-integrity</code> profile; verification unavailable.
        </p>
      )}
      {error && <div className="alert error">{error}</div>}
      {result && (
        <div className="audit-result" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`status-badge ${result.chainValid ? 'completed' : 'failed'}`}>
              {result.chainValid ? 'chain valid' : 'chain INVALID'}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              seq {result.fromSeq}–{result.toSeq} · {result.checkpoints.length} checkpoint(s)
              {result.anomalies.length > 0 && ` · ${result.anomalies.length} anomaly(ies)`}
            </span>
          </div>
          {result.anomalies.length > 0 && (
            <ul style={{ fontSize: 12, marginTop: 6 }}>
              {result.anomalies.map((a) => (
                <li key={a.atSeq}>
                  seq {a.atSeq}: expected <code>{a.expectedPrevHash.slice(0, 12)}…</code>,
                  got <code>{a.actualPrevHash.slice(0, 12)}…</code>
                </li>
              ))}
            </ul>
          )}
          {result.checkpoints.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="muted">Signed checkpoints</summary>
              <ul style={{ fontSize: 11 }}>
                {result.checkpoints.map((c) => (
                  <li key={c.atSequence}>
                    @{c.atSequence} · merkle <code>{c.merkleRoot.slice(0, 16)}…</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
