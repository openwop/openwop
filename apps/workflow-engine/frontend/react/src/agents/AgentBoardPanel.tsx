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
  type KanbanCardSource,
} from '../kanban/kanbanClient.js';
import { KanbanBoardView } from '../kanban/KanbanBoardView.js';
import { Notice } from '../ui/Notice.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

export function AgentBoardPanel({ boardId, persona, onChanged }: { boardId: string; persona: string; onChanged?: () => void }): JSX.Element {
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
  // Live refresh via SSE (cross-instance board-change fan-out).
  useEffect(() => subscribeBoardEvents(boardId, () => void refresh()), [boardId, refresh]);

  const onCreateCard = async (columnId: string, input: { title: string; source?: KanbanCardSource }) => {
    try {
      const source = input.source ?? 'human';
      await createCard(boardId, {
        title: input.title,
        columnId,
        source,
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

  if (!board) return <p style={muted}>{error ? `⚠ ${error}` : 'Loading board…'}</p>;

  return (
    <div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {notice ? <Notice variant="success">{notice}</Notice> : null}
      <p style={{ ...muted, fontSize: '13px', marginTop: 0 }}>
        New work arrives in <strong>To Do</strong>. <strong>Drag a card</strong> between lanes (or run the heartbeat from
        the header) to let {persona} pick up the next task.
      </p>
      <KanbanBoardView
        board={board}
        cards={cards}
        enableSources
        onMoveCard={(cardId, toColumnId) => void onMoveCard(cardId, toColumnId)}
        onCreateCard={(columnId, input) => void onCreateCard(columnId, input)}
        onDeleteCard={(cardId) => void onDeleteCard(cardId)}
      />
    </div>
  );
}
