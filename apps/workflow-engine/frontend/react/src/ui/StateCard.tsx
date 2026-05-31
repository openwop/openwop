/**
 * StateCard — the one empty / loading / error block across Agents / Workflows /
 * Kanban. Every empty state names ONE next action (the `action` slot). Replaces
 * the bare muted-text empty states ("Select or create a board", "no task board
 * yet", "Loading…") that each surface reinvented.
 */

export function StateCard({
  icon,
  title,
  body,
  action,
  loading,
}: {
  /** A Lucide icon node shown above the title. */
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  /** The single next-action CTA(s). Omit for loading states. */
  action?: React.ReactNode;
  /** When true, marks the region busy for assistive tech. */
  loading?: boolean;
}): JSX.Element {
  return (
    <div className="state-card" aria-busy={loading ? 'true' : undefined}>
      {icon ? <div className="state-card__glyph" aria-hidden="true" style={{ color: 'var(--color-text-muted)' }}>{icon}</div> : null}
      <div className="state-card__title">{title}</div>
      {body ? <div className="state-card__body">{body}</div> : null}
      {action ? <div className="state-card__actions action-bar" style={{ justifyContent: 'center' }}>{action}</div> : null}
    </div>
  );
}
