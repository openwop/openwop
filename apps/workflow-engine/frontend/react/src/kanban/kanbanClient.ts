/**
 * Kanban host-extension client (RFCS/0086 "named workflow agents" demo).
 *
 *   GET    /v1/host/sample/kanban/boards                  → { boards }
 *   POST   /v1/host/sample/kanban/boards                  → board
 *   GET    /v1/host/sample/kanban/boards/:boardId         → { board, cards }
 *   DELETE /v1/host/sample/kanban/boards/:boardId
 *   POST   /v1/host/sample/kanban/boards/:boardId/cards   → card
 *   PATCH  /v1/host/sample/kanban/cards/:cardId           → { card, triggeredRunId }
 *   DELETE /v1/host/sample/kanban/cards/:cardId
 *
 * Tenant scoping is the backend's job (board ownership from the caller's
 * principal); the client never sends a tenantId. A `columnId` change on
 * PATCH MOVES the card — and a move into a trigger column starts a run,
 * whose id comes back as `triggeredRunId`.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';

export interface KanbanColumn {
  id: string;
  name: string;
  triggerWorkflowId?: string;
}

export type KanbanCardSource = 'human' | 'workflow' | 'agent' | 'discord' | 'schedule' | 'api';

export interface KanbanCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  workflowId?: string;
  lastRunId?: string;
  source?: KanbanCardSource;
  sourceLabel?: string;
  priority?: 'low' | 'normal' | 'high';
  dueAt?: string;
  /** Who created the task (the source chip says HOW it arrived; this says WHO). */
  createdBy?: string;
  /** Why this task is assigned to the board's agent (the "why Sally?" answer). */
  assignmentReason?: string;
  /** Free-text note on what's blocking the task (lightweight; not a graph). */
  blockerNote?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanBoard {
  id: string;
  tenantId: string;
  name: string;
  columns: KanbanColumn[];
  rosterId?: string;
  createdAt: string;
  updatedAt: string;
}

const base = `${config.baseUrl}/v1/host/sample/kanban`;
const jsonHeaders = (): HeadersInit => authedHeaders({ 'content-type': 'application/json' });

export async function listBoards(): Promise<KanbanBoard[]> {
  const res = await fetch(`${base}/boards`, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`listBoards returned ${res.status}`);
  return ((await res.json()) as { boards: KanbanBoard[] }).boards;
}

export type KanbanBoardWithCards = KanbanBoard & { cards: KanbanCard[] };

/** Boards + their cards in ONE request (`?include=cards`). Lets the agents
 *  dashboard render every agent's lane preview without an N+1 `getBoard`. */
export async function listBoardsWithCards(): Promise<KanbanBoardWithCards[]> {
  const res = await fetch(`${base}/boards?include=cards`, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`listBoardsWithCards returned ${res.status}`);
  return ((await res.json()) as { boards: KanbanBoardWithCards[] }).boards;
}

export async function createBoard(input: {
  name: string;
  triggerWorkflowId?: string;
  rosterId?: string;
  columns?: KanbanColumn[];
}): Promise<KanbanBoard> {
  const res = await fetch(`${base}/boards`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  if (!res.ok) throw new Error(`createBoard returned ${res.status}`);
  return (await res.json()) as KanbanBoard;
}

export async function getBoard(boardId: string): Promise<{ board: KanbanBoard; cards: KanbanCard[] }> {
  const res = await fetch(`${base}/boards/${encodeURIComponent(boardId)}`, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`getBoard returned ${res.status}`);
  return (await res.json()) as { board: KanbanBoard; cards: KanbanCard[] };
}

/** Rename a board — `name` is the only mutable field (owner/columns are
 *  deliberately immutable via PATCH; see the route's architect note). */
export async function patchBoard(boardId: string, input: { name: string }): Promise<KanbanBoard> {
  const res = await fetch(`${base}/boards/${encodeURIComponent(boardId)}`, fetchOpts({
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(input),
  }));
  if (!res.ok) throw new Error(`patchBoard returned ${res.status}`);
  return (await res.json()) as KanbanBoard;
}

export async function deleteBoard(boardId: string): Promise<void> {
  const res = await fetch(`${base}/boards/${encodeURIComponent(boardId)}`, fetchOpts({ method: 'DELETE', headers: authedHeaders() }));
  if (!res.ok) throw new Error(`deleteBoard returned ${res.status}`);
}

export async function createCard(
  boardId: string,
  input: {
    title: string;
    columnId: string;
    description?: string;
    workflowId?: string;
    source?: KanbanCardSource;
    sourceLabel?: string;
    priority?: 'low' | 'normal' | 'high';
    dueAt?: string;
    createdBy?: string;
    assignmentReason?: string;
    blockerNote?: string;
  },
): Promise<KanbanCard> {
  const res = await fetch(
    `${base}/boards/${encodeURIComponent(boardId)}/cards`,
    fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }),
  );
  if (!res.ok) throw new Error(`createCard returned ${res.status}`);
  return (await res.json()) as KanbanCard;
}

/** PATCH a card. A `columnId` change moves it; the response carries the
 *  started run id (or null) when the move lands in a trigger column. */
export async function patchCard(
  cardId: string,
  patch: {
    title?: string;
    description?: string;
    workflowId?: string;
    columnId?: string;
    source?: KanbanCardSource;
    sourceLabel?: string;
    priority?: 'low' | 'normal' | 'high';
    dueAt?: string;
    createdBy?: string;
    assignmentReason?: string;
    blockerNote?: string;
  },
): Promise<{ card: KanbanCard; triggeredRunId: string | null }> {
  const res = await fetch(
    `${base}/cards/${encodeURIComponent(cardId)}`,
    fetchOpts({ method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) }),
  );
  if (!res.ok) throw new Error(`patchCard returned ${res.status}`);
  return (await res.json()) as { card: KanbanCard; triggeredRunId: string | null };
}

/**
 * Subscribe to a board's live-change stream (SSE). Calls `onChange` whenever
 * the board's cards/columns change (from this or another client), so the page
 * can refetch. Uses a fetch-based reader (not native EventSource) so the
 * bearer Authorization header is sent; cookie mode works via credentials.
 * Returns an unsubscribe fn (aborts the stream).
 */
export function subscribeBoardEvents(boardId: string, onChange: () => void): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const res = await fetch(
        `${base}/boards/${encodeURIComponent(boardId)}/events`,
        fetchOpts({ headers: authedHeaders({ accept: 'text/event-stream' }), signal: controller.signal }),
      );
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // A `board.changed` event line is enough to trigger a refetch; we
        // don't parse the data payload (the client re-reads the board).
        if (buf.includes('event: board.changed')) {
          buf = '';
          onChange();
        } else if (buf.length > 8192) {
          buf = buf.slice(-1024); // bound the buffer between events/heartbeats
        }
      }
    } catch {
      /* aborted or network drop — caller may resubscribe */
    }
  })();
  return () => controller.abort();
}

export async function deleteCard(cardId: string): Promise<void> {
  const res = await fetch(`${base}/cards/${encodeURIComponent(cardId)}`, fetchOpts({ method: 'DELETE', headers: authedHeaders() }));
  if (!res.ok) throw new Error(`deleteCard returned ${res.status}`);
}
