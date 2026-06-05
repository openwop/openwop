import { workflowName, roleThemeForAgent } from './roleTemplates.js';
import { statusMeta, statusRingColor, relativeTime, type AgentView } from './agentViewModel.js';
import { AgentAvatar } from './AgentAvatar.js';
import { ColumnsIcon, MessageSquareIcon, PlayIcon, AlertIcon, ActivityIcon, WrenchIcon } from '../ui/icons/index.js';
import { AutonomyMeter } from './AutonomyMeter.js';

/**
 * One agent as a roster ROW (agents-workforce redesign PR 1) — replaces the
 * card grid with a dense, scannable list: identity + status, a CONTEXTUAL
 * sub-line, board counts, autonomy, and per-row actions.
 *
 * The sub-line composes from REAL fields only (architect delta — the
 * prototype's progress fractions have no backing data): the working/waiting
 * card title, the next schedule's label, or the status's own explanation.
 */

/** The single most useful next action, given the agent's state. */
function primaryAction(view: AgentView): { label: string; tab?: string; Icon: typeof ColumnsIcon } {
  switch (view.status) {
    case 'waiting': return { label: 'Review', Icon: AlertIcon };
    case 'error': return { label: 'View activity', tab: 'activity', Icon: ActivityIcon };
    case 'needs-setup': return { label: 'Finish setup', tab: 'workflows', Icon: WrenchIcon };
    default: return { label: 'Open board', tab: 'board', Icon: ColumnsIcon };
  }
}

function subLine(view: AgentView): string {
  const { status, cards, nextSchedule, entry } = view;
  if (status === 'working') {
    const card = cards.find((c) => c.columnId === 'working');
    return card ? card.title : 'Working';
  }
  if (status === 'waiting') {
    const card = cards.find((c) => c.columnId === 'waiting');
    return card ? card.title : 'Waiting on a person';
  }
  if (status === 'error') return 'A recent run failed — see what went wrong';
  if (status === 'needs-setup') return 'No workflows or board yet — finish setup to give it work';
  if (status === 'paused') return 'Re-enable to resume board triggers and the heartbeat';
  if (nextSchedule) {
    const wf = nextSchedule.workflowId ?? entry.workflows[0];
    const label = String(nextSchedule.metadata?.label ?? nextSchedule.cronExpr);
    return `Next: ${wf ? workflowName(wf) : 'workflow'} · ${label}`;
  }
  return 'No schedule — runs on demand or from the board';
}

export function RosterRow({ view, busy, onOpen, onCheckNow, onChat }: {
  view: AgentView;
  busy?: boolean;
  onOpen: (tab?: string) => void;
  onCheckNow: () => void;
  onChat: () => void;
}): JSX.Element {
  const { entry, laneCounts, status } = view;
  const sm = statusMeta(status);
  const theme = roleThemeForAgent(entry.agentRef?.agentId, entry.workflows);
  const action = primaryAction(view);
  const ActionIcon = action.Icon;
  const checked = entry.lastHeartbeatAt ? relativeTime(entry.lastHeartbeatAt) : null;

  return (
    <div className="roster-row">
      <button type="button" className="roster-id" onClick={() => onOpen()} title={`Open ${entry.persona}'s workspace`}>
        <AgentAvatar persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} size={40} showBadge={false} ring={statusRingColor(status)} />
        <span className="roster-name-wrap">
          <span className="roster-name-line">
            <span className="roster-name">{entry.persona}</span>
            <span className={`chip ${sm.chip}`} title={sm.help}><span className="chip-dot" aria-hidden />{sm.label}</span>
          </span>
          <span className="roster-role">{entry.label ?? 'Agent'}</span>
        </span>
      </button>

      <div className="roster-sub">
        <div className="roster-subline">{subLine(view)}</div>
        <div className="roster-counts">
          <span>{entry.workflows.length} workflow{entry.workflows.length === 1 ? '' : 's'}</span>
          {laneCounts.todo > 0 ? <span>{laneCounts.todo} to do</span> : null}
          {laneCounts.waiting > 0 ? <span className="roster-count-waiting">{laneCounts.waiting} waiting</span> : null}
          {checked ? <span>checked {checked}</span> : null}
        </div>
      </div>

      <span className="roster-autonomy">
        <AutonomyMeter autonomyLevel={entry.autonomyLevel} />
      </span>

      <div className="roster-actions action-bar">
        <button type="button" className="secondary btn-sm" title="Run the heartbeat now" aria-label={`Check ${entry.persona} now`} disabled={busy || !entry.enabled} onClick={onCheckNow}>
          <PlayIcon size={14} aria-hidden />
        </button>
        <button type="button" className="secondary btn-sm" title={`Chat with ${entry.persona}`} aria-label={`Chat with ${entry.persona}`} onClick={onChat}>
          <MessageSquareIcon size={14} aria-hidden />
        </button>
        <button type="button" className={status === 'waiting' ? 'btn-accent btn-sm' : 'secondary btn-sm'} onClick={() => onOpen(action.tab)}>
          <ActionIcon size={14} aria-hidden /> {action.label}
        </button>
      </div>
    </div>
  );
}
