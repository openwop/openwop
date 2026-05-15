import type { RunEventDoc } from '@openwop/openwop';

interface Props {
  events: readonly RunEventDoc[];
  onForkFrom?: (sequence: number) => void;
}

export function EventStreamView({ events, onForkFrom }: Props) {
  if (events.length === 0) {
    return <div className="muted">No events yet.</div>;
  }
  return (
    <div className="event-stream">
      {events.map((ev) => (
        <div className="event" key={`${ev.runId}-${ev.sequence}`}>
          <span className="event-seq">#{ev.sequence}</span>
          <span className="event-type">{ev.type}</span>
          {ev.nodeId && <span className="muted"> [{ev.nodeId}]</span>}
          {onForkFrom && (
            <button
              className="secondary"
              style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }}
              onClick={() => onForkFrom(ev.sequence)}
              title="Fork a new run from this event (branch mode)"
            >
              fork
            </button>
          )}
          {ev.payload != null && Object.keys(ev.payload as object).length > 0 && (
            <details>
              <summary className="muted">payload</summary>
              <pre>{JSON.stringify(ev.payload, null, 2)}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
