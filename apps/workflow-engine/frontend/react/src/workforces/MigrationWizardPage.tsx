/**
 * Workflow Migration journey wizard (EP1 MG-0). Walks a company through
 * rebuilding one workflow as a governed Workforce across six stages. RFC-free
 * stages are functional; Shadow & Prove is a marked stub (needs the shadow-run
 * contract); Cut Over reuses the MG-6 graduated-cutover control.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../ui/PageHeader.js';
import { StateCard } from '../ui/StateCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Notice } from '../ui/Notice.js';
import { ArrowLeftIcon, BuildingIcon, CheckIcon } from '../ui/icons/index.js';
import {
  getMigrationJourney,
  getWorkforce,
  getWorkforceGovernance,
  patchMigrationJourney,
  updateWorkforceStatus,
  type MigrationJourney,
  type MigrationStageKey,
  type Workforce,
  type WorkforceGovernance,
  type WorkforceStatus,
} from '../client/workforcesClient.js';

const STAGES: { key: MigrationStageKey; title: string; blurb: string; rfcGated?: boolean }[] = [
  { key: 'target', title: 'Target', blurb: 'Define the future-state workflow and the outcome it must deliver.' },
  { key: 'assess', title: 'Assess', blurb: 'Check the workforce is well-formed enough to migrate.' },
  { key: 'map-data', title: 'Map Data', blurb: 'Declare data sources, sensitivity, and the approval model.' },
  { key: 'map-boundaries', title: 'Map Boundaries', blurb: 'Confirm which steps are auto-safe vs human-review.' },
  { key: 'shadow-prove', title: 'Shadow & Prove', blurb: 'Run alongside the legacy process and compare outputs.', rfcGated: true },
  { key: 'cut-over', title: 'Cut Over', blurb: 'Move production responsibility once the agent has graduated.' },
];

export function MigrationWizardPage(): JSX.Element {
  const { workforceId = '' } = useParams();
  const [wf, setWf] = useState<Workforce | null>(null);
  const [journey, setJourney] = useState<MigrationJourney | null>(null);
  const [governance, setGovernance] = useState<WorkforceGovernance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  // editable form state
  const [target, setTarget] = useState({ workflowId: '', targetOutcome: '' });
  const [dataManifest, setDataManifest] = useState({ dataSources: '', sensitivity: '', approvalModel: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getWorkforce(workforceId),
      getMigrationJourney(workforceId).catch(() => null),
      getWorkforceGovernance(workforceId).catch(() => null),
    ])
      .then(([w, j, g]) => {
        if (cancelled) return;
        setWf(w);
        setJourney(j);
        setGovernance(g);
        if (j?.target) setTarget(j.target);
        else if (w) setTarget({ workflowId: w.workflowCatalog[0] ?? '', targetOutcome: w.purpose.statement });
        if (j?.dataManifest) setDataManifest(j.dataManifest);
        setError(null);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workforceId]);

  async function save(patch: Parameters<typeof patchMigrationJourney>[1], advance = true): Promise<void> {
    setBusy(true);
    setStageError(null);
    try {
      const updated = await patchMigrationJourney(workforceId, patch);
      setJourney(updated);
      if (advance) setActive((a) => Math.min(a + 1, STAGES.length - 1));
    } catch (e: unknown) {
      setStageError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const back = <Link to={`/workforces/${encodeURIComponent(workforceId)}`} className="chip"><ArrowLeftIcon size={13} /> Back to workforce</Link>;

  if (loading) {
    return <div><PageHeader eyebrow="MIGRATION" title="Loading…" actions={back} /><Skeleton height={140} /></div>;
  }
  if (error || !wf || !journey) {
    return (
      <div>
        <PageHeader eyebrow="MIGRATION" title="Couldn't load" actions={back} />
        {!wf && !error ? (
          <StateCard icon={<BuildingIcon />} title="Workforce not found" body={`No workforce "${workforceId}".`} action={back} />
        ) : (
          <Notice variant="error">{error ?? 'Unknown error'}</Notice>
        )}
      </div>
    );
  }

  const stage = STAGES[active]!;
  const status = (k: MigrationStageKey): string => journey.stageStatus[k];
  const markDone = (k: MigrationStageKey, advance = true): Promise<void> => save({ stageStatus: { [k]: 'done' } }, advance);

  return (
    <div>
      <PageHeader
        eyebrow="MIGRATION JOURNEY"
        title={`Migrate: ${wf.name}`}
        lede="Rebuild one workflow as a governed agent workforce — prove it, then take over production."
        actions={back}
      />

      {/* Stepper */}
      <div className="action-bar" style={{ gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {STAGES.map((s, i) => {
          const done = status(s.key) === 'done';
          const cls = i === active ? 'chip chip--accent' : done ? 'chip chip--success' : 'chip chip--muted';
          return (
            <button key={s.key} type="button" className={cls} onClick={() => setActive(i)} style={{ border: 'none', cursor: 'pointer' }}>
              {done ? <CheckIcon size={12} /> : `${i + 1}.`} {s.title}
            </button>
          );
        })}
      </div>

      <section className="surface-card">
        <h3 style={{ marginTop: 0 }}>{active + 1}. {stage.title}</h3>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{stage.blurb}</p>

        {stage.key === 'target' ? (
          <div style={{ display: 'grid', gap: '0.6rem', maxWidth: '40rem' }}>
            <label>Target workflow
              <select value={target.workflowId} onChange={(e) => setTarget({ ...target, workflowId: e.target.value })} style={{ display: 'block', width: '100%' }}>
                {wf.workflowCatalog.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label>Target outcome
              <textarea value={target.targetOutcome} onChange={(e) => setTarget({ ...target, targetOutcome: e.target.value })} rows={2} style={{ display: 'block', width: '100%' }} />
            </label>
            <div className="action-bar">
              <button type="button" className="btn" disabled={busy || !target.workflowId} onClick={() => void save({ target, stageStatus: { target: 'done' } })}>Save &amp; continue</button>
            </div>
          </div>
        ) : null}

        {stage.key === 'assess' ? (
          <div>
            <ul style={{ margin: '0 0 0.75rem', listStyle: 'none', paddingLeft: 0 }}>
              {[
                ['Has a supervisor agent', wf.agents.some((a) => a.role === 'supervisor')],
                ['Has worker agents', wf.agents.some((a) => a.role === 'worker')],
                ['Has a governance/eval agent', wf.agents.some((a) => a.role === 'governance')],
                ['Decision boundaries defined', wf.decisionBoundaries.auto.length + wf.decisionBoundaries.review.length > 0],
                ['Purpose + policy tags defined', Boolean(wf.purpose.statement) && wf.purpose.policyTags.length > 0],
              ].map(([label, ok]) => (
                <li key={String(label)}>
                  <span className={`chip ${ok ? 'chip--success' : 'chip--danger'}`}>{ok ? 'ready' : 'missing'}</span> {label}
                </li>
              ))}
            </ul>
            <button type="button" className="btn" disabled={busy} onClick={() => void markDone('assess')}>Mark assessed &amp; continue</button>
          </div>
        ) : null}

        {stage.key === 'map-data' ? (
          <div style={{ display: 'grid', gap: '0.6rem', maxWidth: '40rem' }}>
            <label>Data sources<input value={dataManifest.dataSources} onChange={(e) => setDataManifest({ ...dataManifest, dataSources: e.target.value })} placeholder="ERP, invoice inbox" style={{ display: 'block', width: '100%' }} /></label>
            <label>Sensitivity<input value={dataManifest.sensitivity} onChange={(e) => setDataManifest({ ...dataManifest, sensitivity: e.target.value })} placeholder="financial PII" style={{ display: 'block', width: '100%' }} /></label>
            <label>Approval model<input value={dataManifest.approvalModel} onChange={(e) => setDataManifest({ ...dataManifest, approvalModel: e.target.value })} placeholder=">$5k → human" style={{ display: 'block', width: '100%' }} /></label>
            <div className="action-bar">
              <button type="button" className="btn" disabled={busy} onClick={() => void save({ dataManifest, stageStatus: { 'map-data': 'done' } })}>Save &amp; continue</button>
            </div>
          </div>
        ) : null}

        {stage.key === 'map-boundaries' ? (
          <div>
            <p>These node boundaries determine where approval gates sit:</p>
            <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {wf.decisionBoundaries.auto.map((n) => <span key={n} className="chip chip--success">auto: {n}</span>)}
              {wf.decisionBoundaries.review.map((n) => <span key={n} className="chip chip--warning">review: {n}</span>)}
            </div>
            <button type="button" className="btn" disabled={busy} onClick={() => void save({ boundaries: wf.decisionBoundaries, stageStatus: { 'map-boundaries': 'done' } })}>Confirm boundaries &amp; continue</button>
          </div>
        ) : null}

        {stage.key === 'shadow-prove' ? (
          <div>
            <Notice variant="info">
              Shadow mode runs the agentic workflow alongside the legacy process and compares outputs to prove it before cut-over.
              It depends on the shadow-run contract (a spec RFC) and isn't available yet — this stage is a placeholder.
            </Notice>
            <button type="button" className="btn" disabled={busy} onClick={() => void markDone('shadow-prove')} style={{ marginTop: '0.5rem' }}>Acknowledge &amp; continue</button>
          </div>
        ) : null}

        {stage.key === 'cut-over' ? (
          <div>
            <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="chip chip--accent">now: {wf.status}</span>
              {(['shadow', 'piloting', 'production'] as const).filter((s) => s !== wf.status).map((s) => {
                const gatedOut = s === 'production' && governance?.autonomy.currentTier !== 'auto';
                return (
                  <button
                    key={s}
                    type="button"
                    className="btn"
                    disabled={busy || gatedOut}
                    title={gatedOut ? 'Promote to production only after graduating to bounded-autonomous' : undefined}
                    onClick={() => {
                      setBusy(true); setStageError(null);
                      updateWorkforceStatus(workforceId, s as WorkforceStatus)
                        .then((u) => { setWf(u); if (u.status === 'production') void markDone('cut-over', false); })
                        .catch((e: unknown) => setStageError(e instanceof Error ? e.message : String(e)))
                        .finally(() => setBusy(false));
                    }}
                  >→ {s}</button>
                );
              })}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              Production requires graduation to bounded-autonomous; rollback to shadow is always available (kill-switch).
            </div>
          </div>
        ) : null}

        {stageError ? <Notice variant="error">{stageError}</Notice> : null}

        <div className="action-bar" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
          <button type="button" className="btn" disabled={active === 0} onClick={() => setActive((a) => Math.max(a - 1, 0))}>← Back</button>
          <button type="button" className="btn" disabled={active === STAGES.length - 1} onClick={() => setActive((a) => Math.min(a + 1, STAGES.length - 1))}>Skip →</button>
        </div>
      </section>
    </div>
  );
}
