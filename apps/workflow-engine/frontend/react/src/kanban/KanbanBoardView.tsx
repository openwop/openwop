/**
 * KanbanBoardView — the ONE board renderer shared by the standalone `/boards`
 * page (KanbanPage) and the embedded agent-workspace Board tab
 * (AgentBoardPanel). Previously those were two divergent boards (drag-and-drop
 * vs a "Move" dropdown); this unifies them.
 *
 * Features:
 *  - @dnd-kit drag-and-drop (pointer + keyboard sensor — focus a card, Space to
 *    pick up, arrows to move, Space to drop) with an optimistic local move.
 *  - Rich cards: source chip, workflow name, priority, due date, run link,
 *    and ONE lane-contextual action (boards redesign 2026-06-05): To do →
 *    Start work · Working → Mark done · Waiting → Resolve · Done → Reopen.
 *    Reopen moves back into the trigger lane and therefore fires the
 *    workflow — the same semantics as dragging the card back.
 *  - Trigger columns (⚡) read as accent-outlined; waiting cards carry an
 *    amber edge bar.
 *  - Per-column count badge + dashed add-card affordance.
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
import { AlertIcon, CheckIcon, GripVerticalIcon, PlayIcon, RotateCwIcon, UserIcon, WorkflowIcon, XIcon, ZapIcon } from '../ui/icons/index.js';
import { Markdown } from '../ui/Markdown.js';
import { MarkdownEditor } from '../ui/MarkdownEditor.js';
import type { KanbanBoard, KanbanCard, KanbanColumn, KanbanCardSource } from './kanbanClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

type LaneKind = 'todo' | 'working' | 'waiting' | 'done';
type MoveKind = 'todo' | 'working' | 'waiting' | 'done';

/** Match a column to a canonical lane by id or display name (mirrors
 *  agentViewModel.laneOf) so the non-drag quick-actions know where "Start" /
 *  "Waiting" / "Done" point on boards that use either id or label conventions. */
function laneKindOf(col: KanbanColumn): LaneKind | null {
  const id = col.id.toLowerCase();
  const name = col.name.toLowerCase();
  if (id === 'todo' || name === 'to do') return 'todo';
  if (id === 'working' || id === 'doing' || name === 'working' || name === 'doing') return 'working';
  if (id === 'waiting' || name.startsWith('waiting')) return 'waiting';
  if (id === 'done' || name === 'done') return 'done';
  return null;
}

/** The full create-card payload the add-card form can produce. */
export interface NewCardInput {
  title: string;
  source?: KanbanCardSource;
  description?: string;
  workflowId?: string;
  priority?: 'low' | 'normal' | 'high';
  dueAt?: string;
  assignmentReason?: string;
  blockerNote?: string;
}

const SOURCE_OPTIONS: ReadonlyArray<{ value: KanbanCardSource; label: string }> = [
  { value: 'human', label: 'From a human' },
  { value: 'discord', label: 'Simulated Discord' },
  { value: 'agent', label: 'From another agent' },
  { value: 'api', label: 'From an API' },
];

