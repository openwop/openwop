/**
 * Agent board panel (PRD §9 Board tab) — the agent's task board embedded in
 * its workspace. Renders the SHARED KanbanBoardView (drag-and-drop + rich
 * cards), the same board the standalone `/boards` page uses. This panel owns
 * the data fetch + live refresh (SSE) + create/move/delete persistence; the
 * board view owns the interaction.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createCard,
  deleteCard,
  getBoard,
  patchCard,
  subscribeBoardEvents,
  type KanbanBoard,
  type KanbanCard,
} from '../kanban/kanbanClient.js';
import { KanbanBoardView, type NewCardInput } from '../kanban/KanbanBoardView.js';
import { Notice } from '../ui/Notice.js';
import { AgentAvatar } from './AgentAvatar.js';
import type { RoleTheme } from './roleTemplates.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentBoardPanel({ boardId, persona, avatarUrl, roleTheme, workflows, refreshSignal, onChanged }: { boardId: string; persona: string; avatarUrl?: string; roleTheme?: RoleTheme; workflows?: string[]; refreshSignal?: number; onChanged?: () => void }): JSX.Element {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  // Refetch when the parent signals a board-affecting action (e.g. the header's
  // "Check now" heartbeat moves a card) — fixes the stale-board trust bug where
  // the move only showed after a manual reload.
  useEffect(() => { void refresh(); }, [refreshSignal, refresh]);
  // Live refresh: SSE push (cross-instance) PLUS a 5s poll floor — Firebase
  // Hosting buffers text/event-stream through the CDN, so the SSE push doesn't
  // flush in production; the poll keeps the board fresh regardless.
  useEffect(() => {
    const unsubscribe = subscribeBoardEvents(boardId, () => void refresh());
    const poll = setInterval(() => void refresh(), 5000);
    return () => { unsubscribe(); clearInterval(poll); };
  }, [boardId, refresh]);

  const onCreateCard = async (columnId: string, input: NewCardInput) => {
    try {
      const source = input.source ?? 'human';
      await createCard(boardId, {
        title: input.title,
        columnId,
        source,
        ...(input.description ? { description: input.description } : {}),
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        ...(input.assignmentReason ? { assignmentReason: input.assignmentReason } : {}),
        ...(input.blockerNote ? { blockerNote: input.blockerNote } : {}),
        // A human-added card is created by a person; attribute it so the card's
        // "Created by" reads sensibly (Discord/agent/workflow carry their own).
        ...(source === 'human' ? { createdBy: 'You' } : {}),
        // A simulated-Discord card carries the slash-command as its label.
        ...(source === 'discord' ? { sourceLabel: `/assign @${persona.toLowerCase()}` } : {}),
      });
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onMoveCard = async (cardId: string, toColumnId: string) => {
    setNotice(null);
    try {
      const { triggeredRunId } = await patchCard(cardId, { columnId: toColumnId });
      if (triggeredRunId) setNotice('Started a run — dropping a card into a ⚡ trigger lane fires its workflow.');
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDeleteCard = async (cardId: string) => {
    try {
      await deleteCard(cardId);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!board) {
    return error
      ? <Notice variant="error">{error}</Notice>
      : <p style={muted}>Loading board…</p>;
  }

  return (
    <div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        {roleTheme ? (
          <AgentAvatar persona={persona} avatarUrl={avatarUrl} roleTheme={roleTheme} size={28} showBadge={false} alt={`${persona}'s photo`} />
        ) : null}
        <p style={{ ...muted, fontSize: '13px', margin: 0 }}>
          <strong>{persona}'s board.</strong> New work arrives in <strong>To Do</strong>. <strong>Drag a card</strong> between
          lanes (or run the heartbeat from the header) to let {persona} pick up the next task.
        </p>
      </div>
      <KanbanBoardView
        board={board}
        cards={cards}
        enableSources
        workflowOptions={workflows}
        onMoveCard={(cardId, toColumnId) => void onMoveCard(cardId, toColumnId)}
        onCreateCard={(columnId, input) => void onCreateCard(columnId, input)}
        onDeleteCard={(cardId) => void onDeleteCard(cardId)}
      />
    </div>
  );
}
