/**
 * TruncationCard — RFC 0032 §B.4 `envelope.truncated` event.
 *
 * The model stopped emitting before the envelope was complete. Surfaces
 * the stop reason + the partial-payload availability + (when known) the
 * output token count. Sets a hint chip when a continuation retry with a
 * bumped budget is in flight (RFC 0033).
 */

import type { EnvelopeTruncation } from '../types.js';

interface Props {
  truncation: EnvelopeTruncation;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'max_tokens': return 'hit max-tokens cap';
    case 'length': return 'provider length cap';
    case 'stop_sequence': return 'stop sequence';
    default: return reason;
  }
}

export function TruncationCard({ truncation }: Props): JSX.Element {
  return (
    <div className="env-chip env-chip-warning" role="status" aria-label="Envelope output was truncated">
      <span className="env-chip-tag">TRUNCATED</span>
      <span className="env-chip-text">
        <span className="env-chip-mono">{truncation.provider}/{truncation.model}</span> — {reasonLabel(truncation.stopReason)}
        {typeof truncation.outputTokenCount === 'number' ? (
          <> · <span className="env-chip-mono">{truncation.outputTokenCount} tokens</span></>
        ) : null}
      </span>
      {truncation.partialPayloadAvailable ? (
        <span className="env-chip-pill">partial payload recovered</span>
      ) : null}
    </div>
  );
}
