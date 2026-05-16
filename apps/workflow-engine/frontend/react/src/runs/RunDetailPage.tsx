import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RunSnapshot, RunEventDoc } from '@openwop/openwop';
import { cancelRun, forkRun, getRun, pollEvents } from '../client/runsClient.js';
import { subscribeToRun } from '../client/streamsClient.js';
import { listOpenInterrupts, type OpenInterrupt } from '../client/interruptsClient.js';
import { EventStreamView } from '../streams/EventStreamView.js';
import { ApprovalCard } from '../interrupts/ApprovalCard.js';
import { ClarificationDialog } from '../interrupts/ClarificationDialog.js';
import { RefinementForm } from '../interrupts/RefinementForm.js';
import { CancellationBanner } from '../interrupts/CancellationBanner.js';

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [events, setEvents] = useState<RunEventDoc[]>([]);
  const [activeInterrupt, setActiveInterrupt] = useState<OpenInterrupt | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      modes: ['updates'],
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
  }, [runId, refreshInterrupts]);

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
        </div>
      </div>

      <RenderActiveInterrupt
        runId={runId}
        active={activeInterrupt}
        onResolved={async () => {
          const snap = await getRun(runId);
          setSnapshot(snap);
          await refreshInterrupts();
        }}
      />

      <div className="card">
        <h2>Event stream</h2>
        <EventStreamView events={events} onForkFrom={onForkFrom} />
      </div>
    </section>
  );
}

function RenderActiveInterrupt({
  runId,
  active,
  onResolved,
}: {
  runId: string;
  active: OpenInterrupt | null;
  onResolved: () => void;
}) {
  if (!active) return null;
  const props = {
    runId,
    nodeId: active.nodeId,
    token: active.token,
    data: active.data,
    onResolved,
  };
  switch (active.kind) {
    case 'approval':
      return <ApprovalCard {...props} />;
    case 'clarification':
      return <ClarificationDialog {...props} />;
    case 'refinement':
      return <RefinementForm {...props} />;
    case 'cancellation':
      return <CancellationBanner {...props} />;
    default:
      return (
        <div className="alert warning">
          Unknown interrupt kind <code>{active.kind}</code> — extend
          <code> RenderActiveInterrupt</code> in <code>RunDetailPage.tsx</code>.
        </div>
      );
  }
}
