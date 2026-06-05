/**
 * Agent view-model — composes the product-facing "AI coworker" from the
 * underlying host-extension surfaces (roster + board + cards + schedules).
 *
 * The product concept is the RosterEntry (PRD §18 data boundary). This module
 * hydrates each roster member with its board lane counts, its schedules, and a
 * derived status, so the dashboard cards + the workspace header read from one
 * consistent shape.
 */

import { listRoster, getRosterEntry, getFleetActivity, type RosterEntry } from './rosterClient.js';
import { listBoards, listBoardsWithCards, getBoard, type KanbanBoard, type KanbanCard } from '../kanban/kanbanClient.js';
import { listJobs, type ScheduledJob } from './scheduleClient.js';

export type AgentStatus = 'active' | 'working' | 'waiting' | 'paused' | 'needs-setup' | 'error';

export interface LaneCounts {
  todo: number;
  working: number;
  waiting: number;
  done: number;
}

export interface AgentView {
  entry: RosterEntry;
  board: KanbanBoard | null;
  cards: KanbanCard[];
  laneCounts: LaneCounts;
  status: AgentStatus;
  jobs: ScheduledJob[];
  /** First enabled schedule (the "next run" hint; cron is not parsed to a
   *  wall-clock time in the sample). */
  nextSchedule: ScheduledJob | null;
}

// Status → label + a token-driven `.chip--*` modifier (no hardcoded hex; the
// chip classes live in global.css and theme correctly across every surface) +
// a one-line `help` shown as a tooltip so each state explains itself.
const STATUS_META: Record<AgentStatus, { label: string; chip: string; help: string }> = {
  active: { label: 'Ready', chip: 'chip--success', help: 'Idle and ready — no work in progress. Add a task or run the heartbeat to give it work.' },
  working: { label: 'Working', chip: 'chip--accent', help: 'Has at least one task in the Working lane with a run in progress.' },
  waiting: { label: 'Waiting on you', chip: 'chip--warning chip--pulse', help: 'A task is parked in the Waiting lane and needs a person to act before it can move on.' },
  paused: { label: 'Paused', chip: 'chip--muted', help: 'Disabled — its board triggers and heartbeat are inert until you re-enable it.' },
  'needs-setup': { label: 'Needs setup', chip: 'chip--danger', help: 'No workflows assigned or no board yet — finish setup so it can pick up work.' },
  error: { label: 'Run failed', chip: 'chip--danger chip--pulse', help: 'A recent run for this agent failed — open the Activity tab to see what went wrong.' },
};

export function statusMeta(status: AgentStatus): { label: string; chip: string; help: string } {
  return STATUS_META[status];
}

/** Avatar status-ring color (token values only) — the roster's at-a-glance
 *  cue, mirroring the chip families. */
export function statusRingColor(status: AgentStatus): string {
  switch (status) {
    case 'waiting': return 'var(--color-warning)';
    case 'working': return 'var(--clay)';
    case 'active': return 'var(--color-success)';
    case 'error': return 'var(--color-danger)';
    case 'needs-setup': return 'var(--color-danger)';
    default: return 'var(--rule)';
  }
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago") for the
 *  last-checked / last-run hints. Falls back to the ISO date past a week. */
export function relativeTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days <= 7) return `${days}d ago`;
  return iso.slice(0, 10);
}

/** Match a column by canonical id or its (case-insensitive) display name. */
function laneOf(card: KanbanCard, board: KanbanBoard | null): keyof LaneCounts | null {
  if (!board) return null;
  const col = board.columns.find((c) => c.id === card.columnId);
  if (!col) return null;
  const key = col.id.toLowerCase();
  const name = col.name.toLowerCase();
  if (key === 'todo' || name === 'to do') return 'todo';
  if (key === 'working' || name === 'working' || key === 'doing' || name === 'doing') return 'working';
  if (key === 'waiting' || name.startsWith('waiting')) return 'waiting';
  if (key === 'done' || name === 'done') return 'done';
  return null;
}

function deriveStatus(entry: RosterEntry, board: KanbanBoard | null, counts: LaneCounts, hasRecentFailure: boolean): AgentStatus {
  if (!entry.enabled) return 'paused';
  if (entry.workflows.length === 0 || !board) return 'needs-setup';
  // A recent failed run is the most actionable "set up but broke" signal —
  // surface it above in-progress/waiting state.
  if (hasRecentFailure) return 'error';
  if (counts.working > 0) return 'working';
  if (counts.waiting > 0) return 'waiting';
  return 'active';
}

function buildView(entry: RosterEntry, board: KanbanBoard | null, cards: KanbanCard[], jobs: ScheduledJob[], hasRecentFailure = false): AgentView {
  const laneCounts: LaneCounts = { todo: 0, working: 0, waiting: 0, done: 0 };
  for (const card of cards) {
    const lane = laneOf(card, board);
    if (lane) laneCounts[lane] += 1;
  }
  const myJobs = jobs.filter((j) => j.rosterId === entry.rosterId);
  return {
    entry,
    board,
    cards,
    laneCounts,
    status: deriveStatus(entry, board, laneCounts, hasRecentFailure),
    jobs: myJobs,
    nextSchedule: myJobs.find((j) => j.enabled) ?? null,
  };
}

/** Load every agent's view (dashboard) in a fixed FOUR requests — roster +
 *  boards-with-cards (one batched `?include=cards` call, not N+1) + jobs +
 *  recent failed runs (best-effort, for the 'error' badge) — so a dashboard
 *  with many agents doesn't trip the per-IP read rate limit. */
export async function loadAgentViews(): Promise<AgentView[]> {
  const [roster, boards, jobs, failures] = await Promise.all([
    listRoster(),
    listBoardsWithCards(),
    listJobs(),
    // Recent failed runs across the fleet → which agents need an "error" badge.
    // Best-effort: a failure here must not blank the dashboard.
    getFleetActivity({ status: 'failed', limit: 100 }).catch(() => ({ items: [], truncated: false })),
  ]);
  const failedRosterIds = new Set(failures.items.map((i) => i.rosterId).filter((id): id is string => !!id));
  return roster.map((entry) => {
    const board = boards.find((b) => b.rosterId === entry.rosterId) ?? null;
    return buildView(entry, board, board?.cards ?? [], jobs, failedRosterIds.has(entry.rosterId));
  });
}

/** Load a single agent's view (workspace). */
export async function loadAgentView(rosterId: string): Promise<AgentView | null> {
  let entry: RosterEntry;
  try {
    entry = await getRosterEntry(rosterId);
  } catch {
    return null;
  }
  const [boards, jobs, failures] = await Promise.all([
    listBoards(),
    listJobs(rosterId),
    getFleetActivity({ status: 'failed', rosterId, limit: 1 }).catch(() => ({ items: [], truncated: false })),
  ]);
  const board = boards.find((b) => b.rosterId === entry.rosterId) ?? null;
  let cards: KanbanCard[] = [];
  if (board) {
    try {
      cards = (await getBoard(board.id)).cards;
    } catch {
      /* ignore */
    }
  }
  return buildView(entry, board, cards, jobs, failures.items.length > 0);
}
