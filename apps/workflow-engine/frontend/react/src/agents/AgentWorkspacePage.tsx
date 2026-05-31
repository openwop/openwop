/**
 * `/agents/:rosterId` — the agent workspace (PRD §9). One named coworker's
 * home: header (status, heartbeat, actions) + tabs Overview / Workflows /
 * Board / Schedules / Instructions / Integrations / Activity.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { checkAgent, updateRosterEntry } from './rosterClient.js';
import { loadAgentView, statusMeta, type AgentView } from './agentViewModel.js';
import { workflowName } from './roleTemplates.js';
import { AgentBoardPanel } from './AgentBoardPanel.js';
import { AgentWorkflowPortfolioPanel } from './AgentWorkflowPortfolioPanel.js';
import { AgentSchedulesPanel } from './AgentSchedulesPanel.js';
import { AgentInstructionsPanel } from './AgentInstructionsPanel.js';
import { AgentIntegrationsPanel } from './AgentIntegrationsPanel.js';
import { AgentActivityFeed } from './AgentActivityFeed.js';
import { Notice } from '../ui/Notice.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

type TabKey = 'overview' | 'workflows' | 'board' | 'schedules' | 'instructions' | 'integrations' | 'activity';
const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'board', label: 'Board' },
  { key: 'schedules', label: 'Schedules' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'activity', label: 'Activity' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function AgentWorkspacePage(): JSX.Element {
  const { agentId: rosterId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<AgentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!rosterId) return;
    try {
      setView(await loadAgentView(rosterId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [rosterId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = rosterId ? await loadAgentView(rosterId) : null;
        if (!cancelled) setView(v);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rosterId]);

  const onCheckNow = async () => {
    if (!view) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await checkAgent(view.entry.rosterId);
      setNotice(result.picked ? `${view.entry.persona} picked up “${result.cardTitle}” and started a run.` : `No eligible To Do tasks (${result.reason ?? 'idle'}).`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onTogglePause = async () => {
    if (!view) return;
    try {
      await updateRosterEntry(view.entry.rosterId, { enabled: !view.entry.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <section style={{ padding: '1rem' }}><p style={muted}>Loading agent…</p></section>;
  if (!view) {
    return (
      <section style={{ padding: '1rem' }}>
        <p>Agent not found. <Link to="/agents">Back to agents</Link></p>
      </section>
    );
  }

  const { entry } = view;
  const sm = statusMeta(view.status);

  return (
    <section style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <Link to="/agents" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>← All agents</Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', margin: '0.6rem 0 0.4rem', flexWrap: 'wrap' }}>
        <div aria-hidden="true" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-accent)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem' }}>
          {initials(entry.persona)}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0 }}>{entry.persona}</h1>
          <div style={muted}>{entry.label ?? 'Agent'}</div>
        </div>
        <div className="action-bar">
          <span className={`chip ${sm.chip}`}>{sm.label}</span>
          <span className="chip chip--muted">Heartbeat: manual</span>
        </div>
      </div>

      <div className="action-bar" style={{ marginBottom: 'var(--space-3)' }}>
        <button type="button" className="primary" onClick={() => void onCheckNow()} disabled={busy || !entry.enabled}>{busy ? 'Checking…' : 'Check now'}</button>
        <button type="button" className="secondary" onClick={() => setTab('board')}>Add task</button>
        <button type="button" className="secondary" onClick={() => setTab('workflows')}>Run workflow</button>
        <button type="button" className="secondary" onClick={() => void onTogglePause()}>{entry.enabled ? 'Pause' : 'Resume'}</button>
        <button type="button" className="secondary" onClick={() => setTab('instructions')}>Edit instructions</button>
      </div>

      {error ? <Notice variant="error">⚠ {error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              border: 'none',
              background: tab === t.key ? 'var(--color-surface-2)' : 'transparent',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? 'var(--color-text)' : 'var(--color-text-muted)',
              borderTopLeftRadius: 'var(--radius)',
              borderTopRightRadius: 'var(--radius)',
              borderBottom: tab === t.key ? '2px solid var(--color-accent)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab view={view} onGoto={setTab} /> : null}
      {tab === 'workflows' ? <AgentWorkflowPortfolioPanel entry={entry} onChanged={() => void refresh()} /> : null}
      {tab === 'board' ? (view.board ? <AgentBoardPanel boardId={view.board.id} persona={entry.persona} onChanged={() => void refresh()} /> : <NoBoard persona={entry.persona} />) : null}
      {tab === 'schedules' ? <AgentSchedulesPanel entry={entry} /> : null}
      {tab === 'instructions' ? <AgentInstructionsPanel entry={entry} onChanged={() => void refresh()} /> : null}
      {tab === 'integrations' ? <AgentIntegrationsPanel boardId={view.board?.id ?? null} persona={entry.persona} onChanged={() => void refresh()} /> : null}
      {tab === 'activity' ? <AgentActivityFeed views={[view]} /> : null}

      <p style={{ ...muted, fontSize: '0.72rem', marginTop: '1.5rem' }}>
        Advanced: {entry.persona} runs manifest agent <code>{entry.agentRef.agentId}</code> · roster id <code>{entry.rosterId}</code>.
        {' '}<button type="button" className="secondary" style={{ fontSize: '0.7rem' }} onClick={() => navigate('/roster')}>Open raw roster</button>
      </p>
    </section>
  );
}

function NoBoard({ persona }: { persona: string }): JSX.Element {
  return <p style={muted}>{persona} has no task board yet.</p>;
}

function OverviewTab({ view, onGoto }: { view: AgentView; onGoto: (t: TabKey) => void }): JSX.Element {
  const { entry, laneCounts, nextSchedule } = view;
  const card: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.8rem', background: 'var(--color-surface)' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.7rem' }}>
      <div style={card}>
        <strong>What {entry.persona} does</strong>
        <p style={{ fontSize: '0.85rem', marginBottom: 0 }}>{entry.description ?? `${entry.label ?? 'Agent'} — assign a role description in Instructions.`}</p>
      </div>
      <div style={card}>
        <strong>Workflow portfolio</strong>
        <p style={{ fontSize: '0.85rem' }}>{entry.workflows.length === 0 ? 'No workflows yet.' : `${entry.workflows.length} assigned.`}</p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem' }}>
          {entry.workflows.slice(0, 4).map((w) => <li key={w}>{workflowName(w)}</li>)}
        </ul>
        <button type="button" className="secondary" style={{ fontSize: '0.74rem', marginTop: 6 }} onClick={() => onGoto('workflows')}>Manage workflows</button>
      </div>
      <div style={card}>
        <strong>Task board</strong>
        <p style={{ fontSize: '0.85rem', marginBottom: 6 }}>{laneCounts.todo} To Do · {laneCounts.working} Working · {laneCounts.waiting} Waiting · {laneCounts.done} Done</p>
        <button type="button" className="secondary" style={{ fontSize: '0.74rem' }} onClick={() => onGoto('board')}>Open board</button>
      </div>
      <div style={card}>
        <strong>Schedule</strong>
        <p style={{ fontSize: '0.85rem', marginBottom: 6 }}>{nextSchedule ? String(nextSchedule.metadata?.label ?? nextSchedule.cronExpr) : 'No schedule yet.'}</p>
        <button type="button" className="secondary" style={{ fontSize: '0.74rem' }} onClick={() => onGoto('schedules')}>Manage schedules</button>
      </div>
      <div style={{ ...card, gridColumn: '1 / -1' }}>
        <strong>Next steps</strong>
        <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.84rem' }}>
          <li>Add a task to {entry.persona}'s board.</li>
          <li>Assign another workflow from the library.</li>
          <li>Schedule a workflow to run on a timer.</li>
          <li>Connect Discord so teammates can assign {entry.persona} work from chat.</li>
        </ul>
      </div>
    </div>
  );
}
