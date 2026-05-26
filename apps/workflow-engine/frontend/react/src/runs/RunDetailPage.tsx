import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import type { RunSnapshot, RunEventDoc, StreamMode } from '@openwop/openwop';
import { cancelRun, deleteRun, forkRun, getDebugBundle, getRun, pollEvents } from '../client/runsClient.js';
import { subscribeToRun } from '../client/streamsClient.js';
import { listOpenInterrupts, type OpenInterrupt } from '../client/interruptsClient.js';
import { listAnnotations, type Annotation } from '../client/feedbackClient.js';
import { EventStreamView } from '../streams/EventStreamView.js';
import { RunTimeline } from './RunTimeline.js';
import { RunStepInspector } from './RunStepInspector.js';
import { RunAgentTrace } from './RunAgentTrace.js';
import { RunHandoffMap } from './RunHandoffMap.js';
import { RunCostPanel } from './RunCostPanel.js';
import { RunAnalyticsPanel } from './RunAnalyticsPanel.js';
import { RunFeedback } from './RunFeedback.js';
import { RunOpsPanel } from './RunOpsPanel.js';
import { RunMemoryPanel } from './RunMemoryPanel.js';
import { RunConversationPanel } from './RunConversationPanel.js';
import { RenderInterrupt } from '../interrupts/RenderInterrupt.js';

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const nav = useNavigate();
  // §C3/§D — when this run was opened from a fork, carry a back-reference to
  // the source so a reviewer can navigate to the feedback that motivated it.
  const [searchParams] = useSearchParams();
  const forkedFrom = searchParams.get('from');
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [events, setEvents] = useState<RunEventDoc[]>([]);
  const [activeInterrupt, setActiveInterrupt] = useState<OpenInterrupt | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [eventView, setEventView] = useState<'timeline' | 'log'>('timeline');
  const [streamMode, setStreamMode] = useState<StreamMode>('updates');
  // §A4 playhead — the timeline-selected sequence drives the step inspector.
  const [playheadSeq, setPlayheadSeq] = useState<number | null>(null);

  const refreshInterrupts = useCallback(async () => {
    if (!runId) return;
    try {
      const open = await listOpenInterrupts(runId);
      setActiveInterrupt(open.length > 0 ? (open[open.length - 1] ?? null) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  // §C2 — annotation quality signals. listAnnotations resolves to [] when the
  // host doesn't advertise capabilities.feedback, so this is a safe no-op there.
  const refreshAnnotations = useCallback(async () => {
    if (!runId) return;
    try {
      setAnnotations(await listAnnotations(runId));
    } catch {
      /* non-fatal — the quality panel just stays empty */
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
        if (!cancelled) await refreshAnnotations();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, refreshInterrupts, refreshAnnotations]);

  // Hash-driven node deep-link: `/runs/<id>#node-<nodeId>` sets the
  // playhead to the matching `node.completed` event's sequence and
  // scrolls the step inspector into view. Used by the chat surface's
  // `WorkflowCompletionCard` to open a terminal node's artifact panel
  // in a new tab — the modal preview is the in-chat affordance; this
  // is the "give me the full run-detail context" affordance.
  useEffect(() => {
    if (events.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#node-')) return;
    const targetNodeId = decodeURIComponent(hash.slice('#node-'.length));
    // Pick the LAST `node.completed` for this nodeId so a node that
    // ran multiple times (retries, loops) selects the terminal attempt.
    const ev = [...events].reverse().find(
      (e) => e.type === 'node.completed' && e.nodeId === targetNodeId,
    );
    if (!ev) return;
    setPlayheadSeq(ev.sequence);
    // Defer the scroll until the inspector has rendered with the new
    // playhead — the inspector mounts conditionally on `playheadSeq`.
    requestAnimationFrame(() => {
      const inspector = document.querySelector<HTMLElement>('[data-run-step-inspector]');
      inspector?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [events]);

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

  async function onDelete() {
    if (!runId) return;
    if (!window.confirm('Permanently delete this run? This removes its events and history and cannot be undone.')) return;
    try {
      await deleteRun(runId);
      nav('/runs');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDownloadDebugBundle() {
    if (!runId) return;
    try {
      const bundle = await getDebugBundle(runId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openwop-run-${runId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onForkFrom(seq: number) {
    if (!runId) return;
    try {
      const res = await forkRun(runId, { fromSeq: seq, mode: 'branch' });
      // Carry the source run as a back-reference (RFC 0056 §D) so the forked
      // run's page can link back to where the fork was motivated.
      window.location.href = `/runs/${res.runId}?from=${encodeURIComponent(res.sourceRunId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!runId) return <div className="alert error">No run ID in URL.</div>;

  return (
    <section>
      <div className="card">
        {forkedFrom && (
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            ↳ Forked from <Link to={`/runs/${forkedFrom}`}><code>{forkedFrom.slice(0, 8)}…</code></Link>
          </p>
        )}
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
          <button
            className="secondary"
            onClick={onDelete}
            title="Permanently delete this run and its history"
          >
            Delete run
          </button>
          <button
            className="secondary"
            onClick={onDownloadDebugBundle}
            disabled={!snapshot}
            title="Download a JSON bundle of this run's events for support / triage (spec/v1/debug-bundle.md)"
          >
            Download bundle
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

      <RunAnalyticsPanel events={events} annotations={annotations} />
      <RunFeedback runId={runId} onRecorded={refreshAnnotations} />
      <RunCostPanel events={events} />
      <RunHandoffMap events={events} />
      <RunAgentTrace events={events} />
      <RunConversationPanel
        runId={runId}
        events={events}
        activeInterrupt={activeInterrupt}
        onResolved={async () => {
          const snap = await getRun(runId);
          setSnapshot(snap);
          await refreshInterrupts();
        }}
      />
      <RunOpsPanel runId={runId} events={events} />
      <RunMemoryPanel runId={runId} status={snapshot?.status} />

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
          <RunTimeline events={events} onForkFrom={onForkFrom} onSelectSeq={setPlayheadSeq} />
        ) : (
          <EventStreamView events={events} onForkFrom={onForkFrom} />
        )}
      </div>

      {eventView === 'timeline' && playheadSeq != null && (
        <RunStepInspector events={events} seq={playheadSeq} onForkFrom={onForkFrom} />
      )}
    </section>
  );
}
