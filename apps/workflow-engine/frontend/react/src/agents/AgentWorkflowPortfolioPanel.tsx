/**
 * Agent workflow portfolio panel (PRD §9 Workflows tab) — the workflows this
 * agent is responsible for, shown as business-friendly cards (no raw ids in
 * the primary surface). Assign from the built-in library, run now, or unassign.
 * Warns when an assigned workflow is local-only / unregistered (PRD §12, §22.1).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { updateRosterEntry, type RosterEntry } from './rosterClient.js';
import { createRun } from '../client/runsClient.js';
import { ALL_WORKFLOW_OPTIONS, isKnownWorkflow, workflowName, workflowPurpose } from './roleTemplates.js';
import { Notice } from '../ui/Notice.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentWorkflowPortfolioPanel({ entry, onChanged }: { entry: RosterEntry; onChanged: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [assignId, setAssignId] = useState('');

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
    setNotice(null);
    try {
      const res = await createRun({ workflowId, metadata: { manual: { rosterId: entry.rosterId, persona: entry.persona } } });
      setNotice(`Started ${workflowName(workflowId)} — run ${res.runId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  const assignable = ALL_WORKFLOW_OPTIONS.filter((w) => !entry.workflows.includes(w.workflowId));

  return (
    <div>
      {error ? <Notice variant="error">⚠ {error}</Notice> : null}
      {notice ? <Notice variant="success">{notice} <Link to="/runs">View runs</Link></Notice> : null}

      {entry.workflows.length === 0 ? (
        <p style={muted}>No workflows assigned yet. Assign one from the library below so {entry.persona} has work to do.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
          {entry.workflows.map((wfId) => {
            const known = isKnownWorkflow(wfId);
            return (
              <div key={wfId} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.7rem', background: 'var(--color-surface)' }}>
                <div style={{ fontWeight: 600 }}>{workflowName(wfId)}</div>
                <div style={{ ...muted, fontSize: '0.8rem', minHeight: 32 }}>{workflowPurpose(wfId) ?? (known ? '' : 'Local workflow — assigned to this agent.')}</div>
                {!known ? (
                  <div style={{ fontSize: '0.72rem', color: '#9a5b12', marginBottom: 4 }}>
                    ⚠ Local-only — register this workflow on the host before it can run from a board or schedule.
                  </div>
                ) : null}
                <div style={{ ...muted, fontSize: '0.72rem', marginBottom: 6 }}>Runs on: task arrival · schedule · manual</div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" className="primary" style={{ fontSize: '0.75rem' }} disabled={!known || running === wfId} onClick={() => void onRunNow(wfId)}>
                    {running === wfId ? 'Running…' : 'Run now'}
                  </button>
                  <button type="button" className="secondary" style={{ fontSize: '0.75rem' }} onClick={() => void setWorkflows(entry.workflows.filter((w) => w !== wfId))}>
                    Unassign
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.7rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Assign a workflow</strong>
        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
          <select value={assignId} onChange={(e) => setAssignId(e.target.value)} aria-label="Workflow to assign" style={{ minWidth: 240 }}>
            <option value="">Choose a workflow from the library…</option>
            {assignable.map((w) => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)}
          </select>
          <button type="button" className="primary" disabled={!assignId} onClick={() => { void setWorkflows([...entry.workflows, assignId]); setAssignId(''); }}>
            Assign workflow
          </button>
          <Link to="/builder" style={{ alignSelf: 'center', fontSize: '0.8rem' }}>Create from template →</Link>
        </div>
      </div>
    </div>
  );
}
