/**
 * RecoveryCard — RFC 0032 §B.6 `envelope.recovery.applied` event.
 *
 * The host recovered a partial envelope by parsing up to a specific
 * byte offset. Technical / low-noise; renders as a tiny mono chip.
 * Mostly useful next to a TruncationCard for the same node.
 */

import type { EnvelopeRecovery } from '../types.js';

interface Props {
  recovery: EnvelopeRecovery;
}

export function RecoveryCard({ recovery }: Props): JSX.Element {
  return (
    <div className="env-chip env-chip-muted" role="status" aria-label="Envelope partial recovery applied">
      <span className="env-chip-tag">RECOVERED</span>
      <span className="env-chip-text">
        Partial envelope salvaged at <span className="env-chip-mono">{recovery.path}</span>
        {typeof recovery.byteOffset === 'number' ? (
          <> · <span className="env-chip-mono">@{recovery.byteOffset}b</span></>
        ) : null}
      </span>
    </div>
  );
}
