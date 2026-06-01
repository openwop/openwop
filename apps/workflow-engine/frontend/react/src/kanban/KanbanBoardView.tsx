/**
 * KanbanBoardView — the ONE board renderer shared by the standalone `/boards`
 * page (KanbanPage) and the embedded agent-workspace Board tab
 * (AgentBoardPanel). Previously those were two divergent boards (drag-and-drop
 * vs a "Move" dropdown); this unifies them.
 *
 * Features:
 *  - @dnd-kit drag-and-drop (pointer + keyboard sensor — focus a card, Space to
 *    pick up, arrows to move, Space to drop) with an optimistic local move.
 *  - Rich cards: source chip, workflow name, priority, due date, run link.
 *  - Trigger columns (⚡) fire a workflow when a card lands in them.
 *  - Per-column count badge + add-card form (with an optional source selector).
 *
 * Presentational + interactive: it owns drag state but delegates persistence to
 * the parent via onMoveCard / onCreateCard / onDeleteCard, so each surface keeps
 * its own data-fetch + live-refresh wiring.
 */

import { useEffect, useState } from 'react';
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
import { TaskSourceChip } from '../agents/TaskSourceChip.js';
import { workflowName } from '../agents/roleTemplates.js';
import { PlayIcon, WorkflowIcon, XIcon, ZapIcon } from '../ui/icons/index.js';
import type { KanbanBoard, KanbanCard, KanbanColumn, KanbanCardSource } from './kanbanClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

/** The full create-card payload the add-card form can produce. */
export interface NewCardInput {
  title: string;
  source?: KanbanCardSource;
  description?: string;
  workflowId?: string;
  priority?: 'low' | 'normal' | 'high';
  dueAt?: string;
}

const SOURCE_OPTIONS: ReadonlyArray<{ value: KanbanCardSource; label: string }> = [
  { value: 'human', label: 'From a human' },
  { value: 'discord', label: 'Simulated Discord' },
  { value: 'agent', label: 'From another agent' },
  { value: 'api', label: 'From an API' },
];

