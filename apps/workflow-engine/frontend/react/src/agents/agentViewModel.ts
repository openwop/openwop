/**
 * Agent view-model — composes the product-facing "AI coworker" from the
 * underlying host-extension surfaces (roster + board + cards + schedules).
 *
 * The product concept is the RosterEntry (PRD §18 data boundary). This module
 * hydrates each roster member with its board lane counts, its schedules, and a
 * derived status, so the dashboard cards + the workspace header read from one
 * consistent shape.
 */

import { listRoster, getRosterEntry, type RosterEntry } from './rosterClient.js';
import { listBoards, listBoardsWithCards, getBoard, type KanbanBoard, type KanbanCard } from '../kanban/kanbanClient.js';
import { listJobs, type ScheduledJob } from './scheduleClient.js';

export type AgentStatus = 'active' | 'working' | 'waiting' | 'paused' | 'needs-setup';

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
// chip classes live in global.css and theme correctly across every surface).
const STATUS_META: Record<AgentStatus, { label: string; chip: string }> = {
  active: { label: 'Active', chip: 'chip--success' },
  working: { label: 'Working', chip: 'chip--accent' },
  waiting: { label: 'Waiting on Human', chip: 'chip--warning' },
  paused: { label: 'Paused', chip: 'chip--muted' },
  'needs-setup': { label: 'Needs setup', chip: 'chip--danger' },
};

export function statusMeta(status: AgentStatus): { label: string; chip: string } {
  return STATUS_META[status];
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

function deriveStatus(entry: RosterEntry, board: KanbanBoard | null, counts: LaneCounts): AgentStatus {
  if (!entry.enabled) return 'paused';
  if (entry.workflows.length === 0 || !board) return 'needs-setup';
  if (counts.working > 0) return 'working';
  if (counts.waiting > 0) return 'waiting';
  return 'active';
}

function buildView(entry: RosterEntry, board: KanbanBoard | null, cards: KanbanCard[], jobs: ScheduledJob[]): AgentView {
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
    status: deriveStatus(entry, board, laneCounts),
    jobs: myJobs,
    nextSchedule: myJobs.find((j) => j.enabled) ?? null,
  };
}

/** Load every agent's view (dashboard) in exactly THREE requests — roster +
 *  boards-with-cards (one batched `?include=cards` call, not N+1) + jobs — so a
 *  dashboard with many agents doesn't trip the per-IP read rate limit. */
export async function loadAgentViews(): Promise<AgentView[]> {
  const [roster, boards, jobs] = await Promise.all([listRoster(), listBoardsWithCards(), listJobs()]);
  return roster.map((entry) => {
    const board = boards.find((b) => b.rosterId === entry.rosterId) ?? null;
    return buildView(entry, board, board?.cards ?? [], jobs);
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
  const [boards, jobs] = await Promise.all([listBoards(), listJobs(rosterId)]);
  const board = boards.find((b) => b.rosterId === entry.rosterId) ?? null;
  let cards: KanbanCard[] = [];
  if (board) {
    try {
      cards = (await getBoard(board.id)).cards;
    } catch {
      /* ignore */
    }
  }
  return buildView(entry, board, cards, jobs);
}
