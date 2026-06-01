/**
 * Agent card — one named coworker on the `/agents` dashboard (PRD §8).
 * Shows name + role, status, workflow count, To Do count, next scheduled run,
 * and a board lane preview, with Open + Check-now actions.
 */

import { workflowName } from './roleTemplates.js';
import { statusMeta, type AgentView } from './agentViewModel.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

/** Initials for the avatar. Falls back to the first two chars of the name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}

function LaneCount({ label, n }: { label: string; n: number }): JSX.Element {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{n}</div>
      <div style={{ ...muted, fontSize: '12px' }}>{label}</div>
    </div>
  );
}

export function AgentCard({
  view,
  onOpen,
  onCheckNow,
  busy,
}: {
  view: AgentView;
  onOpen: () => void;
  onCheckNow: () => void;
  busy?: boolean;
}): JSX.Element {
  const { entry, laneCounts, status, nextSchedule } = view;
  const sm = statusMeta(status);
  const firstWorkflow = entry.workflows[0];

  return (
    <div
      className="surface-card surface-card--interactive"
      role="button"
      tabIndex={0}
      aria-label={`Open ${entry.persona}'s dashboard`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--color-accent)',
            color: 'var(--paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials(entry.persona)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{entry.persona}</div>
          <div style={{ ...muted, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.label ?? 'Agent'}
          </div>
        </div>
        <span className={`chip ${sm.chip}`}>{sm.label}</span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', fontSize: '13px', flexWrap: 'wrap' }}>
        <span><strong>{entry.workflows.length}</strong> <span style={muted}>workflow{entry.workflows.length === 1 ? '' : 's'}</span></span>
        <span style={muted}>·</span>
        <span><strong>{laneCounts.todo}</strong> <span style={muted}>in To Do</span></span>
      </div>

      <div style={{ fontSize: '13px' }}>
        <span style={muted}>Next run: </span>
        {nextSchedule
          ? <span>{firstWorkflow ? workflowName(nextSchedule.workflowId ?? firstWorkflow) : 'workflow'} <span style={muted}>· {String(nextSchedule.metadata?.label ?? nextSchedule.cronExpr)}</span></span>
          : <span style={muted}>no schedule</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-1)', padding: 'var(--space-2) 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <LaneCount label="To Do" n={laneCounts.todo} />
        <LaneCount label="Working" n={laneCounts.working} />
        <LaneCount label="Waiting" n={laneCounts.waiting} />
        <LaneCount label="Done" n={laneCounts.done} />
      </div>

      <div className="action-bar">
        <button type="button" className="primary" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); onOpen(); }}>Open dashboard</button>
        <button
          type="button"
          className="secondary"
          onClick={(e) => { e.stopPropagation(); onCheckNow(); }}
          disabled={busy || status === 'paused' || status === 'needs-setup'}
          title="Run the agent's heartbeat: pick up the first To Do task and start its workflow"
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </div>
  );
}
