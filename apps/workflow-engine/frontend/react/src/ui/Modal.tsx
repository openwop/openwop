/**
 * Modal — the shared centered-dialog shell (GAP-ANALYSIS E7). Owns the one
 * scrim + Escape + role="dialog"/aria-modal + focus-trap-and-restore that ~18
 * dialogs each re-implemented (and most got wrong — they focused on mount but
 * never trapped Tab or restored focus on close). Built on ModalPortal (fixed-
 * position escape from transformed ancestors) + useFocusTrap.
 *
 * Dialogs provide only their content; `onClose` fires on scrim click + Escape.
 */

import { useEffect, type ReactNode } from 'react';
import { ModalPortal } from './ModalPortal.js';
import { useFocusTrap } from './useFocusTrap.js';

export function Modal({
  onClose,
  label,
  children,
  className = 'surface-card hire-modal',
  scrimClassName = 'hire-scrim',
}: {
  onClose: () => void;
  /** Accessible name for the dialog (aria-label). */
  label: string;
  children: ReactNode;
  /** Override the dialog box class (default matches the hire/board modals). */
  className?: string;
  /** Override the scrim class. */
  scrimClassName?: string;
}): JSX.Element {
  const ref = useFocusTrap<HTMLDivElement>(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <ModalPortal>
      <div className={scrimClassName} onClick={onClose}>
        <div
          ref={ref}
          tabIndex={-1}
          className={className}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}
