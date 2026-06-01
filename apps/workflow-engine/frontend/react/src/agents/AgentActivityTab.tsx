/**
 * Per-agent Activity tab (PRD §9 Activity) — the richer, runs-derived activity
 * log for ONE agent. Unlike the fleet feed (AgentActivityFeed, derived from
 * current board state), this reads the durable runs store via
 * `GET /v1/host/sample/roster/:id/activity`, so every row carries a real
 * timestamp, the run OUTCOME (a status chip), and links to the run.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAgentActivity, type AgentActivityItem } from './rosterClient.js';
import { workflowName } from './roleTemplates.js';
import { relativeTime } from './agentViewModel.js';
import { Notice } from '../ui/Notice.js';
import { ClockIcon, ZapIcon, PlayIcon } from '../ui/icons/index.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

const SOURCE_TEXT: Record<AgentActivityItem['source'], string> = {
  heartbeat: 'picked up a task',
  schedule: 'ran on a schedule',
  kanban: 'started a workflow from a card',
};

const SOURCE_ICON: Record<AgentActivityItem['source'], JSX.Element> = {
  heartbeat: <PlayIcon size={13} />,
  schedule: <ClockIcon size={13} />,
  kanban: <ZapIcon size={13} />,
};

/** Map a run status to a chip class + label. */
function statusChip(status: string): { cls: string; label: string } {
  switch (status) {
    case 'completed': return { cls: 'chip--success', label: 'Completed' };
    case 'failed': return { cls: 'chip--danger', label: 'Failed' };
    case 'running': return { cls: 'chip--accent', label: 'Running' };
    case 'suspended': return { cls: 'chip--warning', label: 'Suspended' };
    default: return { cls: 'chip--muted', label: status.charAt(0).toUpperCase() + status.slice(1) };
  }
}

export function AgentActivityTab({ rosterId, persona, refreshSignal }: { rosterId: string; persona: string; refreshSignal?: number }): JSX.Element {
  const [items, setItems] = useState<AgentActivityItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getAgentActivity(rosterId);
      setItems(res.items);
      setTruncated(res.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [rosterId]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Re-fetch when the parent signals an activity-affecting action (e.g. the
  // header's "Check now" heartbeat started a run).
  useEffect(() => { void refresh(); }, [refreshSignal, refresh]);

  if (error) return <Notice variant="error">{error}</Notice>;
  if (items === null) return <p style={muted}>Loading activity…</p>;
  if (items.length === 0) {
    return (
      <p style={muted}>
        No runs yet. Click <strong>Check now</strong> or run a workflow, and {persona}'s activity — with outcomes and
        timestamps — will appear here.
      </p>
    );
  }

  return (
    <>
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {items.map((item) => {
        const chip = statusChip(item.status);
        return (
          <li
            key={item.runId}
            style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', border: '1px solid var(--color-border)', borderRadius: 10, padding: '0.5rem 0.7rem', background: 'var(--color-surface)' }}
          >
            <span aria-hidden="true" style={{ ...muted, display: 'inline-flex' }}>{SOURCE_ICON[item.source]}</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: '0.86rem' }}>
                {persona} {SOURCE_TEXT[item.source]} · <strong>{workflowName(item.workflowId)}</strong>
              </div>
              <div style={{ ...muted, fontSize: '0.76rem' }}>
                {relativeTime(item.timestamp)} · <Link to={`/runs/${item.runId}`}>view run</Link>
              </div>
            </div>
            <span className={`chip ${chip.cls}`} title={`Run ${item.status}`}>{chip.label}</span>
          </li>
        );
      })}
    </ul>
    {truncated ? (
      <p style={{ ...muted, fontSize: '0.74rem', marginTop: '0.5rem' }}>
        Showing {persona}'s most recent activity. Older runs may exist beyond this window.
      </p>
    ) : null}
    </>
  );
}
