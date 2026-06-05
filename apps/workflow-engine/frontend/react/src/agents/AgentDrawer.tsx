import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { claimApproval, rejectApproval, type PendingApproval } from './approvalsClient.js';
import { statusMeta, statusRingColor, relativeTime, type AgentView } from './agentViewModel.js';
import { workflowName, roleThemeForAgent } from './roleTemplates.js';
import { AgentAvatar } from './AgentAvatar.js';
import { AgentBoardPanel } from './AgentBoardPanel.js';
import { AgentActivityTab } from './AgentActivityTab.js';
import { Markdown } from '../ui/Markdown.js';
import { IconButton } from '../ui/IconButton.js';
import { AutonomyMeter } from './AutonomyMeter.js';
import { toast } from '../ui/toast.js';
import { XIcon, CheckIcon, ClockIcon, MessageSquareIcon, AlertIcon, ArrowRightIcon } from '../ui/icons/index.js';

/**
 * Agent quick-look drawer (agents-workforce redesign PR 2) — a right
 * slide-over so reviewing an agent doesn't navigate away from the roster.
 *
 * Composes EXISTING components (architect delta: `AgentBoardPanel` and
 * `AgentActivityTab` are already standalone — no workspace refactor needed):
 *   Overview — the pending ask (real approve/send-back via the Inbox's own
 *              APIs), facts, description, lane counts
 *   Board    — the same embedded board the workspace renders
 *   Activity — the same per-agent run feed
 *
 * Chat intentionally LINKS OUT to the pre-routed chat (`/?agent=`) — there is
 * no chat tab to reuse and the drawer must not grow a second chat surface.
 * The footer always offers the full workspace; the drawer is a quick-look,
 * not a replacement.
 *
 * Deep-linkable: the owner (AgentDashboardPage) stores `?agent=&tab=` in the
 * URL and renders the drawer from it (the prototype's contract).
 */

export type DrawerTab = 'overview' | 'board' | 'activity';
const TABS: ReadonlyArray<{ key: DrawerTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'board', label: 'Board' },
  { key: 'activity', label: 'Activity' },
];

function cadence(ms: number | undefined): string {
  if (!ms || ms <= 0) return 'manual';
  const mins = Math.round(ms / 60_000);
  return mins < 60 ? `every ${mins}m` : `every ${Math.round(mins / 60)}h`;
}

