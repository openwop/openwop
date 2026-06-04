/**
 * Agent card — one named coworker on the `/agents` dashboard (PRD §8).
 * Shows name + role, status, workflow count, To Do count, next scheduled run,
 * and a board lane preview, with Open + Check-now actions.
 */

import { workflowName, roleThemeForAgent } from './roleTemplates.js';
import { statusMeta, relativeTime, type AgentView } from './agentViewModel.js';
import { AgentAvatar } from './AgentAvatar.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

function LaneCount({ label, n }: { label: string; n: number }): JSX.Element {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{n}</div>
      <div style={{ ...muted, fontSize: '12px' }}>{label}</div>
    </div>
  );
}

/** The single most useful next action for this agent, given its state — drives
 *  the card's primary button + deep-links to the relevant workspace tab. */
function nextAction(view: AgentView): { label: string; tab?: string } {
  const { status, laneCounts, entry, board } = view;
  if (status === 'paused') return { label: 'Open dashboard' };
  if (entry.workflows.length === 0) return { label: 'Assign workflows', tab: 'workflows' };
  if (!board) return { label: 'Set up board', tab: 'board' };
  if (laneCounts.waiting > 0) return { label: 'Review waiting task', tab: 'board' };
  return { label: 'Open board', tab: 'board' };
}

export function AgentCard({
  view,
  onOpen,
  onCheckNow,
  onChat,
  busy,
  department,
}: {
  view: AgentView;
  onOpen: (tab?: string) => void;
  onCheckNow: () => void;
  /** Open a chat already routed to this agent (deep-links into the chat with
   *  the persona pre-activated). */
  onChat: () => void;
  busy?: boolean;
  /** Org-chart department the agent files under — renders the dossier strip
   *  (department eyebrow + live heartbeat pulse) above the identity row. */
  department?: string;
}): JSX.Element {
  const { entry, laneCounts, status, nextSchedule } = view;
  const sm = statusMeta(status);
  const firstWorkflow = entry.workflows[0];
  const theme = roleThemeForAgent(entry.agentRef?.agentId, entry.workflows);
  const action = nextAction(view);

  return (
    // Whole card clickable for MOUSE convenience (onClick → overview);
    // intentionally NOT a role=button/tabIndex target — that would nest
    // interactive controls (the card holds real <button>s) and add a redundant
    // tab stop. Keyboard / AT users reach the explicit next-action button below.
    <div
      className="surface-card surface-card--interactive"
      onClick={() => onOpen()}
    >
      {department !== undefined ? (
        <div className="wf-card-file" aria-hidden>
          <span className="wf-card-dept">{department || 'Unassigned'}</span>
          <span
            className={(entry.heartbeatIntervalMs ?? 0) > 0 && entry.enabled ? 'wf-live is-on' : 'wf-live'}
            title={(entry.heartbeatIntervalMs ?? 0) > 0 && entry.enabled ? 'Autonomous heartbeat enabled' : 'Manual heartbeat only'}
          />
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <AgentAvatar persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{entry.persona}</div>
          <div style={{ ...muted, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.label ?? 'Agent'}
          </div>
        </div>
        <span className={`chip ${sm.chip}`} title={sm.help}>{sm.label}</span>
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

      <div style={{ ...muted, fontSize: '12px' }}>
        {entry.lastHeartbeatAt ? `Last checked ${relativeTime(entry.lastHeartbeatAt)}` : 'Not checked yet'}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-1)', padding: 'var(--space-2) 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <LaneCount label="To Do" n={laneCounts.todo} />
        <LaneCount label="Working" n={laneCounts.working} />
        <LaneCount label="Waiting" n={laneCounts.waiting} />
        <LaneCount label="Done" n={laneCounts.done} />
      </div>

      <div className="action-bar">
        <button type="button" className="primary" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); onOpen(action.tab); }}>{action.label}</button>
        <button
          type="button"
          className="secondary"
          onClick={(e) => { e.stopPropagation(); onChat(); }}
          title={`Open a chat with ${entry.persona}.`}
        >
          Chat
        </button>
        <button
          type="button"
          className="secondary"
          onClick={(e) => { e.stopPropagation(); onCheckNow(); }}
          disabled={busy || status === 'paused' || status === 'needs-setup'}
          title={`Run the heartbeat: let ${entry.persona} pick up the next To Do task and start its workflow.`}
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </div>
  );
}
