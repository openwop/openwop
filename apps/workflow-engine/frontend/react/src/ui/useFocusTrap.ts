/**
 * useFocusTrap — keyboard focus containment + restore for dialogs, drawers,
 * and the interrupt cards (HITL approval flow, DESIGN §11). While `active`:
 *   - focus moves into the container (first focusable, or the container itself),
 *   - Tab / Shift+Tab cycle within the container,
 *   - on deactivate, focus returns to whatever held it before.
 *
 * Returns a ref to attach to the trap container. Shared so the `<Modal>` /
 * `<Drawer>` primitives and the interrupt cards don't each re-implement it.
 */

import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const container = ref.current;
    if (!container) return;
    const items = focusable(container);
    if (items.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const activeEl = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (activeEl === first || !container.contains(activeEl))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const items = focusable(container);
    (items[0] ?? container).focus();
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to the opener if it is still in the document.
      const prev = restoreTo.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [active, onKeyDown]);

  return ref;
}
