/**
 * HitlInboxPage — `/inbox`. A cross-run approval inbox.
 *
 * Where RunDetailPage surfaces the active interrupt for one run, this
 * aggregates every pending interrupt across the caller's runs that are
 * parked in a human-in-the-loop state (`paused` / `waiting-approval` /
 * `waiting-input` — RFC 0005 interrupt profiles). Each item renders the
 * correct resume form via the shared RenderInterrupt and resolves in
 * place, then refreshes so the cleared item drops off the list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyRuns } from '../client/runsClient.js';
import { listOpenInterrupts, type OpenInterrupt } from '../client/interruptsClient.js';
import { RenderInterrupt } from '../interrupts/RenderInterrupt.js';

// Run statuses that mean "a human (or external event) must act before
// this run can continue" per RFC 0005.
const PENDING_STATUSES = ['waiting-approval', 'waiting-input', 'paused'] as const;

interface InboxItem {
  runId: string;
  status: string;
  interrupt: OpenInterrupt;
}

export function HitlInboxPage() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      // listMyRuns filters by a single status; fan out over the
      // pending set and merge, de-duping by runId.
      const lists = await Promise.all(
        PENDING_STATUSES.map((status) => listMyRuns({ status, limit: 50 }).catch(() => [])),
      );
      const byRun = new Map<string, string>();
      for (const list of lists) for (const r of list) byRun.set(r.runId, r.status);

      const collected: InboxItem[] = [];
      await Promise.all(
        [...byRun.entries()].map(async ([runId, status]) => {
          try {
            const open = await listOpenInterrupts(runId);
            for (const interrupt of open) collected.push({ runId, status, interrupt });
          } catch {
            /* a run may have cleared between listing and fetch — skip */
          }
        }),
      );
      collected.sort((a, b) => a.interrupt.createdAt.localeCompare(b.interrupt.createdAt));
      setItems(collected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ flex: 1 }}>Approval inbox</h2>
          <button type="button" className="secondary" onClick={() => void refresh()}>Refresh</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Pending human-in-the-loop interrupts across your runs (RFC 0005).
        </p>
        {error && <div className="alert error">{error}</div>}
      </div>

      {items == null && <div className="card muted">Loading inbox…</div>}
      {items != null && items.length === 0 && (
        <div className="card muted">No pending approvals. Runs that suspend on an interrupt appear here.</div>
      )}

      {items?.map((item) => (
        <div className="card" key={item.interrupt.interruptId}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span className={`status-badge ${item.status}`}>{item.status}</span>
            <strong>{item.interrupt.kind}</strong>
            <span className="muted" style={{ fontSize: 12 }}>node <code>{item.interrupt.nodeId}</code></span>
            <Link to={`/runs/${item.runId}`} style={{ marginLeft: 'auto', fontSize: 12 }}>
              run {item.runId.slice(0, 12)} →
            </Link>
          </div>
          <RenderInterrupt runId={item.runId} active={item.interrupt} onResolved={() => void refresh()} />
        </div>
      ))}
    </section>
  );
}
