/**
 * RetryAttemptCard — RFC 0032 §B.1 `envelope.retry.attempted` event.
 *
 * Mono "RETRY N" pill + reason chip + collapsed previousError details.
 * The narrative reads as: "The host re-asked the model because <reason>."
 */

import { useState } from 'react';
import type { EnvelopeRetryAttempt } from '../types.js';

interface Props {
  retry: EnvelopeRetryAttempt;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'schema-violation': return 'schema mismatch';
    case 'truncation': return 'output cut off';
    case 'refusal': return 'model refused';
    default: return reason;
  }
}

export function RetryAttemptCard({ retry }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="env-chip env-chip-info" role="status" aria-label={`Envelope retry attempt ${retry.attempt}`}>
      <span className="env-chip-tag">RETRY {retry.attempt}</span>
      <span className="env-chip-text">Re-asked the model — {reasonLabel(retry.reason)}</span>
      {retry.previousError ? (
        <button
          type="button"
          className="env-chip-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'hide error' : 'show error'}
        </button>
      ) : null}
      {open && retry.previousError ? (
        <pre className="env-chip-detail">{retry.previousError}</pre>
      ) : null}
    </div>
  );
}
