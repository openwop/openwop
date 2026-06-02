import { useSyncExternalStore } from 'react';
import { CheckIcon, AlertIcon, InfoIcon, XIcon } from './icons/index.js';

/**
 * Toast — the app's ephemeral async-feedback layer (gap #9). Distinct from
 * <Notice> (inline, persistent, in-flow): toasts stack bottom-right, auto-
 * dismiss, and never block. Imperative `toast.success(...)` from anywhere;
 * <Toaster> is mounted once at the app shell. Token-only `.toast-*` styling,
 * reuses the `.alert.*` colour families; announces via role=status/alert.
 */

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';
export interface ToastItem { id: number; variant: ToastVariant; message: string }

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function emit() {
  // New array identity so useSyncExternalStore sees the change.
  items = items.slice();
  listeners.forEach((l) => l());
}

function push(variant: ToastVariant, message: string, ttlMs: number): number {
  const id = ++seq;
  items = [...items, { id, variant, message }];
  emit();
  if (ttlMs > 0) {
    // setTimeout is non-deterministic but this is pure UI chrome.
    setTimeout(() => dismiss(id), ttlMs);
  }
  return id;
}

export function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string, ttlMs = 4000) => push('success', m, ttlMs),
  error: (m: string, ttlMs = 6000) => push('error', m, ttlMs),
  info: (m: string, ttlMs = 4000) => push('info', m, ttlMs),
  warning: (m: string, ttlMs = 5000) => push('warning', m, ttlMs),
};

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): ToastItem[] { return items; }

function VariantIcon({ variant }: { variant: ToastVariant }): JSX.Element {
  if (variant === 'success') return <CheckIcon size={15} />;
  if (variant === 'info') return <InfoIcon size={15} />;
  return <AlertIcon size={15} />; // error + warning
}

export function Toaster(): JSX.Element {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast alert ${t.variant}`} role={t.variant === 'error' ? 'alert' : 'status'}>
          <span className="toast-icon" aria-hidden><VariantIcon variant={t.variant} /></span>
          <span className="toast-message">{t.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
