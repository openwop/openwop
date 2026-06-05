import { useState } from 'react';
import { claimApproval, rejectApproval, type PendingApproval } from './approvalsClient.js';
import { roleThemeForAgent, workflowName } from './roleTemplates.js';
import { relativeTime, type AgentView } from './agentViewModel.js';
import { AgentAvatar } from './AgentAvatar.js';
import { toast } from '../ui/toast.js';
import { AlertIcon, CheckIcon, ClockIcon } from '../ui/icons/index.js';

/**
 * The "Needs you" hero queue (agents-workforce redesign PR 1) — the decisions
 * blocking the workforce, surfaced ABOVE the roster so the page reads
 * decision-first, not inventory-first.
 *
 * Two HETEROGENEOUS item types, rendered distinctly (architect delta — they
 * have different real affordances and must not be conflated):
 *   1. Pending APPROVALS (review-mode proposals): `Approve & resume` claims
 *      via the same `claimApproval` the Inbox uses (a claim genuinely
 *      dispatches the run) and `Send back` rejects. Blocked-time derives from
 *      `approval.createdAt`.
 *   2. WAITING-lane cards: there is NO resume API — the only honest action is
 *      `Open board`. "In waiting since" derives from the card's `updatedAt`
 *      (lane moves touch it).
 *
 * Empty state: the green "You're all caught up" strip — the page celebrates
 * an unblocked fleet instead of rendering nothing.
 */

/** "13h ago" → "13h" for the compact time pill. */
function compact(rel: string | null): string {
  return rel ? rel.replace(' ago', '') : 'now';
}

export function NeedsYouQueue({ views, approvals, onOpen, onResolved }: {
  views: AgentView[];
  approvals: PendingApproval[];
  /** Open an agent's workspace at a tab. */
  onOpen: (rosterId: string, tab?: string) => void;
  /** Re-fetch after a claim/reject mutated the queue. */
  onResolved: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);

  const waiting = views.filter((v) => v.status === 'waiting');
  const total = approvals.length + waiting.length;

  const approve = async (a: PendingApproval): Promise<void> => {
    setBusy(a.approvalId);
    try {
      const { runId } = await claimApproval(a.approvalId);
      toast.success(`${a.persona} approved — run ${runId.slice(0, 8)}… started.`);
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not claim the proposal.');
    } finally {
      setBusy(null);
    }
  };
  const sendBack = async (a: PendingApproval): Promise<void> => {
    setBusy(a.approvalId);
    try {
      await rejectApproval(a.approvalId);
      toast.info(`Sent back to ${a.persona} — the proposal was rejected.`);
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject the proposal.');
    } finally {
      setBusy(null);
    }
  };

  if (total === 0) {
    return (
      <section className="surface-card needs-clear" aria-label="Nothing needs you">
        <span className="needs-clear-icon" aria-hidden><CheckIcon size={18} /></span>
        <div>
          <div className="needs-clear-title">You&rsquo;re all caught up.</div>
          <div className="needs-clear-sub">Every agent is running on its own.</div>
        </div>
      </section>
    );
  }

  const viewByRoster = new Map(views.map((v) => [v.entry.rosterId, v]));

  return (
    <section className="surface-card needs-card" aria-label="Decisions waiting on you">
      <div className="needs-head">
        <AlertIcon size={16} aria-hidden />
        <span className="needs-title">Needs you</span>
        <span className="needs-count">{total}</span>
        <span className="needs-hint">Resolve these to unblock your agents</span>
      </div>

      {approvals.map((a) => {
        const view = viewByRoster.get(a.rosterId);
        const theme = roleThemeForAgent(view?.entry.agentRef?.agentId, view?.entry.workflows ?? []);
        return (
          <div className="needs-item" key={a.approvalId}>
            <AgentAvatar persona={a.persona} avatarUrl={view?.entry.avatarUrl} roleTheme={theme} size={40} showBadge={false} ring="var(--color-warning)" />
            <div className="needs-body">
              <div className="needs-who">
                <span className="needs-name">{a.persona}</span>
                {view?.entry.label ? <span className="needs-role">{view.entry.label}</span> : null}
                <span className="chip chip--warning needs-age">
                  <ClockIcon size={11} aria-hidden /> {compact(relativeTime(a.createdAt))}
                </span>
              </div>
              <div className="needs-ask">{a.cardTitle ?? a.proposal}</div>
              <div className="needs-detail">
                Proposes to run {workflowName(a.workflowId)}{a.cardTitle && a.proposal !== a.cardTitle ? ` — ${a.proposal}` : ''}
              </div>
            </div>
            <div className="needs-actions action-bar">
              <button type="button" className="secondary btn-sm" disabled={busy === a.approvalId} onClick={() => onOpen(a.rosterId)}>
                Open
              </button>
              <button type="button" className="secondary btn-sm" disabled={busy === a.approvalId} onClick={() => void sendBack(a)}>
                Send back
              </button>
              <button type="button" className="btn-accent-solid btn-sm" disabled={busy === a.approvalId} onClick={() => void approve(a)}>
                <CheckIcon size={14} aria-hidden /> Approve &amp; resume
              </button>
            </div>
          </div>
        );
      })}

      {waiting.map((v) => {
        const card = v.cards.find((c) => c.columnId === 'waiting');
        const theme = roleThemeForAgent(v.entry.agentRef?.agentId, v.entry.workflows);
        return (
          <div className="needs-item" key={v.entry.rosterId}>
            <AgentAvatar persona={v.entry.persona} avatarUrl={v.entry.avatarUrl} roleTheme={theme} size={40} showBadge={false} ring="var(--color-warning)" />
            <div className="needs-body">
              <div className="needs-who">
                <span className="needs-name">{v.entry.persona}</span>
                {v.entry.label ? <span className="needs-role">{v.entry.label}</span> : null}
                {card?.updatedAt ? (
                  <span className="chip chip--warning needs-age">
                    <ClockIcon size={11} aria-hidden /> {compact(relativeTime(card.updatedAt))}
                  </span>
                ) : null}
              </div>
              <div className="needs-ask">{card?.title ?? 'A task is parked in the Waiting lane'}</div>
              <div className="needs-detail">
                {card?.blockerNote ?? 'A person needs to act on the board before this can move on.'}
              </div>
            </div>
            <div className="needs-actions action-bar">
              <button type="button" className="btn-accent-solid btn-sm" onClick={() => onOpen(v.entry.rosterId, 'board')}>
                Open board
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
