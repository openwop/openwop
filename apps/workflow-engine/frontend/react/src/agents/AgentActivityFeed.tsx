/**
 * Fleet activity feed (PRD §8.5) — a compact, human-readable summary of what
 * the agents are doing right now. Derived from current board state (cards with
 * a started run, cards waiting on a human) rather than a dedicated event log —
 * an MVP that reads honestly from the live data.
 */

import { Link } from 'react-router-dom';
import { workflowName } from './roleTemplates.js';
import type { AgentView } from './agentViewModel.js';

interface ActivityItem {
  key: string;
  text: string;
  runId?: string;
}

function deriveActivity(views: AgentView[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const view of views) {
    const persona = view.entry.persona;
    // In-progress + waiting work (with run links where present).
    for (const card of view.cards) {
      const lane = view.board?.columns.find((c) => c.id === card.columnId);
      const laneName = (lane?.name ?? '').toLowerCase();
      if (card.lastRunId && (laneName === 'working' || laneName === 'doing')) {
        items.push({ key: `${card.id}-run`, text: `${persona} picked up “${card.title}”`, runId: card.lastRunId });
      } else if (laneName.startsWith('waiting')) {
        items.push({ key: `${card.id}-wait`, text: `${persona} has “${card.title}” waiting on a human` });
      }
    }
    // New work queued in To Do.
    if (view.laneCounts.todo > 0) {
      items.push({ key: `${view.entry.rosterId}-todo`, text: `${persona} has ${view.laneCounts.todo} new task${view.laneCounts.todo === 1 ? '' : 's'} in To Do` });
    }
    // Scheduled runs.
    for (const job of view.jobs.filter((j) => j.enabled !== false).slice(0, 2)) {
      const label = String(job.metadata?.label ?? (job.workflowId ? workflowName(job.workflowId) : 'a workflow'));
      items.push({ key: `${job.jobId}-sched`, text: `${persona}: ${label} is scheduled` });
    }
  }
  return items.slice(0, 10);
}

export function AgentActivityFeed({ views }: { views: AgentView[] }): JSX.Element {
  const items = deriveActivity(views);
  if (items.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        No work yet. Create an agent, add a task, or click “Check now” to see its heartbeat pick up work.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {items.map((item) => (
        <li key={item.key} style={{ fontSize: '0.85rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
          <span aria-hidden="true">•</span>
          <span>
            {item.text}
            {item.runId ? <> · <Link to={`/runs/${item.runId}`}>view run</Link></> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
