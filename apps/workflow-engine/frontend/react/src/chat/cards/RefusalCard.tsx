/**
 * RefusalCard — RFC 0032 §B.3 `envelope.refusal` event.
 *
 * The model declined to answer. Surfaces the safety category as a chip
 * and the refusal text quoted as a blockquote (truncated to 240 chars
 * by default; full text on expand).
 */

import { useState } from 'react';
import type { EnvelopeRefusal } from '../types.js';

const PREVIEW_LEN = 240;

interface Props {
  refusal: EnvelopeRefusal;
}

export function RefusalCard({ refusal }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const text = refusal.refusalText ?? '';
  const isLong = text.length > PREVIEW_LEN;
  const visible = expanded || !isLong ? text : text.slice(0, PREVIEW_LEN) + '…';
  return (
    <div className="env-chip env-chip-warning" role="status" aria-label="Model refused to answer">
      <span className="env-chip-tag">REFUSAL</span>
      <span className="env-chip-text">
        <span className="env-chip-mono">{refusal.provider}/{refusal.model}</span> declined
        {refusal.safetyCategory ? (
          <> · <span className="env-chip-pill">{refusal.safetyCategory}</span></>
        ) : null}
      </span>
      {text ? (
        <blockquote className="env-chip-quote">
          {visible}
          {isLong ? (
            <button type="button" className="env-chip-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'collapse' : 'show full'}
            </button>
          ) : null}
        </blockquote>
      ) : null}
    </div>
  );
}
