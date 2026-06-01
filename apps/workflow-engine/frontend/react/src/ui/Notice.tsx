/**
 * Notice — the one transient-notice primitive across Agents / Workflows /
 * Kanban. Routes through the token-anchored `.alert.*` classes (no hardcoded
 * hex), leads with the matching Lucide icon (not an emoji prefix), and
 * announces to assistive tech via `role="status"` + `aria-live`.
 */

import { AlertIcon, CheckIcon } from './icons/index.js';

export type NoticeVariant = 'success' | 'error' | 'info' | 'warning';

function VariantIcon({ variant }: { variant: NoticeVariant }): JSX.Element | null {
  if (variant === 'success') return <CheckIcon size={15} />;
  if (variant === 'error' || variant === 'warning') return <AlertIcon size={15} />;
  return null;
}

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
      style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}
    >
      <span style={{ flexShrink: 0, display: 'inline-flex', marginTop: 1 }}><VariantIcon variant={variant} /></span>
      <span>{children}</span>
    </div>
  );
}
