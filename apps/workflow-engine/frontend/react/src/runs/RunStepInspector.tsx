/**
 * RunStepInspector — §A4 "debugging studio" playhead. Driven by the
 * RunTimeline selection (its `onSelectSeq`), it shows the event(s) at the
 * selected sequence plus the agent activity *up to that point*, so the
 * timeline becomes a scrubber synchronized with the inspector — and any
 * step is one click from a fork. Pure composition of existing surfaces.
 */
import { useMemo } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { RunAgentTrace } from './RunAgentTrace.js';

interface Props {
  events: readonly RunEventDoc[];
  seq: number;
  onForkFrom?: (seq: number) => void;
}

export function RunStepInspector({ events, seq, onForkFrom }: Props) {
  const atSeq = useMemo(() => events.filter((e) => e.sequence === seq), [events, seq]);
  const upToHere = useMemo(
    () => events.filter((e) => e.sequence <= seq).sort((a, b) => a.sequence - b.sequence),
    [events, seq],
  );

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>
          Step inspector <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· at #{seq}</span>
        </h2>
        {onForkFrom && (
          <button type="button" className="secondary" onClick={() => onForkFrom(seq)} title="Fork a new run from this point">
            Fork from here
          </button>
        )}
      </div>

      {atSeq.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No event at #{seq}.</p>
      ) : (
        atSeq.map((ev) => (
          <div key={ev.sequence} style={{ marginTop: 8 }}>
            <code style={{ fontSize: 12 }}>{ev.type}</code>
            <pre style={{ marginTop: 4, maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(ev.payload ?? {}, null, 2)}</pre>
          </div>
        ))
      )}

      <h3 style={{ margin: '8px 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)' }}>
        Agent activity up to this point
      </h3>
      <RunAgentTrace events={upToHere} />
    </div>
  );
}
