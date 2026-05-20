/**
 * CapabilityInsufficientCard — RFC 0031 §D `model.capability.insufficient` event.
 *
 * The host couldn't find any model that satisfies the required capability
 * set, so the node is blocked. Renders as a danger-tinted action chip;
 * the "Choose a different model" CTA opens BYOK (wired by the parent
 * MessageBubble when an onReconfigureBYOK callback is in scope).
 */

import type { ModelCapabilityInsufficient } from '../types.js';

interface Props {
  ci: ModelCapabilityInsufficient;
  onReconfigure?: () => void;
}

export function CapabilityInsufficientCard({ ci, onReconfigure }: Props): JSX.Element {
  return (
    <div className="env-chip env-chip-danger" role="alert" aria-label="Model capability insufficient">
      <span className="env-chip-tag">MODEL INSUFFICIENT</span>
      <span className="env-chip-text">
        <span className="env-chip-mono">{ci.provider}/{ci.model}</span> lacks{' '}
        {ci.missingCapabilities.map((c, i) => (
          <span key={c}>
            <span className="env-chip-pill">{c}</span>
            {i < ci.missingCapabilities.length - 1 ? ' ' : ''}
          </span>
        ))}
        {ci.fallbackAttempted ? <> · no fallback model satisfies the requirements</> : null}
      </span>
      {onReconfigure ? (
        <button type="button" className="env-chip-action" onClick={onReconfigure}>
          Choose a different model
        </button>
      ) : null}
    </div>
  );
}
