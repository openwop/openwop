/**
 * Agent board panel (PRD §9 Board tab) — the agent's task board embedded in
 * its workspace. Lanes To Do / Working / Waiting on Human / Done; cards show
 * their source chip, workflow, priority, and a link to the last run. Cards can
 * be created by a human or simulated as Discord/agent-created. Moving a card
 * into the To Do trigger column (or any trigger column) starts the linked
 * workflow.
 *
 * Keyboard-operable (PRD §20): cards move via a per-card lane <select>, not
 * drag-only.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createCard,
  deleteCard,
  getBoard,
  patchCard,
  subscribeBoardEvents,
  type KanbanBoard,
  type KanbanCard,
  type KanbanCardSource,
} from '../kanban/kanbanClient.js';
import { TaskSourceChip } from './TaskSourceChip.js';
import { workflowName } from './roleTemplates.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentBoardPanel({ boardId, persona, onChanged }: { boardId: string; persona: string; onChanged?: () => void }): JSX.Element {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newSource, setNewSource] = useState<KanbanCardSource>('human');

  const refresh = useCallback(async () => {
    try {
      const data = await getBoard(boardId);
      setBoard(data.board);
      setCards(data.cards);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [boardId]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Live refresh via SSE (cross-instance board-change fan-out).
  useEffect(() => subscribeBoardEvents(boardId, () => void refresh()), [boardId, refresh]);

  const onAdd = async (columnId: string) => {
    if (!newTitle.trim()) return;
    try {
      await createCard(boardId, {
        title: newTitle.trim(),
        columnId,
        source: newSource,
        ...(newSource === 'discord' ? { sourceLabel: `/assign @${persona.toLowerCase()}` } : {}),
      });
      setNewTitle('');
      setNewSource('human');
      setAddingTo(null);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onMove = async (card: KanbanCard, toColumnId: string) => {
    setNotice(null);
    try {
      const { triggeredRunId } = await patchCard(card.id, { columnId: toColumnId });
      if (triggeredRunId) setNotice(`Started a run for “${card.title}”.`);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (cardId: string) => {
    try {
      await deleteCard(cardId);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!board) return <p style={muted}>{error ? `⚠ ${error}` : 'Loading board…'}</p>;

  return (
    <div>
      {error ? <div style={{ color: 'var(--color-danger)', marginBottom: '0.5rem' }}>⚠ {error}</div> : null}
      {notice ? <div style={{ background: '#e6f7ee', color: '#1f7a4d', padding: '0.4rem 0.6rem', borderRadius: 8, marginBottom: '0.5rem', fontSize: '0.82rem' }}>{notice}</div> : null}
      <p style={{ ...muted, fontSize: '0.82rem', marginTop: 0 }}>
        New work arrives in <strong>To Do</strong>. Move a card to a lane, or run the heartbeat from the header to let {persona} pick up the next task.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${board.columns.length}, minmax(180px, 1fr))`, gap: '0.6rem', overflowX: 'auto' }}>
        {board.columns.map((col) => {
          const colCards = cards.filter((c) => c.columnId === col.id).sort((a, b) => a.order - b.order);
          return (
            <div key={col.id} style={{ background: 'var(--color-surface-alt, #f4f6f9)', borderRadius: 10, padding: '0.5rem', minWidth: 180 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <strong style={{ fontSize: '0.85rem' }}>{col.name}{col.triggerWorkflowId ? ' ⚡' : ''}</strong>
                <span style={{ ...muted, fontSize: '0.75rem' }}>{colCards.length}</span>
              </div>
              {colCards.map((card) => (
                <div key={card.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.5rem', marginBottom: '0.4rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{card.title}</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                    <TaskSourceChip source={card.source} sourceLabel={card.sourceLabel} />
                    {card.workflowId ? <span style={{ ...muted, fontSize: '0.7rem' }}>⚙ {workflowName(card.workflowId)}</span> : null}
                    {card.priority === 'high' ? <span style={{ fontSize: '0.68rem', color: '#a12d2d', fontWeight: 700 }}>HIGH</span> : null}
                  </div>
                  {card.lastRunId ? <div style={{ fontSize: '0.72rem', marginTop: 3 }}><Link to={`/runs/${card.lastRunId}`}>view run ▶</Link></div> : null}
                  <div style={{ display: 'flex', gap: 4, marginTop: 5, alignItems: 'center' }}>
                    <label style={{ ...muted, fontSize: '0.68rem' }}>Move
                      <select
                        value={card.columnId}
                        onChange={(e) => void onMove(card, e.target.value)}
                        style={{ fontSize: '0.7rem', marginLeft: 3 }}
                        aria-label={`Move ${card.title} to a lane`}
                      >
                        {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <button type="button" className="secondary" style={{ fontSize: '0.65rem', padding: '1px 5px' }} onClick={() => void onDelete(card.id)} aria-label={`Delete ${card.title}`}>✕</button>
                  </div>
                </div>
              ))}
              {addingTo === col.id ? (
                <div style={{ marginTop: 4 }}>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Task title"
                    style={{ width: '100%', fontSize: '0.78rem', marginBottom: 4 }}
                    autoFocus
                  />
                  <select value={newSource} onChange={(e) => setNewSource(e.target.value as KanbanCardSource)} style={{ fontSize: '0.72rem', width: '100%', marginBottom: 4 }} aria-label="Task source">
                    <option value="human">From a human</option>
                    <option value="discord">Simulated Discord</option>
                    <option value="agent">From another agent</option>
                    <option value="api">From an API</option>
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="primary" style={{ fontSize: '0.72rem' }} onClick={() => void onAdd(col.id)}>Add</button>
                    <button type="button" className="secondary" style={{ fontSize: '0.72rem' }} onClick={() => { setAddingTo(null); setNewTitle(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="secondary" style={{ fontSize: '0.72rem', width: '100%' }} onClick={() => { setAddingTo(col.id); setNewTitle(''); }}>+ Add task</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
