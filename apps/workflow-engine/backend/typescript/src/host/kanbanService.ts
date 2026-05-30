/**
 * Kanban boards — host extension (sample-grade, non-normative).
 *
 * A demo work surface for the "named workflow agents" story (RFCS/0086
 * Standing Agent Roster + RFCS/0087 Agent Org-Chart): cards represent
 * work items; moving a card INTO a trigger-enabled column starts a
 * workflow run — the "new artifact lands in the To Do column → run a
 * workflow" pattern. The board itself is deliberately NOT a normative
 * protocol surface (RFC 0086 §E keeps the concrete work surface a
 * host/vendor extension; only the run attribution + the durable trigger
 * bridge are protocol concerns). The card→run wiring composes the
 * existing run surface — a card move resolves to a normal `POST /v1/runs`
 * equivalent (see routes/kanban.ts), so replay/fork/observability are
 * inherited unchanged.
 *
 * The store is process-local (sample-grade), mirroring host/
 * schedulingService.ts; a production host backs it with a durable store
 * (and, per RFC 0083, bridges a card-moved event into a durable trigger
 * subscription). This module is pure: `moveCard` returns a trigger
 * DIRECTIVE rather than starting a run itself, so the route handler
 * (which holds `storage` + `hostSuite`) owns the side effects and this
 * service stays testable in isolation.
 *
 * @see RFCS/0086-standing-agent-roster-and-workflow-portfolio.md §D/§E
 * @see RFCS/0087-agent-org-chart.md
 * @see src/host/schedulingService.ts — the process-local host-ext precedent
 */

import { randomUUID } from 'node:crypto';

/** A column on a board. When `triggerWorkflowId` is set, any card moved
 *  into this column starts that workflow (unless the card overrides it
 *  with its own `workflowId`). A "To Do" column is the canonical
 *  trigger column. */
export interface KanbanColumn {
  id: string;
  name: string;
  /** Column-level default workflow fired when a card enters this column.
   *  A card's own `workflowId` takes precedence. */
  triggerWorkflowId?: string;
}

/** A card (work item). `workflowId` is the card-level override of the
 *  destination column's `triggerWorkflowId`. `order` is the position
 *  within its column (ascending). */
