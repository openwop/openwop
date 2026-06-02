/**
 * ApprovalsInbox — the "agents propose, humans dispose" queue, embedded in the
 * /inbox page. Lists pending proposals from review-mode roster members (a
 * heartbeat picked work but didn't run it). The human CLAIMS (an affirmative
 * sign-off that starts the proposed run) or REJECTS (dismisses it).
 *
 * What's being approved here is the AGENT'S PROPOSED ACTION ("run workflow X on
 * card Y") — the produced output doesn't exist until the run runs, so the
 * result + its provenance show up on the resulting run (RunProvenancePanel),
 * not here. The copy says so, so the gate isn't mistaken for output sign-off.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type DataColumn } from '../ui/DataTable.js';
import { SkeletonRows } from '../ui/Skeleton.js';
import { Notice } from '../ui/Notice.js';
import { toast } from '../ui/toast.js';
import { ScaleIcon, CheckIcon, XIcon } from '../ui/icons/index.js';
import { listApprovals, claimApproval, rejectApproval, type PendingApproval } from '../agents/approvalsClient.js';
import { workflowName } from '../agents/roleTemplates.js';
import { relativeTime } from '../agents/agentViewModel.js';

export function ApprovalsInbox({ onResolved }: { onResolved?: () => void }): JSX.Element {
  const nav = useNavigate();
  const [items, setItems] = useState<PendingApproval[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listApprovals('pending'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const claim = useCallback(async (a: PendingApproval) => {
    setBusy(a.approvalId);
    try {
      const { runId } = await claimApproval(a.approvalId);
      toast.success(`Approved — ${a.persona} is running it now.`);
      await refresh();
      onResolved?.();
      nav(`/runs/${encodeURIComponent(runId)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not claim the proposal.');
    } finally {
      setBusy(null);
    }
  }, [refresh, onResolved, nav]);

  const reject = useCallback(async (a: PendingApproval) => {
    setBusy(a.approvalId);
    try {
      await rejectApproval(a.approvalId);
      toast.info('Proposal dismissed.');
      await refresh();
      onResolved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject the proposal.');
    } finally {
      setBusy(null);
    }
  }, [refresh, onResolved]);

  const columns: DataColumn<PendingApproval>[] = [
    {
      key: 'persona',
      header: 'Agent',
      width: '140px',
      render: (a) => <strong>{a.persona}</strong>,
      sortValue: (a) => a.persona,
    },
    {
      key: 'proposal',
      header: 'Proposes to',
      width: '1fr',
      render: (a) => (
        <div>
          <div>Run <strong>{workflowName(a.workflowId)}</strong></div>
          {a.cardTitle && <div className="muted" style={{ fontSize: 12 }}>on “{a.cardTitle}”</div>}
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Proposed',
      width: '120px',
      cellClassName: 'muted',
      render: (a) => relativeTime(a.createdAt),
      sortValue: (a) => a.createdAt,
    },
    {
      key: 'actions',
      header: '',
      width: '200px',
      align: 'right',
      render: (a) => (
        <div className="action-bar" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => void claim(a)} disabled={busy === a.approvalId}>
            <CheckIcon size={13} /> Approve &amp; run
          </button>
          <button type="button" className="secondary" onClick={() => void reject(a)} disabled={busy === a.approvalId}>
            <XIcon size={13} /> Reject
          </button>
        </div>
      ),
    },
  ];

  // Empty + settled: collapse to a single discoverable line rather than a full
  // card, so the inbox isn't dominated by an empty section for users who never
  // enable review mode.
  if (items !== null && items.length === 0 && !error) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <ScaleIcon size={14} />
        <span className="muted">
          No agent proposals awaiting sign-off. Set an agent&apos;s autonomy to <strong>review</strong> (on its Roster
          card) to route its heartbeat picks here.
        </span>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <ScaleIcon size={16} />
        <h2 style={{ flex: 1, margin: 0 }}>Awaiting sign-off</h2>
        {items && items.length > 0 && <span className="chip chip--warning">{items.length} pending</span>}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
        Proposals from review-mode agents — they picked up work but won&apos;t run it without you.
        Approving starts the run; you&apos;ll see the result and its provenance on the run.
      </p>

      {error && <Notice variant="error">{error}</Notice>}
      {items === null ? (
        <SkeletonRows rows={2} columns={['140px', '1fr', '120px', '200px']} />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(a) => a.approvalId}
          density="compact"
          caption="Pending agent proposals awaiting human sign-off"
        />
      )}
    </div>
  );
}