function DraggableCard({
  card,
  onDelete,
}: {
  card: KanbanCard;
  onDelete?: (cardId: string) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    padding: 'var(--space-2) var(--space-2-5)',
    marginBottom: 'var(--space-2)',
  };
  return (
    <div
      ref={setNodeRef}
      className="surface-card"
      style={style}
      aria-label={`${card.title} — drag to move between lanes`}
      {...listeners}
      {...attributes}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <div style={{ fontWeight: 600, fontSize: '13px' }}>{card.title}</div>
        {onDelete ? (
          <button
            type="button"
            className="secondary btn-sm"
            aria-label={`Delete ${card.title}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}
          >
            <XIcon size={13} />
          </button>
        ) : null}
      </div>
      {card.description ? <div style={{ ...muted, fontSize: '12px', marginTop: 2 }}>{card.description}</div> : null}
      <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--space-1)' }}>
        {card.source ? <TaskSourceChip source={card.source} sourceLabel={card.sourceLabel} /> : null}
        {card.workflowId ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: '12px', color: 'var(--color-accent)' }}>
            <WorkflowIcon size={12} /> {workflowName(card.workflowId)}
          </span>
        ) : null}
        {card.priority === 'high' ? <span className="chip chip--danger">High</span> : null}
        {card.dueAt ? <span style={{ ...muted, fontSize: '12px' }}>due {card.dueAt.slice(0, 10)}</span> : null}
      </div>
      {card.lastRunId ? (
        <div style={{ fontSize: '12px', marginTop: 'var(--space-1)' }}>
          <Link to={`/runs/${card.lastRunId}`} onPointerDown={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <PlayIcon size={12} /> View run
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function DroppableColumn({
  column,
  cards,
  onAddCard,
  onDeleteCard,
  enableSources,
  workflowOptions,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  onAddCard: (columnId: string, input: NewCardInput) => void;
  onDeleteCard?: (cardId: string) => void;
  enableSources?: boolean;
  workflowOptions?: string[];
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<KanbanCardSource>('human');
  const [workflowId, setWorkflowId] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [dueAt, setDueAt] = useState('');
  const isTrigger = Boolean(column.triggerWorkflowId);
  const resetForm = (): void => { setTitle(''); setDescription(''); setSource('human'); setWorkflowId(''); setPriority('normal'); setDueAt(''); setAdding(false); };

  return (
    <div
      ref={setNodeRef}
      style={{
        flex: '1 1 0',
        minWidth: 200,
        background: isOver ? 'var(--clay-wash)' : 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderLeft: isTrigger ? '3px solid var(--color-accent)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-2)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <strong style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          {column.name}
          {isTrigger ? <ZapIcon size={13} style={{ color: 'var(--color-accent)' }} /> : null}
        </strong>
        <span style={{ ...muted, fontSize: '12px' }}>{cards.length}</span>
      </div>
      {cards.map((c) => (
        <DraggableCard key={c.id} card={c} onDelete={onDeleteCard} />
      ))}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onAddCard(column.id, {
              title: title.trim(),
              ...(enableSources ? { source } : {}),
              ...(description.trim() ? { description: description.trim() } : {}),
              ...(workflowId ? { workflowId } : {}),
              ...(priority !== 'normal' ? { priority } : {}),
              ...(dueAt ? { dueAt } : {}),
            });
            resetForm();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          <input autoFocus className="ui-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title…" style={{ width: '100%' }} />
          <textarea className="ui-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} style={{ width: '100%', fontFamily: 'inherit' }} />
          {enableSources ? (
            <select className="ui-input" value={source} onChange={(e) => setSource(e.target.value as KanbanCardSource)} aria-label="Task source" style={{ width: '100%' }}>
              {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : null}
          {workflowOptions && workflowOptions.length > 0 ? (
            <select className="ui-input" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} aria-label="Workflow" style={{ width: '100%' }}>
              <option value="">No workflow</option>
              {workflowOptions.map((w) => <option key={w} value={w}>{workflowName(w)}</option>)}
            </select>
          ) : null}
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            <select className="ui-input" value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'normal' | 'high')} aria-label="Priority" style={{ flex: 1 }}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
            <input className="ui-input" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="Due date" style={{ flex: 1 }} />
          </div>
          <div className="action-bar">
            <button type="submit" className="primary btn-sm">Add</button>
            <button type="button" className="secondary btn-sm" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary btn-sm" style={{ width: '100%' }} onClick={() => setAdding(true)}>+ Add card</button>
      )}
    </div>
  );
}

export function KanbanBoardView({
  board,
  cards,
  enableSources,
  workflowOptions,
  onMoveCard,
  onCreateCard,
  onDeleteCard,
}: {
  board: KanbanBoard;
  cards: KanbanCard[];
  enableSources?: boolean;
  /** Workflow ids the add-card form can attach (the owning agent's portfolio). */
  workflowOptions?: string[];
  onMoveCard: (cardId: string, toColumnId: string) => void;
  onCreateCard: (columnId: string, input: NewCardInput) => void;
  onDeleteCard?: (cardId: string) => void;
}): JSX.Element {
  // Mirror props into local state for an optimistic move; re-sync when the
  // parent refetches (SSE / poll / mutation).
  const [local, setLocal] = useState<KanbanCard[]>(cards);
  useEffect(() => setLocal(cards), [cards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const cardId = String(event.active.id);
    const toColumnId = event.over ? String(event.over.id) : null;
    if (!toColumnId) return;
    const card = local.find((c) => c.id === cardId);
    if (!card || card.columnId === toColumnId) return;
    setLocal((prev) => prev.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId } : c)));
    onMoveCard(cardId, toColumnId);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 'var(--space-2)' }}>
        {board.columns.map((col) => (
          <DroppableColumn
            key={col.id}
            column={col}
            cards={local.filter((c) => c.columnId === col.id).sort((a, b) => a.order - b.order)}
            onAddCard={onCreateCard}
            onDeleteCard={onDeleteCard}
            enableSources={enableSources}
            workflowOptions={workflowOptions}
          />
        ))}
      </div>
    </DndContext>
  );
}
