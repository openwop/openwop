import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { DataTable, DensityToggle, type DataColumn } from '../ui/DataTable.js';
import { SkeletonRows } from '../ui/Skeleton.js';
import { toast } from '../ui/toast.js';
import { createRun, listMyRuns, type RunListItem } from '../client/runsClient.js';
import { classifyHttpError } from '../client/classifyHttpError.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import type { Annotation } from '../client/feedbackClient.js';
import { useRunAnnotations, reviewOf, needsReview, reviewReason } from './useRunAnnotations.js';
import { formatDuration } from './format.js';
import { listSavedWorkflows } from '../builder/persistence/localStore.js';
import { serializeWorkflow, SerializeError } from '../builder/schema/serialize.js';
import { registerWorkflow } from '../builder/persistence/registerClient.js';
import { useAuth } from '../auth/useAuth.js';
import { PageHeader } from '../ui/PageHeader.js';
import { FlagIcon } from '../ui/icons/index.js';

const SAMPLE_WORKFLOWS = [
  { id: 'sample.demo.uppercase', label: 'sample.demo.uppercase — single-node uppercase' },
  { id: 'sample.demo.approval-gate', label: 'sample.demo.approval-gate — uppercase gated by an approval interrupt' },
];

export function RunsIndexPage() {
  const nav = useNavigate();
  const { user, isConfigured } = useAuth();
  const savedWorkflows = useMemo(() => listSavedWorkflows(), []);
  const allOptions = useMemo(
    () => [
      ...SAMPLE_WORKFLOWS,
      ...savedWorkflows.map((wf) => ({ id: wf.id, label: `${wf.name} — ${wf.nodes.length} nodes (saved in builder)` })),
    ],
    [savedWorkflows],
  );
  const [workflowId, setWorkflowId] = useState(allOptions[0]?.id ?? 'sample.demo.uppercase');
  const [inputsRaw, setInputsRaw] = useState(JSON.stringify({ text: 'hello world' }, null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  // §C3 — annotation-driven review queue. One capability-gated fan-out shared
  // by the flagged filter (here) and the §C2 quality rollup (RunsSummary).
  const runIds = useMemo(() => runs.map((r) => r.runId), [runs]);
  const { byRun, feedbackOn } = useRunAnnotations(runIds);
  const [reviewOnly, setReviewOnly] = useState(false);
  const isFlagged = useCallback(
    (runId: string) => needsReview(reviewOf(byRun.get(runId) ?? [])),
    [byRun],
  );
  const flaggedCount = useMemo(
    () => runs.filter((r) => isFlagged(r.runId)).length,
    [runs, isFlagged],
  );
  const reviewFiltered = reviewOnly ? runs.filter((r) => isFlagged(r.runId)) : runs;
  // Free-text filter, persisted in the URL (?q=) so a filtered view is
  // shareable + survives reload (gap analysis #4). Matches run id or workflow.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const setQuery = useCallback((q: string) => {
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q); else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const visibleRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reviewFiltered;
    return reviewFiltered.filter((r) => r.runId.toLowerCase().includes(q) || r.workflowId.toLowerCase().includes(q));
  }, [reviewFiltered, query]);
  // Row density (comfortable/compact), persisted per-user (gap analysis #5).
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    try { return localStorage.getItem('openwop.runs.density') === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; }
  });
  useEffect(() => { try { localStorage.setItem('openwop.runs.density', density); } catch { /* ignore */ } }, [density]);

  async function refreshRuns() {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const list = await listMyRuns({ limit: 20 });
      setRuns(list);
    } catch (err) {
      // Friendly transport copy (GAP-ANALYSIS E5) — a busy page hitting the
      // per-IP budget shows "Too many requests, retry" instead of a raw
      // "listMyRuns failed: 429".
      const c = classifyHttpError(err);
      setRunsError(`${c.title} — ${c.detail}`);
    } finally {
      setRunsLoading(false);
    }
  }

  useEffect(() => {
    void refreshRuns();
    // Refresh whenever sign-in state flips so the user sees their
    // new tenant's runs after migration.
  }, [user?.uid]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const inputs = JSON.parse(inputsRaw);
      // Builder-saved workflows need to be registered with the backend's
      // in-memory catalog before POST /v1/runs can resolve them.
      const saved = savedWorkflows.find((w) => w.id === workflowId);
      if (saved) {
        const def = serializeWorkflow(saved);
        await registerWorkflow(def);
      }
      // Tenant is no longer carried in the request body — the backend
      // derives it from the authenticated principal (cookie or OIDC).
      // Sending an empty string still satisfies the schema; the auth
      // middleware overrides it with the principal's tenant.
      const res = await createRun({ workflowId, tenantId: '', inputs });
      void refreshRuns();
      toast.success(`Run created — streaming ${res.runId.slice(0, 8)}…`);
      nav(`/runs/${res.runId}`);
    } catch (err) {
      if (err instanceof SerializeError) {
        setError(`Saved workflow is not runnable: ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const tenantScope = isConfigured && user
    ? `Signed in as ${user.displayName ?? user.email ?? user.uid}`
    : 'Anonymous session (24h lifetime)';

  const runColumns = useMemo<DataColumn<RunListItem>[]>(() => [
    {
      key: 'run',
      header: 'Run',
      render: (r) => (
        <>
          <Link to={`/runs/${r.runId}`} onClick={(e) => e.stopPropagation()}><code>{r.runId.slice(0, 8)}…</code></Link>
          {isFlagged(r.runId) && (
            <span
              className="status-badge status-error runs-review-flag"
              title={`Flagged for review: ${reviewReason(reviewOf(byRun.get(r.runId) ?? []))}`}
            >
              <FlagIcon size={10} /> review
            </span>
          )}
        </>
      ),
    },
    { key: 'workflow', header: 'Workflow', render: (r) => r.workflowId, sortValue: (r) => r.workflowId },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    {
      key: 'started',
      header: 'Started',
      cellClassName: 'muted',
      render: (r) => (r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'),
      sortValue: (r) => (r.startedAt ? Date.parse(r.startedAt) : 0),
    },
  ], [isFlagged, byRun]);

  return (
    <section>
      <PageHeader
        eyebrow="Runs"
        title="Runs"
        lede="Submit a workflow on the live sample host, then watch it stream — status, events, and outputs land in real time."
      />
      <div className="card">
        <h2>Create a run</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {tenantScope}
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label>Workflow</label>
            <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
              {allOptions.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>Inputs (JSON)</label>
            <textarea
              rows={6}
              value={inputsRaw}
              onChange={(e) => setInputsRaw(e.target.value)}
              spellCheck={false}
            />
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="button-row">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create run'}
            </button>
          </div>
        </form>
      </div>

      <RunsSummary runs={runs} annotationsByRun={byRun} />

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{reviewOnly ? 'Flagged for review' : 'Recent runs'}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* §C3 — flagged review queue. Only offered when the host advertises
                feedback; mirrors the inbox tab pattern. */}
            {feedbackOn && (
              <div className="segmented" role="group" aria-label="Filter runs">
                <button type="button" aria-pressed={!reviewOnly} onClick={() => setReviewOnly(false)}>
                  All
                </button>
                <button type="button" aria-pressed={reviewOnly} onClick={() => setReviewOnly(true)} title="Runs flagged, low-rated, or corrected">
                  <FlagIcon size={13} /> Flagged{flaggedCount > 0 ? ` (${flaggedCount})` : ''}
                </button>
              </div>
            )}
            <input
              type="search"
              className="ui-input runs-filter"
              placeholder="Filter by run id or workflow…"
              aria-label="Filter runs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <DensityToggle value={density} onChange={setDensity} />
            <button type="button" className="secondary" onClick={refreshRuns} disabled={runsLoading}>
              {runsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {runsError ? <div className="alert error">{runsError}</div> : null}
        <DataTable
          rows={visibleRuns}
          rowKey={(r) => r.runId}
          onRowClick={(r) => nav(`/runs/${r.runId}`)}
          density={density}
          caption="Recent runs"
          initialSort={{ key: 'started', dir: 'desc' }}
          columns={runColumns}
          empty={
            runsLoading ? (
              <SkeletonRows rows={4} columns={[90, 180, 80, 150]} />
            ) : (
              <p className="muted">
                {runs.length === 0
                  ? 'No runs yet. Create one above to get started.'
                  : reviewOnly
                    ? 'No runs flagged for review. Thumbs-down, flag, or correct a run to add it here.'
                    : 'No runs match this filter.'}
              </p>
            )
          }
        />
      </div>

      <div className="card">
        <h2>About this sample</h2>
        <p className="muted">
          The two seeded workflows are defined in the backend's <code>workflowCatalog</code>
          (<code>src/host/index.ts</code>). The first runs end-to-end without HITL; the
          second pauses at an approval gate so you can exercise the interrupt-resolution UI.
        </p>
      </div>
    </section>
  );
}

interface QualityRollup {
  runsAnnotated: number;
  meanRating: number | null;
  correctionRate: number; // fraction of runs with ≥1 correction
  flagRate: number; // fraction of runs with ≥1 flag
  topCorrected: Array<[string, number]>;
}

/**
 * §A2 tenant rollup — outcome distribution + mean completed-run duration
 * over the runs already in hand. §C2 adds the *quality* dimension (mean
 * rating, correction/flag rate, most-corrected nodes) over the shared
 * annotation map fetched once by `useRunAnnotations` — empty (so the quality
 * block is hidden) against a host that doesn't advertise feedback.
 */
function RunsSummary({
  runs,
  annotationsByRun,
}: {
  runs: RunListItem[];
  annotationsByRun: Map<string, readonly Annotation[]>;
}) {
  // §C2 — quality rollup derived from the shared annotation map.
  const quality = useMemo<QualityRollup | null>(() => {
    if (runs.length === 0) return null;
    const ratings: number[] = [];
    let runsAnnotated = 0;
    let runsCorrected = 0;
    let runsFlagged = 0;
    const correctedNodes = new Map<string, number>();
    for (const r of runs) {
      const anns = annotationsByRun.get(r.runId) ?? [];
      if (anns.length > 0) runsAnnotated += 1;
      let hasCorrection = false;
      let hasFlag = false;
      for (const a of anns) {
        if (a.signal.kind === 'rating' && typeof a.signal.rating === 'number') {
          ratings.push(a.signal.rating);
        } else if (a.signal.kind === 'correction') {
          hasCorrection = true;
          if (a.target.nodeId) correctedNodes.set(a.target.nodeId, (correctedNodes.get(a.target.nodeId) ?? 0) + 1);
        } else if (a.signal.kind === 'flag') {
          hasFlag = true;
        }
      }
      if (hasCorrection) runsCorrected += 1;
      if (hasFlag) runsFlagged += 1;
    }
    if (runsAnnotated === 0) return null;
    return {
      runsAnnotated,
      meanRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      correctionRate: runsCorrected / runs.length,
      flagRate: runsFlagged / runs.length,
      topCorrected: [...correctedNodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [runs, annotationsByRun]);

  const s = useMemo(() => {
    if (runs.length === 0) return null;
    const total = runs.length;
    const n = (pred: (st: string) => boolean) => runs.filter((r) => pred(r.status)).length;
    const durations = runs
      .flatMap((r) =>
        r.status === 'completed' && r.startedAt && r.completedAt
          ? [Date.parse(r.completedAt) - Date.parse(r.startedAt)]
          : [],
      )
      .filter((d) => Number.isFinite(d) && d >= 0);
    const meanMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    return {
      total,
      completed: n((x) => x === 'completed'),
      failed: n((x) => x === 'failed'),
      cancelled: n((x) => x === 'cancelled'),
      awaiting: n((x) => x.startsWith('waiting') || x === 'suspended' || x === 'paused'),
      meanMs,
    };
  }, [runs]);

  if (!s) return null;
  const pct = (count: number) => `${Math.round((count / s.total) * 100)}%`;
  const pctFrac = (frac: number) => `${Math.round(frac * 100)}%`;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>
        Summary <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· last {s.total} runs</span>
      </h2>
      <dl className="run-stats">
        <div className="run-stat">
          <dt className="run-stat-label">Completed</dt>
          <dd className="run-stat-value">{pct(s.completed)}</dd>
        </div>
        <div className={`run-stat${s.failed > 0 ? ' run-stat--danger' : ''}`}>
          <dt className="run-stat-label">Failed</dt>
          <dd className="run-stat-value">{s.failed}</dd>
        </div>
        <div className="run-stat">
          <dt className="run-stat-label">Cancelled</dt>
          <dd className="run-stat-value">{s.cancelled}</dd>
        </div>
        <div className={`run-stat${s.awaiting > 0 ? ' run-stat--warn' : ''}`}>
          <dt className="run-stat-label">Awaiting input</dt>
          <dd className="run-stat-value">{s.awaiting}</dd>
        </div>
        <div className="run-stat">
          <dt className="run-stat-label">Mean duration</dt>
          <dd className="run-stat-value">{s.meanMs == null ? '—' : formatDuration(s.meanMs)}</dd>
        </div>
      </dl>
      {quality && (
        <>
          <h3 style={{ margin: '12px 0 6px', fontSize: 13 }}>
            Quality <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>· {quality.runsAnnotated} of {s.total} runs annotated</span>
          </h3>
          <dl className="run-stats">
            <div className="run-stat">
              <dt className="run-stat-label">Mean rating</dt>
              <dd className="run-stat-value">{quality.meanRating == null ? '—' : `${quality.meanRating.toFixed(1)} / 5`}</dd>
            </div>
            <div className={`run-stat${quality.correctionRate > 0 ? ' run-stat--warn' : ''}`}>
              <dt className="run-stat-label">Correction rate</dt>
              <dd className="run-stat-value">{pctFrac(quality.correctionRate)}</dd>
            </div>
            <div className={`run-stat${quality.flagRate > 0 ? ' run-stat--danger' : ''}`}>
              <dt className="run-stat-label">Flag rate</dt>
              <dd className="run-stat-value">{pctFrac(quality.flagRate)}</dd>
            </div>
          </dl>
          {quality.topCorrected.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Most-corrected nodes</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {quality.topCorrected.map(([nodeId, n]) => (
                  <li key={nodeId}><code>{nodeId}</code> — {n} correction{n === 1 ? '' : 's'}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
