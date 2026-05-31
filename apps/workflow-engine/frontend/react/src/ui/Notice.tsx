/**
 * Notice — the one transient-notice primitive across Agents / Workflows /
 * Kanban. Routes through the token-anchored `.alert.*` classes (no hardcoded
 * hex) and announces to assistive tech via `role="status"` + `aria-live`, so
 * "Check now", "Saved", "Creating…" etc. are spoken, not silently colored text.
 */

export type NoticeVariant = 'success' | 'error' | 'info' | 'warning';

export function Notice({
  variant = 'info',
  children,
}: {
  variant?: NoticeVariant;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={`alert ${variant}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {children}
    </div>
  );
}
