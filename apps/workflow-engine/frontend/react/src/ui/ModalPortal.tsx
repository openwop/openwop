import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Render an overlay at `document.body` — the ONLY layer where
 * `position: fixed` is guaranteed to mean the viewport.
 *
 * Why this exists: `.page-enter > *` applies a filled transform animation to
 * every page section, and a transformed/filtered/animated ancestor becomes
 * the CONTAINING BLOCK for fixed-position descendants — so a scrim rendered
 * inline ends up sized/centered to the content column instead of the page
 * (the create-board-dialog bug, 2026-06-05). Every full-page scrim (modals,
 * drawers) MUST render through this portal.
 */
export function ModalPortal({ children }: { children: ReactNode }): JSX.Element {
  return createPortal(children, document.body);
}
