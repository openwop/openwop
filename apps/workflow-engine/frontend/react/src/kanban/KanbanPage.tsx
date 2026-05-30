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
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Link } from 'react-router-dom';
import { listRoster, type RosterEntry } from '../agents/rosterClient.js';
import {
  createBoard,
  createCard,
  deleteBoard,
  getBoard,
  listBoards,
  patchCard,
  subscribeBoardEvents,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
} from './kanbanClient.js';

function CardChip({ card }: { card: KanbanCard }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    borderRadius: 8,
    padding: '0.5rem 0.6rem',
    marginBottom: '0.5rem',
    cursor: 'grab',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{card.title}</div>
      {card.description ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{card.description}</div>
      ) : null}
      {card.workflowId ? (
        <div style={{ fontSize: '0.72rem', color: 'var(--color-accent)', marginTop: 4 }}>⚙ {card.workflowId}</div>
      ) : null}
      {card.lastRunId ? (
        <div style={{ fontSize: '0.72rem', marginTop: 4 }}>
          <Link to={`/runs/${card.lastRunId}`}>▶ run {card.lastRunId.slice(0, 8)}</Link>
        </div>
      ) : null}
    </div>
  );
}

function Column({
  column,
  cards,
  onAddCard,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  onAddCard: (columnId: string, title: string) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: '1 1 0',
        minWidth: 220,
        background: isOver ? 'var(--clay-wash)' : 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: '0.6rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <strong style={{ fontSize: '0.85rem' }}>{column.name}</strong>
        {column.triggerWorkflowId ? <span title={`fires ${column.triggerWorkflowId}`}>⚡</span> : null}
      </div>
      {cards.map((c) => (
        <CardChip key={c.id} card={c} />
      ))}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) onAddCard(column.id, title.trim());
            setTitle('');
            setAdding(false);
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title…"
            style={{ width: '100%', fontSize: '0.85rem' }}
            onBlur={() => setAdding(false)}
          />
        </form>
      ) : (
        <button type="button" className="secondary" style={{ width: '100%', fontSize: '0.8rem' }} onClick={() => setAdding(true)}>
          + Add card
        </button>
      )}
    </div>
  );
}

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
  // PointerSensor for mouse/touch + KeyboardSensor so the board is
  // operable without a pointer (a11y): focus a card, Space to pick up,
  // arrow keys to move, Space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

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

  // Live refresh: while a board is open, subscribe to its SSE change stream
  // and refetch on any change (this client's moves, another client's, or a
  // triggered run updating a card's lastRunId).
  useEffect(() => {
    const boardId = activeBoard?.id;
    if (!boardId) return;
    const unsubscribe = subscribeBoardEvents(boardId, () => { void openBoard(boardId); });
    return unsubscribe;
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

  const onAddCard = async (columnId: string, title: string) => {
    if (!activeBoard) return;
    try {
      await createCard(activeBoard.id, { title, columnId });
      await openBoard(activeBoard.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const cardId = String(event.active.id);
    const toColumnId = event.over ? String(event.over.id) : null;
    if (!activeBoard || !toColumnId) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.columnId === toColumnId) return;
    // Optimistic move.
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId } : c)));
    try {
      const { triggeredRunId } = await patchCard(cardId, { columnId: toColumnId });
      if (triggeredRunId) setNotice(`Started run ${triggeredRunId.slice(0, 8)} from "${card.title}"`);
      await openBoard(activeBoard.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await openBoard(activeBoard.id); // rollback to server truth
    }
  };

  return (
    <section style={{ padding: '1rem' }}>
      <h1 style={{ marginTop: 0 }}>Boards</h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: '-0.5rem' }}>
        Kanban work surface — drag a card into a <strong>trigger column</strong> (⚡) to start its workflow run. The
        digital-twin-employee demo (RFC 0086).
      </p>

      {error ? <div style={{ color: 'var(--color-danger)' }}>⚠ {error}</div> : null}
      {notice ? <div style={{ color: 'var(--color-success)' }}>✓ {notice}</div> : null}

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
        <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            {activeBoard.columns.map((col) => (
              <Column
                key={col.id}
                column={col}
                cards={cards.filter((c) => c.columnId === col.id).sort((a, b) => a.order - b.order)}
                onAddCard={(columnId, title) => void onAddCard(columnId, title)}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <p style={{ color: 'var(--color-text-muted)' }}>Select or create a board to begin.</p>
      )}
    </section>
  );
}
