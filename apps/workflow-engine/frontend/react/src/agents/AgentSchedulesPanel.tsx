/**
 * Agent schedules panel (PRD §9 Schedules + §13) — agent-owned scheduled
 * workflows. List, enable/disable, run now, delete, and create from a cadence
 * preset. Backed by the durable scheduler (host/schedulingService.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CADENCE_PRESETS, createJob, deleteJob, listJobs, setJobEnabled, triggerJob, type ScheduledJob } from './scheduleClient.js';
import { workflowName } from './roleTemplates.js';
import type { RosterEntry } from './rosterClient.js';
import { Notice } from '../ui/Notice.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentSchedulesPanel({ entry }: { entry: RosterEntry }): JSX.Element {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wfId, setWfId] = useState(entry.workflows[0] ?? '');
  const [cadence, setCadence] = useState(CADENCE_PRESETS[0]!.key);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs(entry.rosterId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [entry.rosterId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onCreate = async () => {
    if (!wfId) return;
    setError(null);
    const preset = CADENCE_PRESETS.find((p) => p.key === cadence)!;
    try {
      await createJob({
        cronExpr: preset.cronExpr,
        workflowId: wfId,
        rosterId: entry.rosterId,
        agentId: entry.agentRef.agentId,
        metadata: { label: `${workflowName(wfId)} · ${preset.label}` },
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onToggle = async (job: ScheduledJob) => {
    try { await setJobEnabled(job.jobId, !job.enabled); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const onRunNow = async (job: ScheduledJob) => {
    setNotice(null);
    try {
      const res = await triggerJob(job.jobId);
      setNotice(res.runId ? `Fired — run ${res.runId}.` : 'Fired (no workflow bound).');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const onDelete = async (job: ScheduledJob) => {
    const label = String(job.metadata?.label ?? (job.workflowId ? workflowName(job.workflowId) : job.cronExpr));
    if (!window.confirm(`Delete the schedule “${label}”? This can't be undone.`)) return;
    try { await deleteJob(job.jobId); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice} <Link to="/runs">View runs</Link></Notice> : null}

      {jobs.length === 0 ? (
        <p style={muted}>No schedules yet. Create one below so {entry.persona} runs a workflow on a timer.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
          {jobs.map((job) => (
            <li key={job.jobId} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.6rem 0.7rem', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{job.workflowId ? workflowName(job.workflowId) : 'No workflow'}</div>
                <div style={{ ...muted, fontSize: '0.78rem' }}>
                  {String(job.metadata?.label ?? job.cronExpr)}{job.enabled ? '' : ' · disabled'}
                  {job.lastRunId ? <> · last run <Link to={`/runs/${job.lastRunId}`}>{job.lastRunId.slice(0, 8)}</Link></> : ' · not run yet'}
                </div>
              </div>
              <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={job.enabled} onChange={() => void onToggle(job)} /> Enabled
              </label>
              <button type="button" className="secondary" style={{ fontSize: '0.74rem' }} onClick={() => void onRunNow(job)}>Run now</button>
              <button type="button" className="secondary" style={{ fontSize: '0.74rem' }} onClick={() => void onDelete(job)}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.7rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Create a schedule</strong>
        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={wfId} onChange={(e) => setWfId(e.target.value)} aria-label="Workflow" style={{ minWidth: 200 }}>
            {entry.workflows.length === 0 ? <option value="">Assign a workflow first</option> : null}
            {entry.workflows.map((w) => <option key={w} value={w}>{workflowName(w)}</option>)}
          </select>
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} aria-label="Cadence">
            {CADENCE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button type="button" className="primary" disabled={!wfId} onClick={() => void onCreate()}>Create schedule</button>
        </div>
      </div>
    </div>
  );
}
