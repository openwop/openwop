/**
 * RunTimeline — graphical, node-keyed execution timeline for a run.
 *
 * Where `EventStreamView` renders the ordered event log as a flat text
 * list, this paints the same `RunEventDoc[]` as horizontal swimlanes,
 * one per `nodeId`, with duration bars positioned on a shared time
 * axis. A node that runs more than once (retries / loop bodies) gets
 * one bar per attempt; bars are colored by terminal status. Clicking a
 * bar selects it and reveals its underlying events (inspect), with a
 * fork button keyed to the segment's last sequence.
 *
 * Protocol surface (RFC 0002, Done): the ordered event log carries
 * `sequence` + `timestamp`; `node.started` / `node.completed` /
 * `node.failed` / `node.suspended` delimit per-node spans.
 */

import { useMemo, useState } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { SaveIcon } from '../ui/icons/index.js';

interface Props {
  events: readonly RunEventDoc[];
  onForkFrom?: (sequence: number) => void;
  /** §A4 playhead — fires the selected segment's last sequence (or null on
   *  deselect) so a parent can drive synchronized inspector panels. */
  onSelectSeq?: (seq: number | null) => void;
}

type SegStatus = 'running' | 'completed' | 'failed' | 'suspended';

interface Segment {
  nodeId: string;
  startMs: number;
  endMs: number | null;
  status: SegStatus;
  startSeq: number;
  lastSeq: number;
  events: RunEventDoc[];
}

const SEG_COLOR: Record<SegStatus, string> = {
  running: 'var(--clay)',
  completed: '#10b981',
  failed: '#ef4444',
  suspended: '#8b5cf6',
};

