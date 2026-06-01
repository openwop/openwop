/**
 * `/inbox` — full-page notification surface. Subsumes the original
 * HitlInboxPage: notifications of type `workflow.approval_needed` /
 * `workflow.input_needed` render the inline approval form (so the
 * /inbox page itself is the action surface), while other notification
 * types render as a row with a deep-link.
 *
 * The bell + drawer cover the "glance" use case from anywhere in the
 * app; this page is the "sit down and clear the queue" surface.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNotificationStore } from './notificationStore.js';
import { PageHeader } from '../ui/PageHeader.js';
import { listOpenInterrupts, type OpenInterrupt } from '../client/interruptsClient.js';
import { RenderInterrupt } from '../interrupts/RenderInterrupt.js';
import type { Notification } from './types.js';
import { isActionNeeded } from './types.js';

type Tab = 'action-needed' | 'all' | 'archived';

const TAB_LABELS: Record<Tab, string> = {
  'action-needed': 'Action needed',
  'all':           'All',
  'archived':      'Archived',
};

export function NotificationsPage(): JSX.Element {
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const refresh = useNotificationStore((s) => s.refresh);
  const archive = useNotificationStore((s) => s.archive);
  const deleteN = useNotificationStore((s) => s.delete);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const error = useNotificationStore((s) => s.error);
  const loading = useNotificationStore((s) => s.loading);

  const [tab, setTab] = useState<Tab>('action-needed');

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo<Notification[]>(() => {
    if (tab === 'archived') return notifications.filter((n) => n.status === 'archived');
    const nonArchived = notifications.filter((n) => n.status !== 'archived');
    if (tab === 'action-needed') return nonArchived.filter(isActionNeeded);
    return nonArchived;
  }, [notifications, tab]);

  const actionNeededCount = useMemo(
    () => notifications.filter((n) => n.status !== 'archived' && isActionNeeded(n)).length,
    [notifications],
  );

  return (
    <section>
      <PageHeader
        eyebrow="Inbox"
        title="Inbox"
        lede="Everything that needs your attention. Approval requests from suspended workflows render their resume form inline so you can resolve without leaving the page."
        actions={
          <>
            <button type="button" className="secondary" onClick={() => void markAllRead()} disabled={unreadCount === 0}>Mark all read</button>
            <button type="button" className="secondary" onClick={() => void refresh()}>Refresh</button>
          </>
        }
      />
      {error && <div className="alert error">{error}</div>}

      <div
        className="card"
        style={{ display: 'flex', gap: 4, padding: 0, overflow: 'hidden' }}
      >
        {(['action-needed', 'all', 'archived'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            style={{
              flex: 1,
              padding: '12px 0',
              background: tab === key ? 'var(--color-surface-2)' : 'transparent',
              border: 'none',
              borderBottom: tab === key
                ? '2px solid var(--color-accent)'
                : '2px solid transparent',
              fontWeight: tab === key ? 600 : 400,
              cursor: 'pointer',
              color: tab === key ? 'var(--color-accent)' : 'inherit',
            }}
          >
            {TAB_LABELS[key]}
            {key === 'action-needed' && actionNeededCount > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  background: 'var(--color-warning)',
                  color: 'var(--color-on-scrim)',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {actionNeededCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && filtered.length === 0 && (
        <div className="card muted">Loading inbox…</div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="card muted">
          {tab === 'archived'
            ? 'Nothing archived yet.'
            : tab === 'action-needed'
              ? 'No pending approvals or input requests. Workflows suspended on a HITL interrupt show up here.'
              : 'No notifications yet.'}
        </div>
      )}

      {filtered.map((n) => (
        <NotificationCard
          key={n.notificationId}
          notification={n}
          onArchive={() => void archive(n.notificationId)}
          onDelete={() => { if (window.confirm("Delete this notification? This can't be undone — use Archive to dismiss without deleting.")) void deleteN(n.notificationId); }}
          onResolved={() => {
            // After an interrupt is resolved, archive the notification
            // and re-fetch — the BE may have emitted a follow-up event
            // (e.g., next interrupt opens) we'd otherwise miss until
            // the next SSE frame.
            void archive(n.notificationId);
            void refresh();
          }}
        />
      ))}
    </section>
  );
}

interface NotificationCardProps {
  notification: Notification;
  onArchive: () => void;
  onDelete: () => void;
  onResolved: () => void;
}

function NotificationCard({
  notification,
  onArchive,
  onDelete,
  onResolved,
}: NotificationCardProps): JSX.Element {
  const isUnread = notification.status === 'unread';
  return (
    <div
      className="card"
      style={{
        borderLeft: isUnread ? '3px solid var(--color-accent)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <strong>{notification.title}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {notification.type}
        </span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {new Date(notification.createdAt).toLocaleString()}
        </span>
      </div>
      <p style={{ margin: '0 0 8px 0' }}>{notification.message}</p>
      {notification.runId && (
        <div style={{ marginBottom: 8 }}>
          <Link to={`/runs/${notification.runId}`} style={{ fontSize: 12 }}>
            run {notification.runId.slice(0, 12)} →
          </Link>
        </div>
      )}

      {isActionNeeded(notification) && notification.runId && (
        <InlineInterruptResolver
          runId={notification.runId}
          interruptId={notification.interruptId}
          onResolved={onResolved}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {notification.status !== 'archived' && (
          <button type="button" className="secondary" onClick={onArchive}>
            Archive
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={onDelete}
          style={{ color: 'var(--color-danger)' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

interface ResolverProps {
  runId: string;
  interruptId?: string;
  onResolved: () => void;
}

function InlineInterruptResolver({ runId, interruptId, onResolved }: ResolverProps): JSX.Element | null {
  const [open, setOpen] = useState<OpenInterrupt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listOpenInterrupts(runId);
        if (cancelled) return;
        // Prefer the interrupt the notification points at; fall back
        // to whatever's open if the BE event came in before the
        // notification metadata had the id, or the row drifted.
        const match = interruptId
          ? (list.find((i) => i.interruptId === interruptId) ?? list[0] ?? null)
          : (list[0] ?? null);
        setOpen(match);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [runId, interruptId]);

  if (error) return <div className="alert error">{error}</div>;
  if (!open) {
    return (
      <div className="muted" style={{ fontSize: 12 }}>
        Interrupt may have been resolved elsewhere — refresh to reconcile.
      </div>
    );
  }
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 8 }}>
      <RenderInterrupt runId={runId} active={open} onResolved={onResolved} />
    </div>
  );
}
