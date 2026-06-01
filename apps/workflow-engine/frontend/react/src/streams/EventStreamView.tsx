import type { RunEventDoc } from '@openwop/openwop';
import { config } from '../client/config.js';
import { PaperclipIcon } from '../ui/icons/index.js';

interface Props {
  events: readonly RunEventDoc[];
  onForkFrom?: (sequence: number) => void;
}

/** Resolve a host-served asset URL (RFC 0055 §C — relative `/v1/host/...`)
 *  against the API base. Only http(s) / `/`-relative pass; an LLM-influenced
 *  `javascript:`/`data:` URL is refused (this renders into a live <img>). */
function resolveAssetUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const u = url.trim();
  if (u.startsWith('/')) return `${config.baseUrl}${u}`;
  return /^https?:\/\//i.test(u) ? u : null;
}

/** RFC 0055 §C — render a `media.{image,audio,file}` event's referenced asset
 *  inline so the run's emitted media is actually visible, not just JSON. */
function MediaEventPreview({ type, payload }: { type: string; payload: unknown }): JSX.Element | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    url?: unknown;
    mimeType?: unknown;
    alt?: unknown;
  };
  const src = resolveAssetUrl(p.url);
  if (!src) return null;
  const alt = typeof p.alt === 'string' ? p.alt : 'emitted media';
  if (type === 'media.image') {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{ display: 'block', marginTop: 4, maxWidth: 200, maxHeight: 160, borderRadius: 4, border: '1px solid var(--color-border)' }}
      />
    );
  }
  if (type === 'media.audio') {
    return <audio controls preload="none" src={src} style={{ display: 'block', marginTop: 4, height: 28 }} />;
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 4, fontSize: 12 }}>
      <PaperclipIcon size={12} /> download asset
    </a>
  );
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
          {typeof ev.type === 'string' && ev.type.startsWith('media.') && (
            <MediaEventPreview type={ev.type} payload={ev.payload} />
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