// Fold the event log into per-node segments. A `node.started` opens a
// segment; the next terminal node event (`completed`/`failed`/
// `suspended`) for that node closes it. Events without a `nodeId`
// (run.* lifecycle) are collected into a synthetic top lane.
function buildSegments(events: readonly RunEventDoc[]): {
  lanes: { nodeId: string; segments: Segment[] }[];
  minMs: number;
  maxMs: number;
} {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const open = new Map<string, Segment>();
  const laneOrder: string[] = [];
  const byNode = new Map<string, Segment[]>();
  let minMs = Infinity;
  let maxMs = -Infinity;

  const ensureLane = (nodeId: string) => {
    if (!byNode.has(nodeId)) {
      byNode.set(nodeId, []);
      laneOrder.push(nodeId);
    }
    return byNode.get(nodeId)!;
  };

  for (const ev of sorted) {
    const ms = Date.parse(ev.timestamp);
    if (!Number.isNaN(ms)) {
      minMs = Math.min(minMs, ms);
      maxMs = Math.max(maxMs, ms);
    }
    const nodeId = ev.nodeId ?? '(run)';
    const lane = ensureLane(nodeId);

    if (ev.nodeId && ev.type === 'node.started') {
      // Close any dangling open segment first (defensive — a started
      // without a prior close means an out-of-order or missing event).
      const prior = open.get(nodeId);
      if (prior && prior.endMs === null) prior.endMs = ms;
      const seg: Segment = {
        nodeId,
        startMs: Number.isNaN(ms) ? 0 : ms,
        endMs: null,
        status: 'running',
        startSeq: ev.sequence,
        lastSeq: ev.sequence,
        events: [ev],
      };
      open.set(nodeId, seg);
      lane.push(seg);
      continue;
    }

    const cur = open.get(nodeId);
    if (cur) {
      cur.events.push(ev);
      cur.lastSeq = ev.sequence;
      if (ev.type === 'node.completed') { cur.status = 'completed'; cur.endMs = ms; }
      else if (ev.type === 'node.failed') { cur.status = 'failed'; cur.endMs = ms; }
      else if (ev.type === 'node.suspended') { cur.status = 'suspended'; cur.endMs = ms; }
    } else {
      // Event for a node with no open segment (e.g. a lone run.* event,
      // or agent.* between spans). Park it in a zero-width marker so the
      // lane still exists and the event is inspectable.
      lane.push({
        nodeId,
        startMs: Number.isNaN(ms) ? 0 : ms,
        endMs: Number.isNaN(ms) ? 0 : ms,
        status: 'completed',
        startSeq: ev.sequence,
        lastSeq: ev.sequence,
        events: [ev],
      });
    }
  }

  if (!Number.isFinite(minMs)) { minMs = 0; maxMs = 1; }
  if (maxMs <= minMs) maxMs = minMs + 1;

  return {
    lanes: laneOrder.map((nodeId) => ({ nodeId, segments: byNode.get(nodeId)! })),
    minMs,
    maxMs,
  };
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function RunTimeline({ events, onForkFrom, onSelectSeq }: Props) {
  const { lanes, minMs, maxMs } = useMemo(() => buildSegments(events), [events]);
  // §A3(b) / RFC 0057 — per-lane memory-write attribution from `memory.written`
  // events (keyed by `nodeId`, or `(run)` for host session-end writes). The
  // payload is content-free, so we surface counts + the memoryRef only.
  const memWrites = useMemo(() => {
    const m = new Map<string, { count: number; refs: string[] }>();
    for (const ev of events) {
      if (ev.type !== 'memory.written') continue;
      const key = ev.nodeId ?? '(run)';
      const ref = (ev.payload as { memoryRef?: unknown } | undefined)?.memoryRef;
      const cur = m.get(key) ?? { count: 0, refs: [] };
      cur.count += 1;
      if (typeof ref === 'string' && !cur.refs.includes(ref)) cur.refs.push(ref);
      m.set(key, cur);
    }
    return m;
  }, [events]);
  const [selected, setSelected] = useState<{ nodeId: string; startSeq: number } | null>(null);

  if (events.length === 0) return <div className="muted">No events yet.</div>;

  const span = maxMs - minMs;
  const pct = (ms: number) => ((ms - minMs) / span) * 100;
  const selectedSeg = selected
    ? lanes
        .find((l) => l.nodeId === selected.nodeId)
        ?.segments.find((s) => s.startSeq === selected.startSeq) ?? null
    : null;

  return (
    <div className="run-timeline">
      <div className="run-timeline-axis muted">
        <span>0</span>
        <span>{fmtDuration(span)}</span>
      </div>
      <div className="run-timeline-lanes">
        {lanes.map((lane) => (
          <div className="run-timeline-lane" key={lane.nodeId}>
            <div className="run-timeline-lane-label" title={lane.nodeId}>
              {lane.nodeId}
              {lane.segments.length > 1 && lane.nodeId !== '(run)' && (
                <span className="muted run-timeline-attempts"> ×{lane.segments.length}</span>
              )}
              {(() => {
                const mw = memWrites.get(lane.nodeId);
                if (!mw) return null;
                return (
                  <span
                    className="muted run-timeline-mem-write"
                    title={`Wrote ${mw.count} memory entr${mw.count === 1 ? 'y' : 'ies'} (RFC 0057)${mw.refs.length ? ` → ${mw.refs.join(', ')}` : ''}`}
                  >
                    {' '}<span aria-hidden="true"><SaveIcon size={12} /></span>{mw.count > 1 ? ` ${mw.count}` : ''}
                  </span>
                );
              })()}
            </div>
            <div className="run-timeline-track">
              {lane.segments.map((seg) => {
                const left = pct(seg.startMs);
                const endMs = seg.endMs ?? maxMs;
                const width = Math.max(pct(endMs) - left, 1.5);
                const isSel = selected?.nodeId === seg.nodeId && selected.startSeq === seg.startSeq;
                const dur = seg.endMs != null ? fmtDuration(seg.endMs - seg.startMs) : 'running…';
                return (
                  <button
                    type="button"
                    key={seg.startSeq}
                    className={`run-timeline-bar${isSel ? ' run-timeline-bar-selected' : ''}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: SEG_COLOR[seg.status],
                      animation: seg.status === 'running' ? 'openwop-pulse 1.2s ease-in-out infinite' : 'none',
                    }}
                    onClick={() => {
                      const next = isSel ? null : { nodeId: seg.nodeId, startSeq: seg.startSeq };
                      setSelected(next);
                      onSelectSeq?.(next ? seg.lastSeq : null);
                    }}
                    aria-pressed={isSel}
                    aria-label={`${seg.nodeId}, ${seg.status}, ${dur} — select to inspect this step`}
                    title={`${seg.nodeId} — ${seg.status} — ${dur}`}
                  >
                    <span className="run-timeline-bar-dur">{dur}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedSeg && (
        <div className="run-timeline-detail card">
          <div className="run-timeline-detail-head">
            <strong>{selectedSeg.nodeId}</strong>
            <span className="status-badge" style={{ background: SEG_COLOR[selectedSeg.status] }}>
              {selectedSeg.status}
            </span>
            {onForkFrom && (
              <button
                type="button"
                className="secondary"
                style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
                onClick={() => onForkFrom(selectedSeg.lastSeq)}
                title="Fork a new run from this segment's last event"
              >
                fork from #{selectedSeg.lastSeq}
              </button>
            )}
          </div>
          {selectedSeg.events.map((ev) => (
            <div className="event" key={ev.eventId}>
              <span className="event-seq">#{ev.sequence}</span>
              <span className="event-type">{ev.type}</span>
              {ev.payload != null && Object.keys(ev.payload as object).length > 0 && (
                <details>
                  <summary className="muted">payload</summary>
                  <pre>{JSON.stringify(ev.payload, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
