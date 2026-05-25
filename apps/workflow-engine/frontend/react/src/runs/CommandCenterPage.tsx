import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunEventDoc } from '@openwop/openwop';
import { listMyRuns, pollEvents, type RunListItem } from '../client/runsClient.js';
import { subscribeToRun } from '../client/streamsClient.js';
import { RunAgentTrace } from './RunAgentTrace.js';
import { RunHandoffMap } from './RunHandoffMap.js';

// "Mission Control" — RFC 0055/0056 NOT required. This page is a pure
// composition of surfaces the protocol + app already expose: it polls
// `listMyRuns` for in-flight runs (left rail) and multiplexes each
// selected run's existing SSE stream (`subscribeToRun`) into the
// already-shipped `RunHandoffMap` + `RunAgentTrace` views. See
// plans/app-ux-enhancements.md §A1.

const TERMINAL = ['completed', 'failed', 'cancelled'];
const ACTIVE_POLL_MS = 5_000;

/** In-flight = anything the engine hasn't marked terminal. */
function isActive(status: string): boolean {
  return !TERMINAL.includes(status);
}

/** HITL-blocked runs awaiting a human turn — surfaced with an attention chip. */
function needsAttention(status: string): boolean {
  return status.startsWith('waiting') || status === 'suspended' || status === 'paused';
}

export function CommandCenterPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Poll the active-run list so finished runs drop off and new ones
  // appear without a manual refresh — the "live mission control" feel
  // without needing a tenant-wide event firehose (which the protocol
  // doesn't expose). Per-run liveness comes from SSE below.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const list = await listMyRuns({ limit: 40 });
        if (cancelled) return;
        const active = list.filter((r) => isActive(r.status));
        setRuns(active);
        setListError(null);
        // Auto-select the first active run on first load so the detail
        // pane isn't empty. Don't clobber an explicit user selection.
        setSelectedRunId((cur) => cur ?? active[0]?.runId ?? null);
      } catch (err) {
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLoadedOnce(true);
          timer = setTimeout(tick, ACTIVE_POLL_MS);
        }
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const selectedListItem = runs.find((r) => r.runId === selectedRunId) ?? null;

  return (
    <section>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Mission Control</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {runs.length} active{runs.some((r) => needsAttention(r.status)) ? ` · ${runs.filter((r) => needsAttention(r.status)).length} need attention` : ''}
          </span>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Live view of every in-flight run for this session. Select a run to watch its agent handoffs and reasoning stream in real time.
        </p>
        {listError && <div className="alert error">{listError}</div>}
      </div>

      <div className="command-center">
        <aside className="command-center-rail" aria-label="Active runs">
          {loadedOnce && runs.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No active runs. Start one from <Link to="/builder">Workflows</Link> or <Link to="/">Chat</Link>.
              </p>
            </div>
          ) : (
            runs.map((r) => (
              <button
                key={r.runId}
                type="button"
                className={`cc-run${r.runId === selectedRunId ? ' cc-run--selected' : ''}`}
                onClick={() => setSelectedRunId(r.runId)}
                aria-pressed={r.runId === selectedRunId}
              >
                <span className="cc-run-top">
                  <code>{r.runId.slice(0, 8)}…</code>
                  <span className={`status-badge ${r.status}`}>{r.status}</span>
                </span>
                <span className="cc-run-wf" title={r.workflowId}>{r.workflowId}</span>
                {needsAttention(r.status) && (
                  <span className="cc-attention">⚠ awaiting human input</span>
                )}
              </button>
            ))
          )}
        </aside>

        <div className="command-center-detail">
          {selectedRunId ? (
            <RunWatch
              key={selectedRunId}
              runId={selectedRunId}
              fallbackStatus={selectedListItem?.status}
            />
          ) : (
            loadedOnce && (
              <div className="card">
                <p className="muted" style={{ margin: 0 }}>Select a run from the left to watch it live.</p>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Live detail for one run: seeds from the REST event log, then streams
 * SSE `updates` into the existing handoff/trace views. Mirrors the
 * subscription discipline in RunDetailPage (dedupe by sequence, relaxed
 * idle/absolute timeouts for long HITL waits, close on unmount).
 */
function RunWatch({ runId, fallbackStatus }: { runId: string; fallbackStatus?: string }) {
  const [events, setEvents] = useState<RunEventDoc[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Seed with the authoritative log so switching to a run shows its
    // current trace immediately, not just events from now on.
    void pollEvents(runId, 0)
      .then((p) => { if (!cancelled) setEvents([...p.events]); })
      .catch(() => undefined);

    const sub = subscribeToRun(runId, {
      modes: ['updates'],
      idleTimeoutMs: 5 * 60_000,
      absoluteTimeoutMs: 30 * 60_000,
      onEvent: (ev) => {
        setEvents((prev) => {
          if (prev.some((e) => e.sequence === ev.sequence)) return prev;
          return [...prev, ev].sort((a, b) => a.sequence - b.sequence);
        });
      },
      onError: () => setStreamError('Event stream connection error (reconnecting)'),
    });

    return () => {
      cancelled = true;
      sub.close();
    };
  }, [runId]);

  // Derive status from the event log (seeded + live), so an already-finished
  // run selected from a stale rail entry still reads its true terminal state
  // rather than defaulting to "running".
  const terminalEvent = events.find((e) => ['run.completed', 'run.failed', 'run.cancelled'].includes(e.type));
  const status = (terminalEvent ? terminalEvent.type.slice('run.'.length) : fallbackStatus) ?? 'running';
  const live = !TERMINAL.includes(status);
  const hasActivity = events.some((e) => e.type.startsWith('agent.') || e.type.startsWith('runOrchestrator.') || e.type.startsWith('core.workflowChain.'));

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {live && <span className="cc-live-dot" aria-hidden="true" />}
          <h2 style={{ margin: 0, flex: 1 }}>
            Run <code>{runId.slice(0, 8)}…</code>
            <span className={`status-badge ${status}`} style={{ marginLeft: 8 }}>{status}</span>
          </h2>
          <Link to={`/runs/${runId}`}>Open full detail →</Link>
        </div>
        {streamError && <div className="alert error">{streamError}</div>}
      </div>

      {hasActivity ? (
        <>
          <RunHandoffMap events={events} />
          <RunAgentTrace events={events} />
        </>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {live ? 'Waiting for agent activity…' : 'This run produced no agent handoffs or reasoning events.'}
          </p>
        </div>
      )}
    </>
  );
}
