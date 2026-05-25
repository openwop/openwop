import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createRun, listMyRuns, type RunListItem } from '../client/runsClient.js';
import { getFeedbackCapability, listAnnotations } from '../client/feedbackClient.js';
import { formatDuration } from './format.js';
import { listSavedWorkflows } from '../builder/persistence/localStore.js';
import { serializeWorkflow, SerializeError } from '../builder/schema/serialize.js';
import { registerWorkflow } from '../builder/persistence/registerClient.js';
import { useAuth } from '../auth/useAuth.js';

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

  async function refreshRuns() {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const list = await listMyRuns({ limit: 20 });
      setRuns(list);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : String(err));
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

  return (
    <section>
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

      <RunsSummary runs={runs} />

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Recent runs</h2>
          <button
            type="button"
            className="button-secondary"
            onClick={refreshRuns}
            disabled={runsLoading}
          >
            {runsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {runsError ? <div className="alert error">{runsError}</div> : null}
        {!runsLoading && runs.length === 0 ? (
          <p className="muted">No runs yet. Create one above to get started.</p>
        ) : (
          <div className="table-scroll">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.runId}
                    onClick={() => nav(`/runs/${r.runId}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* The run id is a real link so the row is keyboard-
                        navigable (tab + Enter); the row onClick stays for
                        mouse convenience and targets the same route. */}
                    <td><Link to={`/runs/${r.runId}`} onClick={(e) => e.stopPropagation()}><code>{r.runId.slice(0, 8)}…</code></Link></td>
                    <td>{r.workflowId}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="muted">{r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'completed' ? 'success'
      : status === 'failed' || status === 'cancelled' ? 'error'
        : status === 'running' || status === 'waiting' ? 'in-progress'
          : 'muted';
  return <span className={`status-badge status-${tone}`}>{status}</span>;
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
 * over the runs already in hand (no extra fetch). §C2 adds the *quality*
 * dimension (mean rating, correction/flag rate, most-corrected nodes) by
 * fanning out one `GET /v1/runs/{id}/annotations` per listed run — gated on
 * `capabilities.feedback`, so it's a no-op against a host without feedback.
 */
function RunsSummary({ runs }: { runs: RunListItem[] }) {
  // §C2 — bounded annotation aggregation across the runs already listed.
  const [quality, setQuality] = useState<QualityRollup | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cap = await getFeedbackCapability();
      if (cancelled || !cap || runs.length === 0) {
        if (!cancelled) setQuality(null);
        return;
      }
      const lists = await Promise.all(runs.map((r) => listAnnotations(r.runId)));
      if (cancelled) return;
      const ratings: number[] = [];
      let runsAnnotated = 0;
      let runsCorrected = 0;
      let runsFlagged = 0;
      const correctedNodes = new Map<string, number>();
      for (const anns of lists) {
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
      if (runsAnnotated === 0) {
        setQuality(null);
        return;
      }
      setQuality({
        runsAnnotated,
        meanRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        correctionRate: runsCorrected / runs.length,
        flagRate: runsFlagged / runs.length,
        topCorrected: [...correctedNodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [runs]);

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
