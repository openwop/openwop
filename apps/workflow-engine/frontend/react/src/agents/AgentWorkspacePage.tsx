/**
 * `/agents/:rosterId` — the agent workspace (PRD §9). One named coworker's
 * home: header (status, heartbeat, actions) + tabs Overview / Workflows /
 * Board / Schedules / Instructions / Integrations / Activity.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { checkAgent, updateRosterEntry } from './rosterClient.js';
import { loadAgentView, statusMeta, relativeTime, type AgentView } from './agentViewModel.js';
import { workflowName, roleThemeForAgent } from './roleTemplates.js';
import { PlayIcon } from '../ui/icons/index.js';
import type { KanbanCard, KanbanColumn } from '../kanban/kanbanClient.js';
import { AgentBoardPanel } from './AgentBoardPanel.js';
import { AgentWorkflowPortfolioPanel } from './AgentWorkflowPortfolioPanel.js';
import { AgentSchedulesPanel } from './AgentSchedulesPanel.js';
import { AgentInstructionsPanel } from './AgentInstructionsPanel.js';
import { AgentIntegrationsPanel } from './AgentIntegrationsPanel.js';
import { AgentActivityTab } from './AgentActivityTab.js';
import { AgentAvatar } from './AgentAvatar.js';
import { AvatarEditor } from './AvatarEditor.js';
import { Notice } from '../ui/Notice.js';
import { Markdown } from '../ui/Markdown.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

/** Human label for an autonomous-heartbeat cadence (ms). 0/absent ⇒ manual. */
function formatHeartbeat(intervalMs: number | undefined): string {
  if (!intervalMs || intervalMs <= 0) return 'manual';
  const mins = Math.round(intervalMs / 60_000);
  if (mins < 60) return `every ${mins}m`;
  const hrs = Math.round(mins / 60);
  return `every ${hrs}h`;
}

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

