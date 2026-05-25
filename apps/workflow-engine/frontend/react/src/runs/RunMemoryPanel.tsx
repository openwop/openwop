/**
 * Memory ledger (app-ux §A3).
 *
 * Read-only view of the tenant's RFC 0004 memory entries (host-extension
 * GET /v1/host/sample/memory). Entries this run contributed — the host
 * writes a run-summary on completion — are highlighted via their
 * `run-id:<runId>` tag, so the panel ties the accumulating tenant memory
 * back to the run you're looking at.
 *
 * Honest scope: the wire carries no per-node read/write attribution
 * (agent-memory.md keeps memory access internal to nodes for replay
 * determinism), so this is a *ledger*, not a per-node memory graph. A
 * `[REDACTED:…]` SR-1 marker is surfaced as a badge when present.
 */

import { useEffect, useMemo, useState } from 'react';
import { listMemory, type MemoryEntry } from '../client/runsClient.js';

interface Props {
  runId: string;
  /** Refetch when the run reaches a terminal status (the run-summary is
   *  written on completion, so it only exists once the run finishes). */
  status?: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function isRedacted(content: string): boolean {
  return /\[REDACTED:[^\]]*\]/.test(content);
}

export function RunMemoryPanel({ runId, status }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminal = status ? TERMINAL.has(status) : false;

  useEffect(() => {
    let cancelled = false;
    listMemory({ limit: 50 })
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Refetch when the run finishes so the on-completion run-summary appears.
  }, [runId, terminal]);

  const thisRunTag = `run-id:${runId}`;
  const { fromThisRun, total } = useMemo(() => {
    const list = entries ?? [];
    return { fromThisRun: list.filter((e) => e.tags.includes(thisRunTag)).length, total: list.length };
  }, [entries, thisRunTag]);

  // Nothing to show and no error → the host doesn't expose memory, or it's
  // empty. Stay quiet rather than render an empty card.
  if (!error && (entries === null || entries.length === 0)) return null;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ flex: 1 }}>Memory ledger</h2>
        {!error && (
          <span className="muted" style={{ fontSize: 12 }}>
            {fromThisRun > 0 ? `${fromThisRun} from this run · ` : ''}
            {total} {total === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        Tenant memory (RFC 0004 read-side). Entries this run wrote are highlighted.
      </p>
      {error ? (
        <div className="alert error">{error}</div>
      ) : (
        <table className="memory-table">
          <thead>
            <tr>
              <th>Content</th>
              <th>Tags</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => {
              const mine = e.tags.includes(thisRunTag);
              return (
                <tr key={e.id} className={mine ? 'memory-row-mine' : undefined}>
                  <td>
                    {isRedacted(e.content) && (
                      <span className="memory-redacted-badge" title="Contains host-redacted secret material (SR-1)">
                        🔒 redacted
                      </span>
                    )}
                    <span className="memory-content">{e.content}</span>
                  </td>
                  <td className="memory-tags">
                    {e.tags.map((t) => (
                      <span key={t} className="memory-tag">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="memory-created" title={e.createdAt}>
                    {new Date(e.createdAt).toLocaleString()}
                    {e.expiresAt && (
                      <span className="muted" title={`Expires ${e.expiresAt}`}>
                        {' '}· TTL
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
