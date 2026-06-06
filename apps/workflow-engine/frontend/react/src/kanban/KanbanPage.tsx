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
 * Boards-redesign layout (2026-06-05, Claude Design mock in our tokens):
 * switcher PILLS with the owner's avatar, live card count, and an amber
 * attention dot for boards with waiting cards; a board header naming the
 * owner, trigger workflow, and waiting count, with an overflow menu
 * (Duplicate / Delete — Rename intentionally absent until the host grows a
 * board-PATCH endpoint; no fake affordances); the inline create form is now
 * the Create-a-board modal.
 *
 * Tenant scoping is server-side (board ownership from the caller's
 * principal); the page never sends a tenantId. Drag-drop via @dnd-kit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listRoster, type RosterEntry } from '../agents/rosterClient.js';
import { roleThemeForAgent, workflowName } from '../agents/roleTemplates.js';
import { AgentAvatar } from '../agents/AgentAvatar.js';
import { Notice } from '../ui/Notice.js';
import { StateCard } from '../ui/StateCard.js';
import { PageHeader } from '../ui/PageHeader.js';
import { IconButton } from '../ui/IconButton.js';
import { AlertIcon, ColumnsIcon, DotsIcon, PencilIcon, TrashIcon, WorkflowIcon } from '../ui/icons/index.js';
import { KanbanBoardView, type NewCardInput } from './KanbanBoardView.js';
import { CreateBoardModal } from './CreateBoardModal.js';
import {
  createBoard,
  createCard,
  deleteBoard,
  patchBoard,
  deleteCard,
  getBoard,
  listBoardsWithCards,
  patchCard,
  subscribeBoardEvents,
  type KanbanBoard,
  type KanbanBoardWithCards,
  type KanbanCard,
} from './kanbanClient.js';

/** Waiting-lane cards on a board (drives the pill dot + the header chip). */
function waitingCount(columns: KanbanBoard['columns'], cards: readonly KanbanCard[]): number {
  const waitingCols = new Set(
    columns
      .filter((c) => c.id.toLowerCase() === 'waiting' || c.name.toLowerCase().startsWith('waiting'))
      .map((c) => c.id),
  );
  return cards.filter((c) => waitingCols.has(c.columnId)).length;
}