function DraggableCard({
  card,
  lane,
  laneTargets,
  onDelete,
  onMove,
}: {
  card: KanbanCard;
  /** Canonical lane of the column this card sits in (null = custom lane). */
  lane: LaneKind | null;
  /** Canonical lane → real column id, for the contextual action target. */
  laneTargets: ReadonlyMap<MoveKind, string>;
  onDelete?: (cardId: string) => void;
  onMove?: (cardId: string, toColumnId: string) => void;
}): JSX.Element {
  // Drag activates from a dedicated grip handle, NOT the whole card: dnd-kit's
  // listeners/attributes set role="button"+tabindex on their element, and the
  // card body holds real interactive controls (delete, run link, move buttons)
  // that must not be nested inside a role=button (invalid ARIA). setNodeRef
  // marks the draggable; setActivatorNodeRef + listeners mark the handle.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    padding: 'var(--space-2-5) var(--space-3)',
    marginBottom: 'var(--space-2)',
  };
  const action = lane ? LANE_ACTION[lane] : null;
  const actionTarget = action ? laneTargets.get(action.to) : undefined;
  return (
    <div ref={setNodeRef} className={lane === 'waiting' ? 'surface-card kb-card kb-card--waiting' : 'surface-card kb-card'} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          ref={setActivatorNodeRef}
          aria-label={`Drag ${card.title} to another lane`}
          // ≥24px hit area (WCAG 2.5.8): 14px glyph + 5px padding; negative
          // margin keeps the row layout from growing. Rounded so the focus
          // ring (global [role=button]:focus-visible) reads cleanly.
          style={{ cursor: 'grab', display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-muted)', touchAction: 'none', flexShrink: 0, padding: 5, margin: -3, borderRadius: 'var(--radius)' }}
          {...listeners}
          {...attributes}
        >
          <GripVerticalIcon size={14} />
        </span>
        <div style={{ fontWeight: 600, fontSize: '13px', flex: 1, minWidth: 0 }}>{card.title}</div>
        {onDelete ? (
          <button
            type="button"
            className="icon-button kb-card-delete"
            aria-label={`Delete ${card.title}`}
            title={`Delete ${card.title}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
          >
            <XIcon size={13} aria-hidden />
          </button>
        ) : null}
      </div>
      {card.description ? <Markdown style={{ ...muted, fontSize: '12px', marginTop: 2 }}>{card.description}</Markdown> : null}
      <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--space-1)' }}>
        {card.source ? <TaskSourceChip source={card.source} sourceLabel={card.sourceLabel} /> : null}
        {card.workflowId ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: '12px', color: 'var(--color-accent)' }}>
            <WorkflowIcon size={12} /> {workflowName(card.workflowId)}
          </span>
        ) : null}
        {card.priority === 'high' ? <span className="chip chip--danger kb-prio">HIGH</span> : null}
        {card.priority === 'low' ? <span className="chip chip--muted kb-prio">LOW</span> : null}
        {card.createdBy ? (
          <span className="kb-person"><UserIcon size={12} aria-hidden /> {card.createdBy}</span>
        ) : null}
        {card.dueAt ? <span style={{ ...muted, fontSize: '12px' }}>due {card.dueAt.slice(0, 10)}</span> : null}
      </div>
      {card.assignmentReason ? <div style={{ ...muted, fontSize: '12px' }}>Why assigned: {card.assignmentReason}</div> : null}
      {card.blockerNote ? <div style={{ fontSize: '12px', color: 'var(--color-warning-text, var(--color-text-muted))', marginTop: 'var(--space-1)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}><AlertIcon size={12} /> Blocked: {card.blockerNote}</div> : null}
      <div className="kb-card-foot">
        {action && actionTarget && onMove ? (
          // The lane's ONE next action — the non-drag path (a11y + touch).
          // Other moves stay drag-and-drop.
          <button
            type="button"
            className={action.accent ? 'btn-accent btn-sm' : 'secondary btn-sm'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onMove(card.id, actionTarget); }}
          >
            {action.icon} {action.label}
          </button>
        ) : null}
        <span className="kb-card-foot-spacer" />
        {card.lastRunId ? (
          <Link
            to={`/runs/${card.lastRunId}`}
            onPointerDown={(e) => e.stopPropagation()}
            className="kb-run-link"
            title="View the triggered run"
          >
            <PlayIcon size={12} aria-hidden /> View run
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** The ONE contextual action per lane (boards redesign): what a human most
 *  plausibly does next with a card in that lane. Everything else stays
 *  drag-and-drop. */
const LANE_ACTION: Record<LaneKind, { label: string; to: MoveKind; icon: JSX.Element; accent?: boolean } | null> = {
  todo: { label: 'Start work', to: 'working', icon: <PlayIcon size={12} /> },
  working: { label: 'Mark done', to: 'done', icon: <CheckIcon size={12} /> },
  waiting: { label: 'Resolve', to: 'working', icon: <CheckIcon size={12} />, accent: true },
  done: { label: 'Reopen', to: 'todo', icon: <RotateCwIcon size={12} /> },
};

function DroppableColumn({
  column,
  cards,
  onAddCard,
  onDeleteCard,
  enableSources,
  workflowOptions,
  laneTargets,
  onMove,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  onAddCard: (columnId: string, input: NewCardInput) => void;
  onDeleteCard?: (cardId: string) => void;
  enableSources?: boolean;
  workflowOptions?: string[];
  /** Canonical lane → real column id (the contextual-action targets). */
  laneTargets: ReadonlyMap<MoveKind, string>;
  onMove?: (cardId: string, toColumnId: string) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<KanbanCardSource>('human');
  const [workflowId, setWorkflowId] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [dueAt, setDueAt] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [blockerNote, setBlockerNote] = useState('');
  const isTrigger = Boolean(column.triggerWorkflowId);
  const resetForm = (): void => { setTitle(''); setDescription(''); setSource('human'); setWorkflowId(''); setPriority('normal'); setDueAt(''); setAssignmentReason(''); setBlockerNote(''); setAdding(false); };

  const lane = laneKindOf(column);
  return (
    <div
      ref={setNodeRef}
      className={'kb-col' + (isTrigger ? ' kb-col--trigger' : '') + (isOver ? ' is-over' : '')}
    >
      <div className="kb-col-head">
        <span className="kb-col-name">
          {column.name}
          {isTrigger ? <ZapIcon size={13} style={{ color: 'var(--color-accent)' }} /> : null}
        </span>
        <span className="kb-col-count">{cards.length}</span>
      </div>
      {cards.map((c) => (
        <DraggableCard key={c.id} card={c} lane={lane} laneTargets={laneTargets} onDelete={onDeleteCard} onMove={onMove} />
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
              ...(assignmentReason.trim() ? { assignmentReason: assignmentReason.trim() } : {}),
              ...(blockerNote.trim() ? { blockerNote: blockerNote.trim() } : {}),
            });
            resetForm();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          <input autoFocus className="ui-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title…" style={{ width: '100%' }} />
          <MarkdownEditor value={description} onChange={setDescription} placeholder="Description (optional) — Markdown supported" rows={2} compact ariaLabel="Task description" />
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
          <input className="ui-input" value={assignmentReason} onChange={(e) => setAssignmentReason(e.target.value)} placeholder="Why assigned (optional)" aria-label="Why assigned" style={{ width: '100%' }} />
          <input className="ui-input" value={blockerNote} onChange={(e) => setBlockerNote(e.target.value)} placeholder="Blocker, if any (optional)" aria-label="Blocker note" style={{ width: '100%' }} />
          <div className="action-bar">
            <button type="submit" className="primary btn-sm">Add</button>
            <button type="button" className="secondary btn-sm" onClick={resetForm}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="kb-add" onClick={() => setAdding(true)}>+ Add card</button>
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
  /** Owner persona — accepted for parity with the page header (unused here). */
  ownerPersona?: string;
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

  const moveCard = (cardId: string, toColumnId: string): void => {
    const card = local.find((c) => c.id === cardId);
    if (!card || card.columnId === toColumnId) return;
    setLocal((prev) => prev.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId } : c)));
    onMoveCard(cardId, toColumnId);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const toColumnId = event.over ? String(event.over.id) : null;
    if (toColumnId) moveCard(String(event.active.id), toColumnId);
  };

  // Canonical lane → first matching column, so each card's contextual action
  // ("Start work" / "Mark done" / "Resolve" / "Reopen") targets a real column.
  const laneTargets = new Map<MoveKind, string>();
  for (const kind of ['todo', 'working', 'waiting', 'done'] as MoveKind[]) {
    const col = board.columns.find((c) => laneKindOf(c) === kind);
    if (col) laneTargets.set(kind, col.id);
  }

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
            laneTargets={laneTargets}
            onMove={moveCard}
          />
        ))}
      </div>
    </DndContext>
  );
}