export function AgentWorkspacePage(): JSX.Element {
  const { agentId: rosterId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<AgentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  // Bumped on board-affecting actions (Check now) so the embedded board refetches.
  const [boardRefresh, setBoardRefresh] = useState(0);
  // Tab lives in the URL (?tab=board) so refresh / back / share preserve it.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'overview';
  const setTab = (next: TabKey): void => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'overview') p.delete('tab');
      else p.set('tab', next);
      return p;
    }, { replace: true });
  };

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
      setBoardRefresh((n) => n + 1); // make the Board tab reflect the moved card immediately
      if (result.picked) setTab('board');
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

  // Save (string data-URI) or clear (null) the profile photo, then refresh so
  // the header — and, after navigation, the dashboard card — reflect it.
  const onSaveAvatar = async (avatarUrl: string | null) => {
    if (!view) return;
    setNotice(null);
    setError(null);
    try {
      await updateRosterEntry(view.entry.rosterId, { avatarUrl });
      setEditingAvatar(false);
      await refresh();
      setNotice(avatarUrl ? `Updated ${view.entry.persona}'s profile photo.` : `Removed ${view.entry.persona}'s profile photo.`);
    } catch (err) {
      // Keep the editor open so the user can retry / shrink an oversized image.
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
  const theme = roleThemeForAgent(entry.agentRef?.agentId, entry.workflows);

  return (
    <section>
      <Link to="/agents" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>← All agents</Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', margin: '0.6rem 0 0.4rem', flexWrap: 'wrap' }}>
        <AgentAvatar persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} size={48} onEdit={() => setEditingAvatar(true)} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0 }}>{entry.persona}</h1>
          <div style={muted}>{entry.label ?? 'Agent'}</div>
        </div>
        <div className="action-bar">
          <span className={`chip ${sm.chip}`} title={sm.help}>{sm.label}</span>
          <span
            className="chip chip--muted"
            title={
              entry.heartbeatIntervalMs && entry.heartbeatIntervalMs > 0
                ? 'A background daemon runs this agent’s “Check now” automatically on this cadence; you can also trigger it manually.'
                : 'This agent checks for work when you click “Check now”, plus on any enabled schedule.'
            }
          >
            Heartbeat: {formatHeartbeat(entry.heartbeatIntervalMs)}
          </span>
        </div>
      </div>

      <div className="action-bar" style={{ marginBottom: 'var(--space-3)', alignItems: 'center' }}>
        <button
          type="button"
          className="primary"
          onClick={() => void onCheckNow()}
          disabled={busy || !entry.enabled}
          title={`Run the heartbeat: let ${entry.persona} pick up the next To Do task and start its workflow.`}
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
        <button type="button" className="secondary" onClick={() => setTab('board')}>Add task</button>
        <button type="button" className="secondary" onClick={() => setTab('workflows')}>Run workflow</button>
        <button type="button" className="secondary" onClick={() => void onTogglePause()}>{entry.enabled ? 'Pause' : 'Resume'}</button>
        <button type="button" className="secondary" onClick={() => setTab('instructions')}>Instructions</button>
        <span style={{ ...muted, fontSize: '0.78rem' }}>
          {entry.lastHeartbeatAt
            ? `Last checked ${relativeTime(entry.lastHeartbeatAt)}`
            : 'Not checked yet'}
          {view.nextSchedule
            ? ` · next scheduled run: ${String(view.nextSchedule.metadata?.label ?? view.nextSchedule.cronExpr)}`
            : ''}
        </span>
      </div>

      {error ? <Notice variant="error">{error}</Notice> : null}
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

      {tab === 'overview' ? <OverviewTab view={view} onGoto={setTab} onCheckNow={() => void onCheckNow()} busy={busy} /> : null}
      {tab === 'workflows' ? <AgentWorkflowPortfolioPanel entry={entry} jobs={view.jobs} board={view.board} onChanged={() => void refresh()} /> : null}
      {tab === 'board' ? (view.board ? <AgentBoardPanel boardId={view.board.id} persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} workflows={entry.workflows} refreshSignal={boardRefresh} onChanged={() => void refresh()} /> : <NoBoard persona={entry.persona} />) : null}
      {tab === 'schedules' ? <AgentSchedulesPanel entry={entry} /> : null}
      {tab === 'instructions' ? <AgentInstructionsPanel entry={entry} onChanged={() => void refresh()} /> : null}
      {tab === 'integrations' ? <AgentIntegrationsPanel boardId={view.board?.id ?? null} persona={entry.persona} onChanged={() => void refresh()} /> : null}
      {tab === 'activity' ? <AgentActivityTab rosterId={entry.rosterId} persona={entry.persona} refreshSignal={boardRefresh} /> : null}

      <details style={{ marginTop: 'var(--space-5)' }}>
        <summary style={{ ...muted, fontSize: '12px', cursor: 'pointer' }}>Advanced protocol details</summary>
        <p style={{ ...muted, fontSize: '12px', marginTop: 'var(--space-2)' }}>
          {entry.persona} runs manifest agent <code>{entry.agentRef.agentId}</code> · roster id <code>{entry.rosterId}</code>.
          {' '}<button type="button" className="secondary btn-sm" onClick={() => navigate('/roster')}>Open raw roster</button>
        </p>
      </details>

      {editingAvatar ? (
        <AvatarEditor
          personaName={entry.persona}
          currentAvatarUrl={entry.avatarUrl}
          onCancel={() => setEditingAvatar(false)}
          onSave={onSaveAvatar}
        />
      ) : null}
    </section>
  );
}

function NoBoard({ persona }: { persona: string }): JSX.Element {
  return <p style={muted}>{persona} has no task board yet.</p>;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };
function colMatches(col: KanbanColumn, kind: 'todo' | 'working' | 'done'): boolean {
  const id = col.id.toLowerCase();
  const name = col.name.toLowerCase();
  if (kind === 'todo') return id === 'todo' || name === 'to do';
  if (kind === 'done') return id === 'done' || name === 'done';
  return id === 'working' || id === 'doing' || name === 'working' || name === 'doing';
}
function topByPriority(cards: KanbanCard[]): KanbanCard | undefined {
  return [...cards].sort(
    (a, b) => (PRIORITY_RANK[a.priority ?? 'normal'] - PRIORITY_RANK[b.priority ?? 'normal']) || a.order - b.order,
  )[0];
}

