/**
 * Right-side notification drawer. Mirrors the layout of
 * `WorkflowProgressPanel` — slide-out from the right edge, fixed
 * width on desktop, full-bleed below the mobile breakpoint.
 *
 * Three tabs:
 *   - All        — every non-archived row
 *   - Unread     — `status === 'unread'`
 *   - Archived   — `status === 'archived'`
 *
 * Each row renders the type-specific icon + title + message + a
 * relative timestamp. Action-needed rows expose an inline "Open
 * inbox" link so the user can resolve without leaving the panel
 * to dig through Runs.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNotificationStore } from './notificationStore.js';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel.js';
import { AlertIcon, CheckIcon, SettingsIcon, XIcon } from '../chat/icons/index.js';
import type { Notification, NotificationType } from './types.js';

type Tab = 'all' | 'unread' | 'archived';

const TYPE_ICON: Record<string, React.ReactNode> = {
  'workflow.approval_needed': <AlertIcon size={14} />,
  'workflow.input_needed':    '?',
  'workflow.failed':          '!',
  'workflow.completed':       <CheckIcon size={14} />,
  'system.alert':             'i',
};

const TYPE_COLOR: Record<string, string> = {
  'workflow.approval_needed': 'var(--color-warning)',
  'workflow.input_needed':    'var(--color-accent)',
  'workflow.failed':          'var(--color-danger)',
  'workflow.completed':       'var(--color-success)',
  'system.alert':             'var(--color-text-muted)',
};

export function NotificationPanel(): JSX.Element | null {
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const closePanel = useNotificationStore((s) => s.closePanel);
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const archive = useNotificationStore((s) => s.archive);
  const deleteNotif = useNotificationStore((s) => s.delete);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const refresh = useNotificationStore((s) => s.refresh);
  const loading = useNotificationStore((s) => s.loading);
  const error = useNotificationStore((s) => s.error);
  const desktopPermission = useNotificationStore((s) => s.desktopPermission);
  const requestDesktopPermission = useNotificationStore((s) => s.requestDesktopPermission);
  const syncDesktopPermission = useNotificationStore((s) => s.syncDesktopPermission);
  const preferencesOpen = useNotificationStore((s) => s.preferencesOpen);
  const openPreferences = useNotificationStore((s) => s.openPreferences);
  const pushStatus = useNotificationStore((s) => s.pushStatus);
  const enablePush = useNotificationStore((s) => s.enablePush);
  const disablePush = useNotificationStore((s) => s.disablePush);
  const syncPushStatus = useNotificationStore((s) => s.syncPushStatus);

  const [tab, setTab] = useState<Tab>('all');
  // Track viewport width so the panel switches between right-side
  // drawer and full-screen overlay below the mobile breakpoint —
  // same pattern as WorkflowProgressPanel.
  const isMobile = useIsMobile();

  // Esc closes the panel when focus is inside.
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!panelOpen) return;
    // Refresh on open so a tab returning from background sees the
    // latest BE state without waiting for SSE. Also re-read the
    // browser's permission state — the user may have changed it in
    // site settings between sessions.
    void refresh();
    syncDesktopPermission();
    void syncPushStatus();
  }, [panelOpen, refresh, syncDesktopPermission, syncPushStatus]);

  const filtered = useMemo(() => {
    if (tab === 'unread') return notifications.filter((n) => n.status === 'unread');
    if (tab === 'archived') return notifications.filter((n) => n.status === 'archived');
    return notifications.filter((n) => n.status !== 'archived');
  }, [notifications, tab]);

  if (!panelOpen) return null;

  return (
    <>
      {/* Backdrop — click to dismiss, same affordance as a modal. The
          panel itself stays mounted so opening/closing doesn't lose
          scroll position or the active tab. */}
      <div
        onClick={closePanel}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: isMobile ? 'rgba(0,0,0,0.4)' : 'transparent',
          zIndex: 49,
        }}
      />
      <aside
        ref={ref}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') closePanel(); }}
        role="dialog"
        aria-labelledby="notification-panel-heading"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: isMobile ? '100%' : 400,
          maxWidth: '100vw',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-4px 0 18px rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h2 id="notification-panel-heading" style={{ margin: 0, fontSize: 18 }}>
            Notifications
            {unreadCount > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  background: 'var(--color-danger)',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontWeight: 600,
                }}
              >
                {unreadCount}
              </span>
            )}
          </h2>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="secondary"
              onClick={openPreferences}
              aria-label="Notification preferences"
              title="Notification preferences"
              style={{ fontSize: 14 }}
            >
              <SettingsIcon size={16} />
            </button>
            <button
              type="button"
              className="secondary"
              onClick={closePanel}
              aria-label="Close notifications"
            >
              <XIcon size={16} />
            </button>
          </div>
        </header>

        {/* Preferences subdrawer takes over the panel body when open —
            replaces actions/tabs/list with the prefs UI. The header
            stays put so the close button is always reachable. */}
        {preferencesOpen && <NotificationPreferencesPanel />}

        {!preferencesOpen && (
          <>
        {/* Desktop-notifications affordance. The browser's
            `requestPermission()` MUST be called inside a user gesture
            (a click handler), so this lives behind a button — auto-
            prompting on mount results in 'denied' on most modern
            browsers. The row hides itself once the user grants
            permission, and degrades gracefully to a "Blocked" hint
            if denied (recovery is via the lock icon in the address
            bar — we can't re-prompt). */}
        {desktopPermission === 'default' && (
          <DesktopPermissionRow
            label="Get a desktop alert when something needs your attention"
            cta="Enable desktop alerts"
            onClick={() => void requestDesktopPermission()}
          />
        )}
        {desktopPermission === 'denied' && (
          <DesktopPermissionRow
            label="Desktop alerts are blocked. Unblock in site settings to re-enable."
            tone="muted"
          />
        )}

        {/* Push affordance. Only surfaces when:
              - browser supports Push (status !== 'unsupported')
              - BE is configured with VAPID (status !== 'disabled')
              - user has granted Notifications perm (otherwise push
                arrives but the SW can't show the toast)
            Pairs naturally with the desktop-perm row above. */}
        {desktopPermission === 'granted' && pushStatus === 'available' && (
          <DesktopPermissionRow
            label="Also receive alerts when this tab is closed"
            cta="Enable background push"
            onClick={() => void enablePush()}
          />
        )}
        {desktopPermission === 'granted' && pushStatus === 'subscribed' && (
          <DesktopPermissionRow
            label="Background push is on. Alerts continue when the tab is closed."
            tone="muted"
            cta="Disable"
            onClick={() => void disablePush()}
          />
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <button
            type="button"
            className="secondary"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
            style={{ fontSize: 12 }}
          >
            Mark all read
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void refresh()}
            style={{ fontSize: 12 }}
          >
            Refresh
          </button>
        </div>

        <nav
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {([
            ['all',      'All'],
            ['unread',   `Unread (${unreadCount})`],
            ['archived', 'Archived'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === key
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                fontWeight: tab === key ? 600 : 400,
                cursor: 'pointer',
                color: tab === key ? 'var(--color-accent)' : 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {error && (
            <div className="alert error" style={{ margin: 12 }}>
              {error}
            </div>
          )}
          {loading && filtered.length === 0 && (
            <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
              Loading…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
              {tab === 'unread'
                ? 'Nothing unread.'
                : tab === 'archived'
                  ? 'Nothing archived.'
                  : 'No notifications yet. Run a workflow that needs an approval to see something here.'}
            </div>
          )}
          {filtered.map((n) => (
            <NotificationRow
              key={n.notificationId}
              notification={n}
              onMarkRead={() => void markAsRead(n.notificationId)}
              onArchive={() => void archive(n.notificationId)}
              onDelete={() => void deleteNotif(n.notificationId)}
              onClose={closePanel}
            />
          ))}
        </div>
          </>
        )}
      </aside>
    </>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onMarkRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function NotificationRow({
  notification,
  onMarkRead,
  onArchive,
  onDelete,
  onClose,
}: NotificationRowProps): JSX.Element {
  const isUnread = notification.status === 'unread';
  const icon = TYPE_ICON[notification.type] ?? '•';
  const color = TYPE_COLOR[notification.type] ?? 'var(--color-text-muted)';
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        background: isUnread ? 'color-mix(in oklch, var(--color-accent) 6%, transparent)' : 'transparent',
        cursor: isUnread ? 'pointer' : 'default',
      }}
      onClick={isUnread ? onMarkRead : undefined}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: `color-mix(in oklch, ${color} 15%, transparent)`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontWeight: isUnread ? 600 : 400 }}>{notification.title}</strong>
          <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {formatTime(notification.createdAt)}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{notification.message}</div>
        {notification.actionUrl && (
          <div style={{ marginTop: 6 }}>
            <Link
              to={notification.actionUrl}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ fontSize: 12 }}
            >
              {actionLabelFor(notification.type)} →
            </Link>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {isUnread && (
            <button
              type="button"
              className="secondary"
              onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
              style={{ fontSize: 11 }}
            >
              Mark read
            </button>
          )}
          {notification.status !== 'archived' && (
            <button
              type="button"
              className="secondary"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
              style={{ fontSize: 11 }}
            >
              Archive
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ fontSize: 11, color: 'var(--color-danger)' }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

interface DesktopPermissionRowProps {
  label: string;
  cta?: string;
  onClick?: () => void;
  tone?: 'default' | 'muted';
}

function DesktopPermissionRow({ label, cta, onClick, tone = 'default' }: DesktopPermissionRowProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        background: tone === 'muted'
          ? 'transparent'
          : 'color-mix(in oklch, var(--color-accent) 8%, transparent)',
        fontSize: 12,
      }}
    >
      <span style={{ flex: 1, color: tone === 'muted' ? 'var(--color-text-muted)' : 'inherit' }}>
        {label}
      </span>
      {cta && onClick && (
        <button
          type="button"
          className="secondary"
          onClick={onClick}
          style={{ fontSize: 12, whiteSpace: 'nowrap' }}
        >
          {cta}
        </button>
      )}
    </div>
  );
}

function actionLabelFor(type: NotificationType): string {
  if (type === 'workflow.approval_needed' || type === 'workflow.input_needed') return 'Open inbox';
  if (type === 'workflow.failed' || type === 'workflow.completed') return 'View run';
  return 'View';
}

function formatTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(diffMs / 3_600_000);
  const d = Math.floor(diffMs / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 720,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}
