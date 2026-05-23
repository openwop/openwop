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
      <EventStreamActions events={events} />
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

// Toolbar above the event list — Copy yields a code-fenced markdown
// block sized for pasting into Claude Code / other LLM chats; Export
// downloads the raw JSON array for offline triage.
function EventStreamActions({ events }: { events: readonly RunEventDoc[] }) {
  const runId = events[0]?.runId ?? 'run';
  const copy = async () => {
    const text = formatEventsAsMarkdown(events);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers without clipboard API (HTTP, old Safari).
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${runId}-events.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <div className="event-stream-actions">
      <button
        type="button"
        className="secondary"
        onClick={copy}
        title="Copy events as markdown (paste into Claude Code, Slack, GitHub)"
      >
        Copy
      </button>
      <button
        type="button"
        className="secondary"
        onClick={exportJson}
        title="Download the full event log as JSON"
      >
        Export JSON
      </button>
      <span className="muted" style={{ fontSize: 12 }}>{events.length} events</span>
    </div>
  );
}

function formatEventsAsMarkdown(events: readonly RunEventDoc[]): string {
  const runId = events[0]?.runId ?? '(unknown)';
  const lines: string[] = [
    `# Run ${runId} — event stream`,
    `${events.length} events`,
    '',
    '```',
  ];
  for (const ev of events) {
    const nodeId = ev.nodeId ? ` [${ev.nodeId}]` : '';
    lines.push(`#${ev.sequence} ${ev.type}${nodeId}`);
    if (ev.payload != null && Object.keys(ev.payload as object).length > 0) {
      const payload = JSON.stringify(ev.payload, null, 2);
      for (const l of payload.split('\n')) lines.push(`  ${l}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}