export interface KanbanCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  workflowId?: string;
  /** Set to the runId of the most recent run this card triggered. */
  lastRunId?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanBoard {
  id: string;
  tenantId: string;
  name: string;
  columns: KanbanColumn[];
  /** Optional RFCS/0086 roster member that OWNS this board. When set, a
   *  card→run trigger attributes the run to this named agent (persona). */
  rosterId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Returned by `moveCard` when the destination column resolves a workflow
 *  to fire. The route handler turns this into a run. */
export interface KanbanTriggerDirective {
  workflowId: string;
  boardId: string;
  cardId: string;
  fromColumnId: string;
  toColumnId: string;
}

/** The default column set for a new board — the canonical To Do / Doing /
 *  Done lanes, with To Do flagged as the trigger column when a board is
 *  created with a `triggerWorkflowId`. */
export const DEFAULT_COLUMNS: ReadonlyArray<Omit<KanbanColumn, 'triggerWorkflowId'>> = [
  { id: 'todo', name: 'To Do' },
  { id: 'doing', name: 'Doing' },
  { id: 'done', name: 'Done' },
];

const boards = new Map<string, KanbanBoard>();
const cards = new Map<string, KanbanCard>();

function nowIso(): string {
  return new Date().toISOString();
}

export function createBoard(input: {
  tenantId: string;
  name: string;
  columns?: KanbanColumn[];
  /** When set, the default "To Do" column fires this workflow on card entry. */
  triggerWorkflowId?: string;
  /** Optional RFCS/0086 roster member that owns this board (attribution). */
  rosterId?: string;
}): KanbanBoard {
  const id = `board-${randomUUID()}`;
  const now = nowIso();
  const columns: KanbanColumn[] = input.columns
    ? input.columns.map((c) => ({ ...c }))
    : DEFAULT_COLUMNS.map((c) =>
        c.id === 'todo' && input.triggerWorkflowId
          ? { ...c, triggerWorkflowId: input.triggerWorkflowId }
          : { ...c },
      );
  const board: KanbanBoard = {
    id,
    tenantId: input.tenantId,
    name: input.name,
    columns,
    rosterId: input.rosterId,
    createdAt: now,
    updatedAt: now,
  };
  boards.set(id, board);
  return board;
}

export function listBoards(tenantId: string): KanbanBoard[] {
  return [...boards.values()]
    .filter((b) => b.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getBoard(boardId: string): KanbanBoard | undefined {
  return boards.get(boardId);
}

export function deleteBoard(boardId: string): boolean {
  for (const card of [...cards.values()]) {
    if (card.boardId === boardId) cards.delete(card.id);
  }
  return boards.delete(boardId);
}

export function listCards(boardId: string): KanbanCard[] {
  return [...cards.values()]
    .filter((c) => c.boardId === boardId)
    .sort((a, b) => a.columnId.localeCompare(b.columnId) || a.order - b.order);
}

export function getCard(cardId: string): KanbanCard | undefined {
  return cards.get(cardId);
}

export function createCard(input: {
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  workflowId?: string;
}): KanbanCard {
  const id = `card-${randomUUID()}`;
  const now = nowIso();
  const siblings = [...cards.values()].filter(
    (c) => c.boardId === input.boardId && c.columnId === input.columnId,
  );
  const card: KanbanCard = {
    id,
    boardId: input.boardId,
    columnId: input.columnId,
    title: input.title,
    description: input.description,
    workflowId: input.workflowId,
    order: siblings.length,
    createdAt: now,
    updatedAt: now,
  };
  cards.set(id, card);
  return card;
}

export function updateCardFields(
  cardId: string,
  patch: { title?: string; description?: string; workflowId?: string },
): KanbanCard | undefined {
  const card = cards.get(cardId);
  if (!card) return undefined;
  if (patch.title !== undefined) card.title = patch.title;
  if (patch.description !== undefined) card.description = patch.description;
  if (patch.workflowId !== undefined) card.workflowId = patch.workflowId;
  card.updatedAt = nowIso();
  return card;
}

export function deleteCard(cardId: string): boolean {
  return cards.delete(cardId);
}

/** Record the run a card triggered (set by the route after starting it). */
export function setCardLastRun(cardId: string, runId: string): void {
  const card = cards.get(cardId);
  if (card) {
    card.lastRunId = runId;
    card.updatedAt = nowIso();
  }
}

/**
 * Move a card to a new column. Returns the moved card plus an optional
 * trigger directive: when the destination column (or the card itself)
 * names a workflow, the route handler starts a run for it. A move within
 * the same column is a no-op trigger-wise (re-entering To Do does not
 * re-fire — the directive is only returned when `fromColumnId !==
 * toColumnId`). Returns `null` when the card or destination column is
 * unknown.
 */
export function moveCard(
  cardId: string,
  toColumnId: string,
): { card: KanbanCard; trigger: KanbanTriggerDirective | null } | null {
  const card = cards.get(cardId);
  if (!card) return null;
  const board = boards.get(card.boardId);
  if (!board) return null;
  const destColumn = board.columns.find((c) => c.id === toColumnId);
  if (!destColumn) return null;

  const fromColumnId = card.columnId;
  if (fromColumnId === toColumnId) {
    return { card, trigger: null };
  }

  const siblings = [...cards.values()].filter(
    (c) => c.boardId === card.boardId && c.columnId === toColumnId,
  );
  card.columnId = toColumnId;
  card.order = siblings.length;
  card.updatedAt = nowIso();

  const workflowId = card.workflowId ?? destColumn.triggerWorkflowId;
  const trigger: KanbanTriggerDirective | null = workflowId
    ? { workflowId, boardId: card.boardId, cardId, fromColumnId, toColumnId }
    : null;
  return { card, trigger };
}

// --- live board-change fan-out (for the SSE board-events stream) ---
//
// A board mutation (card create/move/delete, board delete) notifies
// in-process subscribers so an open SSE stream can tell connected clients to
// refetch — multi-client live board refresh. Process-local + best-effort,
// mirroring the eventLog subscribe/append pattern; a multi-instance host backs
// this with a pub/sub bus.

type BoardChangeSubscriber = (boardId: string) => void;
const boardChangeSubscribers = new Set<BoardChangeSubscriber>();

/** Subscribe to board-change notifications. Returns an unsubscribe fn. */
export function subscribeBoardChanges(fn: BoardChangeSubscriber): () => void {
  boardChangeSubscribers.add(fn);
  return () => boardChangeSubscribers.delete(fn);
}

/** Notify subscribers that a board's contents changed. Best-effort. */
export function notifyBoardChanged(boardId: string): void {
  for (const fn of boardChangeSubscribers) {
    try {
      fn(boardId);
    } catch {
      /* swallow — a subscriber failure must not abort the mutation */
    }
  }
}

/** Test-only: drop all boards + cards. */
export function __resetKanbanStore(): void {
  boards.clear();
  cards.clear();
}
