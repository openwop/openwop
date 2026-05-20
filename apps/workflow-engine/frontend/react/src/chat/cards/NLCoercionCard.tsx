/**
 * NLCoercionCard — RFC 0032 §B.5 `envelope.nlToFormat.engaged` event.
 *
 * The model returned natural-language prose where the host expected a
 * structured envelope; the host invoked the NL→format coercion path
 * (a second LLM call that translates the prose into the right shape).
 * Quiet info chip — most users don't need to think about this, but the
 * extra round-trip is visible to anyone counting tokens.
 */

import type { EnvelopeNLCoercion } from '../types.js';

interface Props {
  coercion: EnvelopeNLCoercion;
}

export function NLCoercionCard({ coercion }: Props): JSX.Element {
  return (
    <div className="env-chip env-chip-info" role="status" aria-label="Natural-language to format coercion engaged">
      <span className="env-chip-tag">NL → FORMAT</span>
      <span className="env-chip-text">
        Coerced prose response into <span className="env-chip-mono">{coercion.originalEnvelopeType}</span>
        {typeof coercion.fallbackCalls === 'number' ? (
          <> · {coercion.fallbackCalls} fallback call{coercion.fallbackCalls === 1 ? '' : 's'}</>
        ) : null}
      </span>
    </div>
  );
}
