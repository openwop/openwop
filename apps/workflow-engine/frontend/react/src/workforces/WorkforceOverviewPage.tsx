/**
 * Workforce overview (EP0 §1 / WF-2). One screen for a governed workforce:
 * purpose + policy, the 8 telemetry metrics over the seeded history, and the
 * agent cluster. Two batched reads (workforce + metrics) — no per-run fan-out.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../ui/PageHeader.js';
import { StateCard } from '../ui/StateCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Notice } from '../ui/Notice.js';
import { ArrowLeftIcon, BuildingIcon } from '../ui/icons/index.js';
import { TraceSearchPanel } from './TraceSearchPanel.js';
import {
  getWorkforce,
  getWorkforceGovernance,
  getWorkforceMetrics,
  updateWorkforceStatus,
  type Workforce,
  type WorkforceGovernance,
  type WorkforceMetrics,
  type WorkforceStatus,
} from '../client/workforcesClient.js';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function duration(ms: number | null): string {
  if (ms === null) return '—';
  const h = ms / 3_600_000;
  if (h >= 1) return `${h.toFixed(1)} h`;
  const m = ms / 60_000;
  if (m >= 1) return `${m.toFixed(1)} min`;
  return `${(ms / 1000).toFixed(1)} s`;
}
function usd(n: number | null): string {
  return n === null ? '—' : `$${n.toFixed(4)}`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="surface-card" style={{ minWidth: 0 }}>
      <div className="chip chip--muted" style={{ marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint ? <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{hint}</div> : null}
    </div>
  );
}

export function WorkforceOverviewPage(): JSX.Element {
  const { workforceId = '' } = useParams();
  const [wf, setWf] = useState<Workforce | null>(null);
  const [metrics, setMetrics] = useState<WorkforceMetrics | null>(null);
  const [governance, setGovernance] = useState<WorkforceGovernance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cutoverBusy, setCutoverBusy] = useState(false);
  const [cutoverError, setCutoverError] = useState<string | null>(null);

  async function cutOver(status: WorkforceStatus): Promise<void> {
    setCutoverBusy(true);
    setCutoverError(null);
    try {
      const updated = await updateWorkforceStatus(workforceId, status);
      setWf(updated);
    } catch (e: unknown) {
      setCutoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setCutoverBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Batched reads in parallel — no per-run fan-out (rate-limit safe).
    Promise.all([
      getWorkforce(workforceId),
      getWorkforceMetrics(workforceId).catch(() => null),
      getWorkforceGovernance(workforceId).catch(() => null),
    ])
      .then(([w, m, g]) => {
        if (cancelled) return;
        if (!w) { setNotFound(true); return; }
        setWf(w);
        setMetrics(m);
        setGovernance(g);
        setError(null);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workforceId]);

  const back = <Link to="/workforces" className="chip"><ArrowLeftIcon size={13} /> All workforces</Link>;

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="WORKFORCE" title="Loading…" actions={back} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (notFound) {
    return (
      <div>
        <PageHeader eyebrow="WORKFORCE" title="Not found" actions={back} />
        <StateCard icon={<BuildingIcon />} title="Workforce not found" body={`No workforce "${workforceId}".`} action={back} />
      </div>
    );
  }
  if (error || !wf) {
    return (
      <div>
        <PageHeader eyebrow="WORKFORCE" title="Couldn't load" actions={back} />
        <Notice variant="error">{error ?? 'Unknown error'}</Notice>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="WORKFORCE"
        title={wf.name}
        lede={wf.purpose.statement}
        actions={
          <span className="action-bar" style={{ gap: '0.5rem' }}>
            {back}
            <Link to={`/workforces/${encodeURIComponent(workforceId)}/migrate`} className="btn">Migration journey →</Link>
          </span>
        }
      />

      {/* Purpose & policy */}
      <section className="surface-card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Purpose &amp; policy</h3>
        <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <span className="chip chip--accent">{wf.businessFunction}</span>
          <span className="chip">status: {wf.status}</span>
          <span className="chip">autonomy: {wf.autonomyLevel}</span>
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <strong>Policy tags:</strong>{' '}
          {wf.purpose.policyTags.map((t) => <span key={t} className="chip chip--warning" style={{ marginRight: '0.35rem' }}>{t}</span>)}
        </div>
        <div>
          <strong>Refusal boundaries:</strong>
          <ul style={{ margin: '0.25rem 0 0' }}>
            {wf.purpose.refusalBoundaries.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      </section>

      {/* Telemetry */}
      <h3>Telemetry</h3>
      {metrics && metrics.totalRuns > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <Metric label="RUNS" value={String(metrics.totalRuns)} hint={`${metrics.openApprovals} awaiting approval`} />
          <Metric label="CYCLE TIME P50" value={duration(metrics.cycleTimeP50Ms)} />
          <Metric label="COST / CLEARED" value={usd(metrics.costPerClearedUsd)} />
          <Metric label="ESCALATION RATE" value={pct(metrics.escalationRate)} />
          <Metric label="OVERRIDE RATE" value={pct(metrics.overrideRate)} hint="declines as autonomy graduates" />
          <Metric label="FALSE-POSITIVE" value={pct(metrics.falsePositiveRate)} />
          <Metric label="RECOVERY RATE" value={pct(metrics.recoveryRate)} />
          <Metric label="POLICY VIOLATIONS" value={String(metrics.policyViolations)} />
        </div>
      ) : (
        <StateCard
          icon={<BuildingIcon />}
          title="No run history yet"
          body="Load the demo data (explicit re-seed) to populate weeks of synthetic runs for this workforce."
        />
      )}

      {/* Weekly override trend (the graduation curve) */}
      {metrics && metrics.weekly.length > 1 ? (
        <section className="surface-card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Override rate by week (graduation curve)</h3>
          <div className="action-bar" style={{ gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {metrics.weekly.map((w) => (
              <div key={w.week} style={{ textAlign: 'center' }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: '2.5rem',
                    height: `${Math.max(4, w.overrideRate * 200)}px`,
                    background: 'var(--color-accent)',
                    borderRadius: 'var(--radius)',
                  }}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>wk {w.week + 1}</div>
                <div style={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>{pct(w.overrideRate)}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Governance & graduated autonomy (EP1: WG-5 + GA-5) */}
      {governance ? (
        <section className="surface-card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Governance &amp; autonomy</h3>

          {/* Graduation timeline */}
          <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span className="chip chip--accent">current tier: {governance.autonomy.currentTier ?? '—'}</span>
            {governance.autonomy.nextTier ? (
              <span className={`chip ${governance.autonomy.eligibleForNext ? 'chip--success' : 'chip--muted'}`}>
                {governance.autonomy.eligibleForNext ? 'eligible' : 'not yet'} → {governance.autonomy.nextTier}
                {governance.autonomy.nextThreshold !== null ? ` (override ≤ ${pct(governance.autonomy.nextThreshold)})` : ''}
              </span>
            ) : (
              <span className="chip chip--success">fully graduated — bounded-autonomous</span>
            )}
          </div>
          <ol style={{ margin: '0 0 0.75rem', paddingLeft: '1.1rem' }}>
            {governance.autonomy.milestones.map((m) => (
              <li key={`${m.toTier}-${m.runIndex}`}>
                <strong>{m.fromTier ? `${m.fromTier} → ${m.toTier}` : `started at ${m.toTier}`}</strong>
                {' '}<span style={{ color: 'var(--color-text-muted)' }}>· {new Date(m.atIso).toLocaleDateString()}</span>
                {m.overrideIncidenceBefore !== null && m.unlockThreshold !== null ? (
                  <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {' '}— override incidence had fallen to {pct(m.overrideIncidenceBefore)} (bar: ≤ {pct(m.unlockThreshold)})
                  </span>
                ) : null}
              </li>
            ))}
          </ol>

          {/* Posture */}
          <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span className="chip">{governance.posture.overrides} overrides</span>
            <span className="chip">{governance.posture.escalations} escalations</span>
            <span className="chip">{governance.posture.falsePositives} false-positives</span>
            <span className="chip">{governance.posture.recoveries} recoveries</span>
            <span className="chip chip--warning">{governance.posture.policyViolations} policy violations</span>
          </div>
          {governance.posture.recentEvents.length > 0 ? (
            <details>
              <summary style={{ cursor: 'pointer' }}>Recent governance events ({governance.posture.recentEvents.length})</summary>
              <ul style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                {governance.posture.recentEvents.map((e) => (
                  <li key={e.runId}>
                    <span className={`chip ${e.kind === 'override' ? 'chip--warning' : e.kind === 'false-positive' ? 'chip--danger' : 'chip--muted'}`}>{e.kind}</span>
                    {' '}{e.detail} <span style={{ color: 'var(--color-text-muted)' }}>· {new Date(e.atIso).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* Cut over (MG-6) — production gated on graduation; rollback always allowed */}
          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
            <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>Cut over:</strong>
              <span className="chip chip--accent">now: {wf.status}</span>
              {(['shadow', 'piloting', 'production'] as const)
                .filter((s) => s !== wf.status)
                .map((s) => {
                  const gatedOut = s === 'production' && governance.autonomy.currentTier !== 'auto';
                  return (
                    <button
                      key={s}
                      type="button"
                      className="btn"
                      disabled={cutoverBusy || gatedOut}
                      onClick={() => { void cutOver(s); }}
                      title={gatedOut ? 'Promote to production only after graduating to bounded-autonomous' : undefined}
                    >
                      → {s}
                    </button>
                  );
                })}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
              Production requires graduation to bounded-autonomous; rollback to shadow is always available (kill-switch).
            </div>
            {cutoverError ? <Notice variant="error">{cutoverError}</Notice> : null}
          </div>
        </section>
      ) : null}

      {/* Cross-run trace search (GA-2) */}
      <TraceSearchPanel workforceId={workforceId} />

      {/* Agent cluster */}
      <h3>Agent cluster</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: '0.75rem' }}>
        {wf.agents.map((a) => (
          <div key={a.agentRef} className="surface-card">
            <div className="action-bar" style={{ justifyContent: 'space-between' }}>
              <strong>{a.agentRef}</strong>
              <span className={`chip ${a.role === 'supervisor' ? 'chip--accent' : a.role === 'governance' ? 'chip--warning' : 'chip--muted'}`}>{a.role}</span>
            </div>
            <dl style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
              <div><strong>Autonomy:</strong> {a.autonomyLevel}</div>
              <div><strong>Data:</strong> {a.dataBoundary}</div>
              <div><strong>Decision:</strong> {a.decisionBoundary}</div>
              <div><strong>Recovery:</strong> {a.recoveryBehavior}</div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