/** The board's overflow menu — Rename / Duplicate / Delete. */
function BoardMenu({ onRename, onDuplicate, onDelete }: {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onAway = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onAway);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="board-menu" ref={rootRef}>
      <IconButton
        label="Board actions"
        icon={<DotsIcon size={16} />}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div className="board-menu-pop surface-card" role="menu">
          <button type="button" role="menuitem" className="board-menu-item" onClick={() => { setOpen(false); onRename(); }}>
            <PencilIcon size={14} aria-hidden /> Rename board
          </button>
          <button type="button" role="menuitem" className="board-menu-item" onClick={() => { setOpen(false); onDuplicate(); }}>
            <ColumnsIcon size={14} aria-hidden /> Duplicate
          </button>
          <div className="board-menu-rule" />
          <button type="button" role="menuitem" className="board-menu-item board-menu-item--danger" onClick={() => { setOpen(false); onDelete(); }}>
            <TrashIcon size={14} aria-hidden /> Delete board
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function KanbanPage(): JSX.Element {
  const [boards, setBoards] = useState<KanbanBoardWithCards[]>([]);
  const [activeBoard, setActiveBoard] = useState<KanbanBoard | null>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Roster members boards can be bound to (RFC 0086): the owner's avatar
  // renders in the switcher pill and the board header.
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  const refreshBoards = useCallback(async () => {
    try {
      setBoards(await listBoardsWithCards());
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

  // Auto-open the first board so the page never greets with an empty shell
  // (decision-first: show the work, not a picker).
  useEffect(() => {
    if (!activeBoard && boards.length > 0) void openBoard(boards[0].id);
  }, [boards, activeBoard, openBoard]);

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
    // Visibility-gated polling (GAP-ANALYSIS E3): a hidden tab does not spend
    // the per-IP read budget; returning to the tab refreshes immediately so it
    // is never stale on focus.
    const poll = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeBoard?.id, openBoard]);

  const onCreateBoard = async (input: { name: string; triggerWorkflowId?: string; rosterId?: string }) => {
    try {
      const board = await createBoard(input);
      setCreating(false);
      await refreshBoards();
      await openBoard(board.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Duplicate = a new board with the same trigger/owner + a copy of every
  // card — composed entirely from existing create APIs.
  const onDuplicateBoard = async () => {
    if (!activeBoard) return;
    try {
      const todoCol = activeBoard.columns.find((c) => c.triggerWorkflowId);
      const copy = await createBoard({
        name: `${activeBoard.name} copy`,
        ...(todoCol?.triggerWorkflowId ? { triggerWorkflowId: todoCol.triggerWorkflowId } : {}),
        ...(activeBoard.rosterId ? { rosterId: activeBoard.rosterId } : {}),
      });
      for (const card of [...cards].sort((a, b) => a.order - b.order)) {
        await createCard(copy.id, {
          title: card.title,
          columnId: card.columnId,
          ...(card.description ? { description: card.description } : {}),
          ...(card.source ? { source: card.source } : {}),
          ...(card.workflowId ? { workflowId: card.workflowId } : {}),
          ...(card.priority ? { priority: card.priority } : {}),
          ...(card.dueAt ? { dueAt: card.dueAt } : {}),
          ...(card.assignmentReason ? { assignmentReason: card.assignmentReason } : {}),
          ...(card.blockerNote ? { blockerNote: card.blockerNote } : {}),
        });
      }
      setNotice(`Duplicated "${activeBoard.name}" — now viewing the copy.`);
      await refreshBoards();
      await openBoard(copy.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRenameBoard = async () => {
    if (!activeBoard) return;
    const next = window.prompt('Rename board', activeBoard.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === activeBoard.name) return;
    try {
      const renamed = await patchBoard(activeBoard.id, { name });
      setActiveBoard(renamed);
      setNotice(`Renamed to "${renamed.name}".`);
      await refreshBoards();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeleteBoard = async () => {
    if (!activeBoard) return;
    const board = activeBoard;
    if (!window.confirm(`Delete the board "${board.name}"? This removes the board and all its cards and can't be undone.`)) return;
    try {
      await deleteBoard(board.id);
      setActiveBoard(null);
      setCards([]);
      await refreshBoards();
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
      await refreshBoards();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeleteCard = async (cardId: string) => {
    if (!activeBoard) return;
    const card = cards.find((c) => c.id === cardId);
    if (!window.confirm(`Delete the card${card ? ` “${card.title}”` : ''}? This can't be undone.`)) return;
    try {
      await deleteCard(cardId);
      await openBoard(activeBoard.id);
      await refreshBoards();
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
      await refreshBoards();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await openBoard(activeBoard.id); // rollback to server truth
    }
  };

  const rosterById = new Map(roster.map((r) => [r.rosterId, r]));
  const owner = activeBoard?.rosterId ? rosterById.get(activeBoard.rosterId) : undefined;
  const activeTrigger = activeBoard?.columns.find((c) => c.triggerWorkflowId)?.triggerWorkflowId;
  const activeWaiting = activeBoard ? waitingCount(activeBoard.columns, cards) : 0;

  return (
    <section>
      <PageHeader
        eyebrow="Boards"
        title="Boards"
        lede={<>The same task boards your agents work from. Drag a card into the ⚡ <strong>To do</strong> column to fire its workflow.</>}
        actions={<button type="button" className="btn-accent-solid" onClick={() => setCreating(true)}>+ New board</button>}
      />

      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}

      {/* Switcher pills: owner avatar · name · live count · attention dot. */}
      <div className="board-pills" role="tablist" aria-label="Boards">
        {boards.map((b) => {
          const o = b.rosterId ? rosterById.get(b.rosterId) : undefined;
          const waiting = waitingCount(b.columns, b.cards);
          const active = activeBoard?.id === b.id;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? 'board-pill is-active' : 'board-pill'}
              onClick={() => void openBoard(b.id)}
            >
              {o ? (
                <AgentAvatar
                  persona={o.persona}
                  avatarUrl={o.avatarUrl}
                  roleTheme={roleThemeForAgent(o.agentRef?.agentId, o.workflows)}
                  size={18}
                  showBadge={false}
                />
              ) : null}
              <span className="board-pill-name">{b.name}</span>
              <span className="board-pill-count">{b.cards.length}</span>
              {waiting > 0 ? <span className="board-pill-dot" title={`${waiting} waiting on you`} aria-label={`${waiting} waiting on you`} /> : null}
            </button>
          );
        })}
        <button type="button" className="board-pill board-pill--new" onClick={() => setCreating(true)}>
          + New board
        </button>
      </div>

      {activeBoard ? (
        <>
          <div className="board-head">
            <h2 className="board-head-name">{activeBoard.name}</h2>
            {owner ? (
              <span className="board-head-owner">
                <AgentAvatar
                  persona={owner.persona}
                  avatarUrl={owner.avatarUrl}
                  roleTheme={roleThemeForAgent(owner.agentRef?.agentId, owner.workflows)}
                  size={20}
                  showBadge={false}
                />
                {owner.persona}
              </span>
            ) : null}
            {activeTrigger ? (
              <span className="board-head-trigger">
                <WorkflowIcon size={13} aria-hidden /> Triggers:&nbsp;<strong>{workflowName(activeTrigger)}</strong>
              </span>
            ) : null}
            {activeWaiting > 0 ? (
              <span className="chip chip--warning">
                <AlertIcon size={11} aria-hidden /> {activeWaiting} waiting on you
              </span>
            ) : null}
            <span className="board-head-spacer" />
            <BoardMenu onRename={() => void onRenameBoard()} onDuplicate={() => void onDuplicateBoard()} onDelete={() => void onDeleteBoard()} />
          </div>

          <KanbanBoardView
            board={activeBoard}
            cards={cards}
            ownerPersona={owner?.persona}
            onMoveCard={(cardId, toColumnId) => void onMoveCard(cardId, toColumnId)}
            onCreateCard={(columnId, input) => void onCreateCard(columnId, input)}
            onDeleteCard={(cardId) => void onDeleteCard(cardId)}
          />
        </>
      ) : (
        <StateCard
          icon={<ColumnsIcon size={26} />}
          title="No boards yet"
          body="Create a board to start tracking work — connect a workflow and it fires when cards hit the ⚡ trigger column."
          action={<button type="button" className="btn-accent-solid btn-sm" onClick={() => setCreating(true)}>+ New board</button>}
        />
      )}

      {creating ? <CreateBoardModal roster={roster} onClose={() => setCreating(false)} onCreate={(input) => void onCreateBoard(input)} /> : null}
    </section>
  );
}
