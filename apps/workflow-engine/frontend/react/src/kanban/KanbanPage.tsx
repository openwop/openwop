/**
 * `/boards` route — Kanban boards (RFCS/0086 "named workflow agents" demo).
 *
 * A board's columns are drop zones; cards are draggable. Dragging a card
 * into a column that names a workflow (the board's trigger column, "To Do"
 * by default) starts a workflow run — the host returns the started
 * `triggeredRunId`, which this page surfaces as a link to the run. This is
 * the digital-twin-employee surface: a card landing in To Do fires the
 * agent's workflow.
 *
 * Tenant scoping is server-side (board ownership from the caller's
 * principal); the page never sends a tenantId. Drag-drop via @dnd-kit.
 */

import { useCallback, useEffect, useState } from 'react';
import { listRoster, type RosterEntry } from '../agents/rosterClient.js';
import { Notice } from '../ui/Notice.js';
import { StateCard } from '../ui/StateCard.js';
import { PageHeader } from '../ui/PageHeader.js';
import { ColumnsIcon } from '../ui/icons/index.js';
import { KanbanBoardView, type NewCardInput } from './KanbanBoardView.js';
import {
  createBoard,
  createCard,
  deleteBoard,
  deleteCard,
  getBoard,
  listBoards,
  patchCard,
  subscribeBoardEvents,
  type KanbanBoard,
  type KanbanCard,
} from './kanbanClient.js';

export function KanbanPage(): JSX.Element {
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [activeBoard, setActiveBoard] = useState<KanbanBoard | null>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState('');
  const [newTriggerWf, setNewTriggerWf] = useState('');
  // Roster members the new board can be bound to (RFC 0086): binding defaults
  // the To Do column to the member's first portfolio workflow + attributes
  // triggered runs to the member.
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [newRosterId, setNewRosterId] = useState('');

  const refreshBoards = useCallback(async () => {
    try {
      setBoards(await listBoards());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openBoard = useCallback(async (boardId: string) => {
    try {
      const { board, cards: c } = await getBoard(boardId);
      setActiveBoard(board);
      setCards(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshBoards();
    void listRoster().then(setRoster).catch(() => { /* roster optional */ });
  }, [refreshBoards]);

  // Live refresh: while a board is open, refetch on any change (this client's
  // moves, another client's, or a triggered run updating a card's lastRunId).
  // Two mechanisms:
  //   1. SSE change stream — instant push, when reachable (same-site / direct).
  //   2. Polling (~5s) — the reliable floor. The in-browser /api path is
  //      proxied by Firebase Hosting, which buffers `text/event-stream`, so the
  //      SSE push does not flush through the CDN; polling keeps the board fresh
  //      regardless. Both simply refetch the open board.
  useEffect(() => {
    const boardId = activeBoard?.id;
    if (!boardId) return;
    const refresh = () => { void openBoard(boardId); };
    const unsubscribe = subscribeBoardEvents(boardId, refresh);
    const poll = setInterval(refresh, 5000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [activeBoard?.id, openBoard]);

  const onCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    try {
      const board = await createBoard({
        name: newBoardName.trim(),
        triggerWorkflowId: newTriggerWf.trim() || undefined,
        rosterId: newRosterId || undefined,
      });
      setNewBoardName('');
      setNewTriggerWf('');
      setNewRosterId('');
      await refreshBoards();
      await openBoard(board.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onCreateCard = async (columnId: string, input: NewCardInput) => {
    if (!activeBoard) return;
    try {
      // Forward every field the shared add-card form collects (description /
      // priority / due / source) — not just the title.
      await createCard(activeBoard.id, {
        title: input.title,
        columnId,
        ...(input.description ? { description: input.description } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        ...(input.assignmentReason ? { assignmentReason: input.assignmentReason } : {}),
        ...(input.blockerNote ? { blockerNote: input.blockerNote } : {}),
      });
      await openBoard(activeBoard.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeleteCard = async (cardId: string) => {
    if (!activeBoard) return;
    try {
      await deleteCard(cardId);
      await openBoard(activeBoard.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onMoveCard = async (cardId: string, toColumnId: string) => {
    if (!activeBoard) return;
    const card = cards.find((c) => c.id === cardId);
    try {
      const { triggeredRunId } = await patchCard(cardId, { columnId: toColumnId });
      if (triggeredRunId && card) setNotice(`Started a run from "${card.title}" — it landed in a ⚡ trigger lane.`);
      await openBoard(activeBoard.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await openBoard(activeBoard.id); // rollback to server truth
    }
  };

  return (
    <section style={{ padding: '1rem' }}>
      <PageHeader
        eyebrow="Boards"
        title="Boards"
        lede={<>Drag a card into a <strong>trigger column</strong> (⚡) to start its workflow — the same task board your agents work from.</>}
      />

      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            className={activeBoard?.id === b.id ? 'primary' : 'secondary'}
            onClick={() => void openBoard(b.id)}
          >
            {b.name}
          </button>
        ))}
        {activeBoard ? (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await deleteBoard(activeBoard.id);
              setActiveBoard(null);
              setCards([]);
              await refreshBoards();
            }}
          >
            Delete board
          </button>
        ) : null}
      </div>

      <form onSubmit={onCreateBoard} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
        <input value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)} placeholder="New board name…" />
        <input
          value={newTriggerWf}
          onChange={(e) => setNewTriggerWf(e.target.value)}
          placeholder="To Do trigger workflowId (optional)"
          style={{ minWidth: 260 }}
        />
        <select
          value={newRosterId}
          onChange={(e) => setNewRosterId(e.target.value)}
          aria-label="Bind to a roster agent (optional)"
          title="Bind to a named agent — its To Do column fires the agent's first portfolio workflow"
        >
          <option value="">— no agent —</option>
          {roster.map((r) => (
            <option key={r.rosterId} value={r.rosterId}>{r.persona}</option>
          ))}
        </select>
        <button type="submit" className="primary">
          Create board
        </button>
      </form>

      {activeBoard ? (
        <KanbanBoardView
          board={activeBoard}
          cards={cards}
          onMoveCard={(cardId, toColumnId) => void onMoveCard(cardId, toColumnId)}
          onCreateCard={(columnId, input) => void onCreateCard(columnId, input)}
          onDeleteCard={(cardId) => void onDeleteCard(cardId)}
        />
      ) : (
        <StateCard
          icon={<ColumnsIcon size={26} />}
          title="No board open"
          body="Pick a board from the tabs above, or use the form above to create one and start tracking work."
        />
      )}
    </section>
  );
}
