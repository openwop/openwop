/**
 * Card registry — extensibility surface for chat-inline card rendering.
 *
 * Adopters register card components by `cardType` string. The chat
 * panel dispatches by that string when rendering an event payload of
 * the corresponding kind, with a generic fallback if no registration
 * exists. Each card is wrapped in an error boundary so a broken
 * third-party card doesn't crash the panel.
 *
 * Built-in registrations live in `defaultCards.ts` — the 4 interrupt
 * kinds (approval/clarification/refinement/cancellation). Add a custom
 * card by calling `registerCard({...})` from your own module at app
 * boot. See the README for examples.
 */

import type React from 'react';

export interface CardContext {
  /** The openwop run id the card belongs to. */
  runId: string;
  /** The node id that emitted the suspension or artifact, when applicable. */
  nodeId?: string;
  /** The tenant id; for sample purposes `'demo'`. */
  tenantId: string;
}

export interface CardProps {
  /** The persisted payload — interrupt record, artifact, custom event data. */
  payload: unknown;
  /** Discriminator. Convention: `interrupt.<kind>` / `artifact.<type>` / `event.<type>`. */
  cardType: string;
  /** Context about the source run/node. */
  context: CardContext;
  /** Action dispatcher — resolves to the registered actionHandler (or bubbles to engine). */
  onAction: (actionId: string, payload?: unknown) => Promise<void>;
  /** Loading state set by the parent during in-flight action. */
  isLoading?: boolean;
}

export type CardActionHandler = (
  actionPayload: unknown,
  ctx: CardContext,
) => Promise<boolean> | boolean;

export interface CardRegistration {
  /** Stable string discriminator. */
  cardType: string;
  /** Human-readable label for tooltips + debug. */
  label: string;
  /** Main component for this card. Receives CardProps. */
  Component: React.ComponentType<CardProps>;
  /** Optional compact preview shown when the card is collapsed. */
  PreviewComponent?: React.ComponentType<CardProps>;
  /**
   * Optional action handlers keyed by actionId. Return `true` to mark
   * the action consumed locally; return `false` to bubble it up to the
   * engine's default dispatcher (e.g., POST /v1/runs/.../interrupts/...).
   */
  actionHandlers?: Record<string, CardActionHandler>;
}
