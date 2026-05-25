/**
 * Header bell + unread-count badge. Click toggles the right-side
 * `NotificationPanel` drawer.
 *
 * The bell shape is inline SVG so it doesn't add an icon-library dep.
 * Stays neutral (`--color-text-muted`) until there's something unread,
 * then takes on `--color-accent` so the user notices peripherally.
 */

import { useNotificationStore } from './notificationStore.js';

export function NotificationBell(): JSX.Element {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const hasUnread = unreadCount > 0;

  const label = hasUnread
    ? `Notifications (${unreadCount} unread)`
    : 'Notifications';

  return (
    <button
      type="button"
      className="secondary notification-bell"
      onClick={togglePanel}
      aria-label={label}
      aria-expanded={panelOpen}
      aria-haspopup="dialog"
      title={label}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: hasUnread ? 'var(--color-accent)' : undefined,
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {hasUnread && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            background: 'var(--color-danger)',
            color: '#fff',
            borderRadius: 10,
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '18px',
            textAlign: 'center',
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
