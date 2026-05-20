/**
 * RetryExhaustedCard — RFC 0032 §B.2 `envelope.retry.exhausted` event.
 *
 * Action-required state: the host gave up after N attempts. Clay-rule
 * outline marks the urgency.
 */

import { useState } from 'react';
import type { EnvelopeRetryExhausted } from '../types.js';

interface Props {
  exhausted: EnvelopeRetryExhausted;
}

export function RetryExhaustedCard({ exhausted }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="env-chip env-chip-danger" role="alert" aria-label="Envelope retry exhausted">
      <span className="env-chip-tag">RETRY EXHAUSTED</span>
      <span className="env-chip-text">
        Gave up after {exhausted.totalAttempts} attempt{exhausted.totalAttempts === 1 ? '' : 's'} — {exhausted.finalReason}
      </span>
      {exhausted.finalError ? (
        <button
          type="button"
          className="env-chip-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'hide error' : 'show error'}
        </button>
      ) : null}
      {open && exhausted.finalError ? (
        <pre className="env-chip-detail">{exhausted.finalError}</pre>
      ) : null}
    </div>
  );
}
