/**
 * Agent workflow portfolio panel (PRD §9 Workflows tab) — the workflows this
 * agent is responsible for, shown as business-friendly cards (no raw ids in
 * the primary surface). Each card shows its REAL trigger state (manual / on a
 * schedule / on the board's trigger lane), assign from the library, run now
 * (with a linked run), or unassign. Warns when a workflow is local-only.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { updateRosterEntry, type RosterEntry } from './rosterClient.js';
import { createRun } from '../client/runsClient.js';
import { ALL_WORKFLOW_OPTIONS, isKnownWorkflow, workflowName, workflowPurpose } from './roleTemplates.js';
import { Notice } from '../ui/Notice.js';
import { AlertIcon, PlayIcon } from '../ui/icons/index.js';
import type { ScheduledJob } from './scheduleClient.js';
import type { KanbanBoard } from '../kanban/kanbanClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentWorkflowPortfolioPanel({
  entry,
  jobs = [],
  board,
  onChanged,
}: {
  entry: RosterEntry;
  jobs?: ScheduledJob[];
  board?: KanbanBoard | null;
  onChanged: () => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ workflowId: string; runId: string } | null>(null);
  const [assignId, setAssignId] = useState('');

  const scheduledWorkflowIds = new Set(jobs.filter((j) => j.enabled !== false).map((j) => j.workflowId));
  const boardTriggerWorkflowIds = new Set((board?.columns ?? []).map((c) => c.triggerWorkflowId).filter(Boolean) as string[]);

  const setWorkflows = async (workflows: string[]) => {
    try {
      await updateRosterEntry(entry.rosterId, { workflows });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRunNow = async (workflowId: string) => {
    setRunning(workflowId);
    setError(null);
    setLastRun(null);
    try {
      const res = await createRun({ workflowId, metadata: { manual: { rosterId: entry.rosterId, persona: entry.persona } } });
      setLastRun({ workflowId, runId: res.runId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  const assignable = ALL_WORKFLOW_OPTIONS.filter((w) => !entry.workflows.includes(w.workflowId));

  return (
    <div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {lastRun ? (
        <Notice variant="success">
          Started {workflowName(lastRun.workflowId)} ·{' '}
          <Link to={`/runs/${lastRun.runId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <PlayIcon size={12} /> View run
          </Link>
        </Notice>
      ) : null}

      {entry.workflows.length === 0 ? (
        <p style={muted}>No workflows assigned yet. Assign one from the library below so {entry.persona} has work to do.</p>
      ) : (
        <>
        <p style={{ ...muted, fontSize: '13px', marginTop: 0 }}>
          These workflows make up {entry.persona}'s <strong>{entry.label ?? 'role'}</strong> portfolio — the work this
          role owns. Each card explains what it does and how it's triggered.
        </p>
        <div className="card-grid" style={{ marginBottom: 'var(--space-4)' }}>
          {entry.workflows.map((wfId) => {
            const known = isKnownWorkflow(wfId);
            const triggers: string[] = ['Manual'];
            if (boardTriggerWorkflowIds.has(wfId)) triggers.unshift('Task board');
            if (scheduledWorkflowIds.has(wfId)) triggers.unshift('Schedule');
            return (
              <div key={wfId} className="surface-card">
                <div style={{ fontWeight: 600 }}>{workflowName(wfId)}</div>
                <div style={{ ...muted, fontSize: '13px', minHeight: 30 }}>{workflowPurpose(wfId) ?? (known ? '' : 'Local workflow — assigned to this agent.')}</div>
                {!known ? (
                  <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center', fontSize: '12px', color: 'var(--color-warning-text)' }}>
                    <AlertIcon size={13} /> Local-only — register on the host before it can run from a board or schedule.
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                  {triggers.map((t) => (
                    <span key={t} className={`chip ${t === 'Schedule' ? 'chip--warning' : t === 'Task board' ? 'chip--accent' : 'chip--muted'}`}>{t}</span>
                  ))}
                </div>
                <div className="action-bar">
                  <button type="button" className="primary btn-sm" disabled={!known || running === wfId} onClick={() => void onRunNow(wfId)}>
                    {running === wfId ? 'Running…' : 'Run now'}
                  </button>
                  <button type="button" className="secondary btn-sm" onClick={() => void setWorkflows(entry.workflows.filter((w) => w !== wfId))}>
                    Unassign
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
        <strong style={{ fontSize: '14px' }}>Assign a workflow</strong>
        <div className="action-bar" style={{ marginTop: 'var(--space-2)' }}>
          <select className="ui-input" value={assignId} onChange={(e) => setAssignId(e.target.value)} aria-label="Workflow to assign" style={{ minWidth: 240 }}>
            <option value="">Choose a workflow from the library…</option>
            {assignable.map((w) => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)}
          </select>
          <button type="button" className="primary" disabled={!assignId} onClick={() => { void setWorkflows([...entry.workflows, assignId]); setAssignId(''); }}>
            Assign workflow
          </button>
          <Link to="/builder" style={{ alignSelf: 'center', fontSize: '13px' }}>Create from template</Link>
        </div>
      </div>
    </div>
  );
}
