/**
 * Card host — looks up the registration for a given cardType, wraps
 * the component in an error boundary, and renders it. Adopters use
 * this component as the single mounting point for chat-inline cards.
 */

import { Component, type ReactNode } from 'react';
import { getCard } from './CardRegistry.js';
import type { CardProps } from './types.js';

interface ErrorBoundaryProps {
  cardType: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class CardErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error(`[CardHost] card "${this.props.cardType}" threw:`, error);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="alert error" style={{ margin: 'var(--space-2) 0' }}>
          Card <code>{this.props.cardType}</code> crashed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function CardHost(props: CardProps): JSX.Element {
  const registration = getCard(props.cardType);
  if (!registration) {
    return (
      <div className="alert info" style={{ margin: 'var(--space-2) 0' }}>
        No card registered for <code>{props.cardType}</code>. Register one with{' '}
        <code>registerCard()</code>.
      </div>
    );
  }
  const { Component: CardComponent } = registration;
  return (
    <CardErrorBoundary cardType={props.cardType}>
      <CardComponent {...props} />
    </CardErrorBoundary>
  );
}