export function AgentDrawer({ view, approvals, tab, onTab, onClose, onCheckNow, busy, onResolved, onChat }: {
  view: AgentView;
  /** Pending approvals for THIS agent. */
  approvals: PendingApproval[];
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
  onCheckNow: () => void;
  busy: boolean;
  onResolved: () => void;
  onChat: () => void;
}): JSX.Element {
  const { entry } = view;
  const sm = statusMeta(view.status);
  const theme = roleThemeForAgent(entry.agentRef?.agentId, entry.workflows);
  const [resolving, setResolving] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  // Esc closes; focus moves into the dialog when the drawer opens.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const approve = async (a: PendingApproval): Promise<void> => {
    setResolving(a.approvalId);
    try {
      const { runId } = await claimApproval(a.approvalId);
      toast.success(`${a.persona} approved — run ${runId.slice(0, 8)}… started.`);
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not claim the proposal.');
    } finally {
      setResolving(null);
    }
  };
  const sendBack = async (a: PendingApproval): Promise<void> => {
    setResolving(a.approvalId);
    try {
      await rejectApproval(a.approvalId);
      toast.info(`Sent back to ${a.persona}.`);
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject the proposal.');
    } finally {
      setResolving(null);
    }
  };

  const waitingCard = view.cards.find((c) => c.columnId === 'waiting');

  return (
    <div className="agent-drawer-scrim" onClick={onClose}>
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="agent-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.persona} — quick look`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agent-drawer-head">
          <AgentAvatar persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} size={44} showBadge={false} ring={statusRingColor(view.status)} />
          <div className="agent-drawer-id">
            <div className="agent-drawer-name-line">
              <span className="agent-drawer-name">{entry.persona}</span>
              <span className={`chip ${sm.chip}`} title={sm.help}><span className="chip-dot" aria-hidden />{sm.label}</span>
            </div>
            <div className="agent-drawer-role">{entry.label ?? 'Agent'}</div>
          </div>
          <div className="action-bar agent-drawer-headactions">
            <button type="button" className="secondary btn-sm" disabled={busy || !entry.enabled} onClick={onCheckNow}>
              {busy ? 'Checking…' : 'Check now'}
            </button>
            <button type="button" className="secondary btn-sm" onClick={onChat} title={`Open a chat routed to ${entry.persona}`}>
              <MessageSquareIcon size={14} aria-hidden /> Chat
            </button>
            <IconButton label="Close quick look" icon={<XIcon size={16} />} onClick={onClose} />
          </div>
        </header>

        <div role="tablist" className="agent-drawer-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              className={tab === t.key ? 'agent-drawer-tab is-active' : 'agent-drawer-tab'}
              onClick={() => onTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="agent-drawer-body">
          {tab === 'overview' ? (
            <div className="agent-drawer-overview">
              {approvals.map((a) => (
                <div className="agent-drawer-ask" key={a.approvalId}>
                  <div className="agent-drawer-ask-eyebrow">
                    <AlertIcon size={13} aria-hidden /> Waiting on you · {relativeTime(a.createdAt) ?? 'now'}
                  </div>
                  <div className="agent-drawer-ask-title">{a.cardTitle ?? a.proposal}</div>
                  <div className="agent-drawer-ask-detail">Proposes to run {workflowName(a.workflowId)}.</div>
                  <div className="action-bar" style={{ marginTop: 'var(--space-2)' }}>
                    <button type="button" className="btn-accent btn-sm" disabled={resolving === a.approvalId} onClick={() => void approve(a)}>
                      <CheckIcon size={14} aria-hidden /> Approve &amp; resume
                    </button>
                    <button type="button" className="secondary btn-sm" disabled={resolving === a.approvalId} onClick={() => void sendBack(a)}>
                      Send back
                    </button>
                  </div>
                </div>
              ))}
              {approvals.length === 0 && waitingCard ? (
                <div className="agent-drawer-ask">
                  <div className="agent-drawer-ask-eyebrow">
                    <ClockIcon size={13} aria-hidden /> In waiting since {relativeTime(waitingCard.updatedAt) ?? '—'}
                  </div>
                  <div className="agent-drawer-ask-title">{waitingCard.title}</div>
                  <div className="agent-drawer-ask-detail">
                    {waitingCard.blockerNote ?? 'A person needs to act on the board before this can move on.'}
                  </div>
                  <div className="action-bar" style={{ marginTop: 'var(--space-2)' }}>
                    <button type="button" className="primary btn-sm" onClick={() => onTab('board')}>Open board</button>
                  </div>
                </div>
              ) : null}

              <dl className="agent-drawer-facts">
                <div><dt>Autonomy</dt><dd><AutonomyMeter autonomyLevel={entry.autonomyLevel} /></dd></div>
                <div><dt>Heartbeat</dt><dd>{cadence(entry.heartbeatIntervalMs)}</dd></div>
                <div><dt>Last check</dt><dd>{relativeTime(entry.lastHeartbeatAt) ?? 'never'}</dd></div>
                <div><dt>Portfolio</dt><dd>{entry.workflows.length} workflow{entry.workflows.length === 1 ? '' : 's'}</dd></div>
              </dl>

              {entry.description ? <Markdown style={{ fontSize: '13px' }}>{entry.description}</Markdown> : null}

              <div className="agent-drawer-lanes">
                {([['To Do', view.laneCounts.todo], ['Working', view.laneCounts.working], ['Waiting', view.laneCounts.waiting], ['Done', view.laneCounts.done]] as const).map(([l, n]) => (
                  <div key={l}><span className="agent-drawer-lane-n">{n}</span><span className="agent-drawer-lane-l">{l}</span></div>
                ))}
              </div>

              {view.nextSchedule ? (
                <p className="agent-drawer-next">
                  Next scheduled: {workflowName(view.nextSchedule.workflowId ?? entry.workflows[0] ?? '')} · {String(view.nextSchedule.metadata?.label ?? view.nextSchedule.cronExpr)}
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'board' ? (
            view.board
              ? <AgentBoardPanel boardId={view.board.id} persona={entry.persona} avatarUrl={entry.avatarUrl} roleTheme={theme} workflows={entry.workflows} refreshSignal={0} onChanged={onResolved} />
              : <p className="agent-drawer-empty">{entry.persona} has no task board yet.</p>
          ) : null}

          {tab === 'activity' ? (
            <AgentActivityTab rosterId={entry.rosterId} persona={entry.persona} refreshSignal={0} />
          ) : null}
        </div>

        <footer className="agent-drawer-foot">
          <Link to={`/agents/${encodeURIComponent(entry.rosterId)}`} className="agent-drawer-full">
            Open full workspace <ArrowRightIcon size={14} aria-hidden />
          </Link>
        </footer>
      </aside>
    </div>
  );
}
