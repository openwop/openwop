/**
 * Sidebar drawer listing chat sessions for the calling tenant (Phase 2C.1).
 *
 *   Date groups: Today / Yesterday / This Week / Older
 *   Search box that filters by title (case-insensitive, debounced).
 *   Hover-revealed Rename + Delete per row.
 *   Rename uses an inline TextField; submit-on-Enter / cancel-on-Esc.
 *   Delete prompts a one-step confirm modal (no undo snackbar in the
 *     sample — adopters can add their own per the plan).
 *
 * The drawer is purely presentational — state lives in `useChatSessions`.
 * The parent (ChatSidebar) wires the active-session callback.
 */

import { useMemo, useState } from 'react';
import type { ChatSessionHeader } from '../client/chatSessionsClient.js';

interface Props {
  sessions: readonly ChatSessionHeader[];
  isLoading: boolean;
  error: string | null;
  /** The session currently open in the message-feed (highlighted). */
  activeSessionId: string | null;
  /** Trigger a re-fetch of the headers (used after the "Try again"
   *  affordance when an error surfaces). */
  onRefresh: () => Promise<void>;
  /** Switch the chat-feed to a different session. */
  onSelect: (sessionId: string) => void;
  /** Persist a renamed title. */
  onRename: (sessionId: string, title: string) => Promise<void>;
  /** Drop a session (cascades to messages on the BE). */
  onDelete: (sessionId: string) => Promise<void>;
  /** Close the drawer. */
  onClose: () => void;
}

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

function groupOf(iso: string): DateGroup {
  const d = new Date(iso);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (startOfTarget === startOfToday) return 'Today';
  if (startOfTarget === startOfToday - dayMs) return 'Yesterday';
  if (startOfTarget >= startOfToday - 6 * dayMs) return 'This Week';
  return 'Older';
}

const GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

export function SessionHistoryDrawer({
  sessions,
  isLoading,
  error,
  activeSessionId,
  onRefresh,
  onSelect,
  onRename,
  onDelete,
  onClose,
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
    const buckets: Record<DateGroup, ChatSessionHeader[]> = {
      Today: [], Yesterday: [], 'This Week': [], Older: [],
    };
    for (const s of filtered) {
      buckets[groupOf(s.updatedAt)].push(s);
    }
    return buckets;
  }, [sessions, query]);

  async function commitRename(sessionId: string): Promise<void> {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      await onRename(sessionId, trimmed);
    } catch (e) {
      // Surface rename errors via the drawer's `error` prop already.
      console.error('rename failed', e);
    }
    setRenamingId(null);
  }

  return (
    <aside
      className="session-history-drawer"
      style={{
        width: 280,
        height: '100%',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
      }}
      aria-label="Chat history"
    >
      <header
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong style={{ flex: 1, fontSize: 13 }}>History</strong>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          aria-label="Close history"
          style={{ padding: '2px 8px', fontSize: 11, minHeight: 0, height: 22 }}
        >
          ×
        </button>
      </header>

      <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          aria-label="Search chats"
          style={{ width: '100%', fontSize: 12 }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {isLoading && (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>Loading…</div>
        )}
        {error && (
          <div className="alert error" style={{ margin: 8, fontSize: 11 }}>
            {error}
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => { void onRefresh(); }}
                style={{ fontSize: 11, padding: '2px 8px', minHeight: 0, height: 22 }}
              >
                Try again
              </button>
            </div>
          </div>
        )}
        {!isLoading && !error && sessions.length === 0 && (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>
            No saved chats yet.
          </div>
        )}
        {GROUP_ORDER.map((group) => {
          const items = grouped[group];
          if (items.length === 0) return null;
          return (
            <section key={group} aria-label={group}>
              <h3
                className="muted"
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  margin: '8px 12px 4px',
                }}
              >
                {group}
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {items.map((s) => {
                  const isActive = s.sessionId === activeSessionId;
                  const isRenaming = renamingId === s.sessionId;
                  return (
                    <li
                      key={s.sessionId}
                      className="session-row"
                      style={{
                        position: 'relative',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        background: isActive
                          ? 'color-mix(in oklch, var(--color-clay) 18%, transparent)'
                          : 'transparent',
                        borderLeft: isActive
                          ? '2px solid var(--color-clay)'
                          : '2px solid transparent',
                      }}
                      onClick={() => { if (!isRenaming) onSelect(s.sessionId); }}
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => { void commitRename(s.sessionId); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitRename(s.sessionId); }
                            if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); }
                          }}
                          style={{ width: '100%', fontSize: 12, padding: '2px 4px' }}
                          aria-label="Rename chat"
                        />
                      ) : (
                        <>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: isActive ? 600 : 400,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={s.title}
                          >
                            {s.title}
                          </div>
                          <div className="muted" style={{ fontSize: 10, marginTop: 1 }}>
                            {s.messageCount} {s.messageCount === 1 ? 'message' : 'messages'}
                          </div>
                          <div
                            className="session-row-actions"
                            style={{
                              position: 'absolute',
                              right: 8,
                              top: 4,
                              display: 'flex',
                              gap: 2,
                              opacity: 0,
                              transition: 'opacity 120ms ease',
                            }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: '0 6px', fontSize: 10, minHeight: 0, height: 20 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameDraft(s.title);
                                setRenamingId(s.sessionId);
                              }}
                              aria-label="Rename chat"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: '0 6px', fontSize: 10, minHeight: 0, height: 20 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteId(s.sessionId);
                              }}
                              aria-label="Delete chat"
                            >
                              🗑
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {pendingDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--scrim, rgba(0,0,0,0.4))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => setPendingDeleteId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: 16,
              maxWidth: 240,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Delete this chat?</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              The chat and all messages are removed permanently.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setPendingDeleteId(null)}
                style={{ fontSize: 12, padding: '3px 10px', minHeight: 0, height: 26 }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  const id = pendingDeleteId;
                  setPendingDeleteId(null);
                  try { await onDelete(id); } catch (e) { console.error('delete failed', e); }
                }}
                style={{ fontSize: 12, padding: '3px 10px', minHeight: 0, height: 26 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