/** The dominant "what should I do now?" panel — the most important pending
 *  task, the run in flight, and the next scheduled run, so the workspace opens
 *  on the answer instead of a grid of equal-weight stat cards. */
function PriorityPanel({
  view,
  onGoto,
  onCheckNow,
  busy,
}: {
  view: AgentView;
  onGoto: (t: TabKey) => void;
  onCheckNow: () => void;
  busy: boolean;
}): JSX.Element {
  const { entry, board, cards, nextSchedule } = view;
  const todoCol = board?.columns.find((c) => colMatches(c, 'todo'));
  const workingCol = board?.columns.find((c) => colMatches(c, 'working'));
  const doneCol = board?.columns.find((c) => colMatches(c, 'done'));
  const topTodo = todoCol ? topByPriority(cards.filter((c) => c.columnId === todoCol.id)) : undefined;
  // "In progress" = a run on a card in the Working lane; fall back to any card
  // with a run that is NOT already Done, so a finished run is never mislabeled
  // as running on a board without a canonical Working lane.
  const running =
    (workingCol ? cards.filter((c) => c.columnId === workingCol.id && c.lastRunId)[0] : undefined) ??
    cards.find((c) => c.lastRunId && c.columnId !== doneCol?.id);

  const cell: React.CSSProperties = { flex: '1 1 200px', minWidth: 180 };
  const label: React.CSSProperties = { ...muted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 };

  return (
    <div className="surface-card" style={{ borderLeft: '3px solid var(--color-accent)', marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={cell}>
          <div style={label}>Next up</div>
          {topTodo ? (
            <>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>
                {topTodo.title}
                {topTodo.priority === 'high' ? <span className="chip chip--danger" style={{ marginLeft: 6 }}>High</span> : null}
              </div>
              <button type="button" className="primary btn-sm" style={{ marginTop: 6 }} onClick={onCheckNow} disabled={busy || !entry.enabled}>
                {busy ? 'Checking…' : 'Pick up now'}
              </button>
            </>
          ) : (
            <div style={{ ...muted, fontSize: '13px' }}>No pending tasks. <button type="button" className="secondary btn-sm" onClick={() => onGoto('board')}>Add a task</button></div>
          )}
        </div>
        <div style={cell}>
          <div style={label}>In progress</div>
          {running ? (
            <div style={{ fontSize: '14px' }}>
              <div style={{ fontWeight: 600 }}>{running.title}</div>
              {running.lastRunId ? <Link to={`/runs/${running.lastRunId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '13px', marginTop: 4 }}><PlayIcon size={12} /> View run</Link> : null}
            </div>
          ) : (
            <div style={{ ...muted, fontSize: '13px' }}>Nothing running.</div>
          )}
        </div>
        <div style={cell}>
          <div style={label}>Next scheduled</div>
          {nextSchedule ? (
            <div style={{ fontSize: '14px' }}>
              <div style={{ fontWeight: 600 }}>{workflowName(nextSchedule.workflowId ?? entry.workflows[0] ?? '')}</div>
              <div style={{ ...muted, fontSize: '13px', marginTop: 4 }}>{String(nextSchedule.metadata?.label ?? nextSchedule.cronExpr)}</div>
            </div>
          ) : (
            <div style={{ ...muted, fontSize: '13px' }}>No schedule. <button type="button" className="secondary btn-sm" onClick={() => onGoto('schedules')}>Add one</button></div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ view, onGoto, onCheckNow, busy }: { view: AgentView; onGoto: (t: TabKey) => void; onCheckNow: () => void; busy: boolean }): JSX.Element {
  const { entry, laneCounts, nextSchedule } = view;
  const card: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.8rem', background: 'var(--color-surface)' };
  return (
    <>
    <PriorityPanel view={view} onGoto={onGoto} onCheckNow={onCheckNow} busy={busy} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.7rem' }}>
      <div style={card}>
        <strong>What {entry.persona} does</strong>
        {entry.description
          ? <Markdown style={{ fontSize: '0.85rem' }}>{entry.description}</Markdown>
          : <p style={{ fontSize: '0.85rem', marginBottom: 0 }}>{`${entry.label ?? 'Agent'} — assign a role description in Instructions.`}</p>}
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
    </>
  );
}
