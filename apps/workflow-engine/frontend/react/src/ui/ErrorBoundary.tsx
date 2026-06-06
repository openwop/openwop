/**
 * ErrorBoundary — the app-wide render-crash guard. Generalized from the
 * chat-card boundary (`chat/registry/CardHost.tsx`) so any subtree — and the
 * whole route tree (see `App.tsx`) — degrades to a recoverable StateCard
 * instead of white-screening the SPA. A single render throw (made likely by
 * unvalidated host-extension response casts) is now caught, logged, and
 * offered a reload, not fatal.
 *
 * Reset semantics: pass `resetKey` (e.g. the current pathname). When it
 * changes, the boundary clears its error so navigating away from a crashed
 * route recovers without a full reload.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StateCard } from './StateCard.js';
import { AlertIcon, RotateCwIcon } from './icons/index.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** When this value changes, a caught error is cleared. Pass the route path. */
  resetKey?: string | number;
  /** Human label for the crashed region, used in the fallback + log. */
  label?: string;
  /** Optional custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    // Clear the error when the reset key changes (e.g. route navigation).
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary] ${this.props.label ?? 'subtree'} crashed:`, error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <StateCard
        icon={<AlertIcon size={26} />}
        title="Something went wrong"
        body={
          <>
            {this.props.label ? `The ${this.props.label} hit an unexpected error. ` : 'This view hit an unexpected error. '}
            You can reload to recover.
            {error.message ? <div style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono, monospace)', fontSize: '12px' }}>{error.message}</div> : null}
          </>
        }
        action={
          <button type="button" className="btn-accent-solid btn-sm" onClick={() => window.location.reload()}>
            <RotateCwIcon size={14} aria-hidden /> Reload
          </button>
        }
      />
    );
  }
}
