import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RunSnapshot, RunEventDoc, StreamMode } from '@openwop/openwop';
import { cancelRun, forkRun, getRun, pollEvents } from '../client/runsClient.js';
import { subscribeToRun } from '../client/streamsClient.js';
import { listOpenInterrupts, type OpenInterrupt } from '../client/interruptsClient.js';
import { EventStreamView } from '../streams/EventStreamView.js';
import { RunTimeline } from './RunTimeline.js';
import { RunAgentTrace } from './RunAgentTrace.js';
import { RunHandoffMap } from './RunHandoffMap.js';
import { RunCostPanel } from './RunCostPanel.js';
import { RunOpsPanel } from './RunOpsPanel.js';
import { RenderInterrupt } from '../interrupts/RenderInterrupt.js';

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [events, setEvents] = useState<RunEventDoc[]>([]);
  const [activeInterrupt, setActiveInterrupt] = useState<OpenInterrupt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventView, setEventView] = useState<'timeline' | 'log'>('timeline');
  const [streamMode, setStreamMode] = useState<StreamMode>('updates');

  const refreshInterrupts = useCallback(async () => {
    if (!runId) return;
    try {
      const open = await listOpenInterrupts(runId);
      setActiveInterrupt(open.length > 0 ? (open[open.length - 1] ?? null) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  // Initial snapshot + replay buffered events + open-interrupt fetch.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getRun(runId);
        if (!cancelled) setSnapshot(snap);
        const polled = await pollEvents(runId, 0);
        if (!cancelled) setEvents([...polled.events]);
        await refreshInterrupts();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, refreshInterrupts]);

  // Subscribe to live SSE events.
  useEffect(() => {
    if (!runId) return;
    const sub = subscribeToRun(runId, {
      modes: [streamMode],
      // Run-watching can be long and idle between nodes (HITL waits,
      // slow providers). Relax the default 30s idle / 120s absolute
      // timeouts so the live overlay / panels keep painting; the idle
      // timer still resets on every event so a genuinely hung stream
      // is still caught.
      idleTimeoutMs: 5 * 60_000,
      absoluteTimeoutMs: 30 * 60_000,
      onEvent: (ev) => {
        setEvents((prev) => {
          // Dedupe by sequence; events arriving out-of-order keep monotone order.
          if (prev.some((e) => e.sequence === ev.sequence)) return prev;
          const next = [...prev, ev].sort((a, b) => a.sequence - b.sequence);
          // Refresh snapshot whenever a terminal or transition event arrives.
          if (
            ['run.completed', 'run.failed', 'run.cancelled', 'node.suspended', 'node.interrupt.resolved'].includes(ev.type)
          ) {
            getRun(runId).then(setSnapshot).catch(() => undefined);
          }
          // On terminal events, re-poll the full event log via REST. The
          // SSE stream may not carry every event family the panels read
          // (cost / reasoning / handoff); the authoritative log backfills
          // anything the live stream missed so the panels are complete.
          if (['run.completed', 'run.failed', 'run.cancelled'].includes(ev.type)) {
            pollEvents(runId, 0)
              .then((p) => setEvents([...p.events]))
              .catch(() => undefined);
          }
          // Interrupt-related transitions trigger an authenticated refetch
          // because the public event payload no longer carries the resume token.
          if (['node.suspended', 'node.interrupt.resolved'].includes(ev.type)) {
            refreshInterrupts();
          }
          return next;
        });
      },
      onError: () => setError('Event stream connection error (will reconnect)'),
    });
    return () => sub.close();
  }, [runId, refreshInterrupts, streamMode]);

  async function onCancel() {
    if (!runId) return;
    try {
      await cancelRun(runId, 'cancelled from sample UI');
      const snap = await getRun(runId);
      setSnapshot(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onForkFrom(seq: number) {
    if (!runId) return;
    try {
      const res = await forkRun(runId, { fromSeq: seq, mode: 'branch' });
      window.location.href = `/runs/${res.runId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!runId) return <div className="alert error">No run ID in URL.</div>;

  return (
    <section>
      <div className="card">
        <h2>
          Run <code>{runId}</code>
          {snapshot && <span className={`status-badge ${snapshot.status}`} style={{ marginLeft: 8 }}>{snapshot.status}</span>}
        </h2>
        {snapshot && (
          <pre>{JSON.stringify(snapshot, null, 2)}</pre>
        )}
        {error && <div className="alert error">{error}</div>}
        <div className="button-row">
          <button className="secondary" onClick={onCancel} disabled={!snapshot || ['completed', 'failed', 'cancelled'].includes(snapshot.status)}>
            Cancel run
          </button>
          <button
            className="secondary"
            onClick={() => { window.location.href = `/compare?a=${encodeURIComponent(runId)}`; }}
            title="Compare this run side-by-side with another"
          >
            Compare…
          </button>
        </div>
      </div>

      <RenderInterrupt
        runId={runId}
        active={activeInterrupt}
        onResolved={async () => {
          const snap = await getRun(runId);
          setSnapshot(snap);
          await refreshInterrupts();
        }}
      />

      <RunCostPanel events={events} />
      <RunHandoffMap events={events} />
      <RunAgentTrace events={events} />
      <RunOpsPanel runId={runId} events={events} />

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ flex: 1 }}>Event stream</h2>
          <label className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            mode
            <select
              value={streamMode}
              onChange={(e) => setStreamMode(e.target.value as StreamMode)}
              title="SSE stream mode (RFC 0002) — re-subscribes on change"
            >
              <option value="updates">updates</option>
              <option value="values">values</option>
              <option value="messages">messages</option>
              <option value="debug">debug</option>
            </select>
          </label>
          <div className="segmented" role="tablist" aria-label="Event view">
            <button
              type="button"
              role="tab"
              aria-selected={eventView === 'timeline'}
              className={eventView === 'timeline' ? '' : 'secondary'}
              onClick={() => setEventView('timeline')}
            >
              Timeline
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={eventView === 'log'}
              className={eventView === 'log' ? '' : 'secondary'}
              onClick={() => setEventView('log')}
            >
              Log
            </button>
          </div>
        </div>
        {eventView === 'timeline' ? (
          <RunTimeline events={events} onForkFrom={onForkFrom} />
        ) : (
          <EventStreamView events={events} onForkFrom={onForkFrom} />
        )}
      </div>
    </section>
  );
}
