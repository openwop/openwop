/**
 * RunComparePage — `/compare?a=<runId>&b=<runId>`.
 *
 * Client-side side-by-side of two runs: terminal status + the node-keyed
 * timeline for each. The honest 80% of run-diffing achievable on shipped
 * protocol today (fork creates a new run from any seq — RFC 0011), so a
 * run and its fork can be visually compared. A deterministic structured
 * diff endpoint (`GET /v1/runs/{a}/diff/{b}`) is future work (RFC 0054,
 * not yet filed) — this does not attempt a semantic diff.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RunSnapshot, RunEventDoc } from '@openwop/openwop';
import { getRun, pollEvents } from '../client/runsClient.js';
import { RunTimeline } from './RunTimeline.js';

interface Side {
  snapshot: RunSnapshot | null;
  events: RunEventDoc[];
  error: string | null;
}

const EMPTY: Side = { snapshot: null, events: [], error: null };

function useRunData(runId: string): Side {
  const [side, setSide] = useState<Side>(EMPTY);
  useEffect(() => {
    if (!runId) { setSide(EMPTY); return; }
    let cancelled = false;
    setSide(EMPTY);
    (async () => {
      try {
        const [snap, polled] = await Promise.all([getRun(runId), pollEvents(runId, 0)]);
        if (!cancelled) setSide({ snapshot: snap, events: [...polled.events], error: null });
      } catch (err) {
        if (!cancelled) setSide({ snapshot: null, events: [], error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);
  return side;
}

export function RunComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const [aIn, setAIn] = useState(a);
  const [bIn, setBIn] = useState(b);

  const sideA = useRunData(a);
  const sideB = useRunData(b);

  return (
    <section>
      <div className="card">
        <h2>Compare runs</h2>
        <form
          className="button-row"
          onSubmit={(e) => { e.preventDefault(); setParams({ a: aIn.trim(), b: bIn.trim() }); }}
        >
          <input value={aIn} onChange={(e) => setAIn(e.target.value)} placeholder="run id A" style={{ flex: 1 }} />
          <input value={bIn} onChange={(e) => setBIn(e.target.value)} placeholder="run id B" style={{ flex: 1 }} />
          <button type="submit">Compare</button>
        </form>
        <p className="muted" style={{ fontSize: 12 }}>
          Side-by-side of two runs (e.g. a run and its fork). Structured semantic diff is future work (RFC 0054).
        </p>
      </div>

      <div className="run-compare-grid">
        <CompareColumn runId={a} side={sideA} />
        <CompareColumn runId={b} side={sideB} />
      </div>
    </section>
  );
}

function CompareColumn({ runId, side }: { runId: string; side: Side }) {
  return (
    <div className="card">
      {!runId ? (
        <p className="muted">No run selected.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <code>{runId.slice(0, 16)}</code>
            {side.snapshot && <span className={`status-badge ${side.snapshot.status}`}>{side.snapshot.status}</span>}
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{side.events.length} events</span>
          </div>
          {side.error && <div className="alert error">{side.error}</div>}
          {!side.snapshot && !side.error && <div className="muted">Loading…</div>}
          {side.events.length > 0 && <RunTimeline events={side.events} />}
        </>
      )}
    </div>
  );
}
