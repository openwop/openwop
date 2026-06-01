/**
 * Memory ledger (app-ux §A3).
 *
 * Read-only view of the tenant's RFC 0004 memory entries (host-extension
 * GET /v1/host/sample/memory), tied to the run you're looking at.
 *
 * Attribution (RFC 0057). When the host advertises
 * `capabilities.memory.attribution.emitsWriteEvents`, this panel reads the
 * run's `memory.written` events to determine — *authoritatively* — which
 * entries this run wrote and which node wrote each one, replacing the older
 * `run-id:<runId>` tag heuristic (kept as the fallback for hosts that don't
 * advertise attribution). The event is content-free by invariant
 * (`memory-attribution-no-content`): it carries `{ memoryRef, memoryId,
 * nodeId?, agentId?, tags? }` only, never the entry content — so we read the
 * content from the read-side (already SR-1-redacted) and use the event purely
 * to attribute it. A `[REDACTED:…]` SR-1 marker is surfaced as a badge.
 *
 * Companion to the RunTimeline memory-write markers (#192), which read the
 * same `memory.written` events to mark *where* a write happened; this marks
 * *which entries* a run wrote and by which node.
 */

import { useEffect, useMemo, useState } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { listMemory, getCapabilities, type MemoryEntry } from '../client/runsClient.js';
import { LockIcon, PencilIcon } from '../chat/icons/index.js';

interface Props {
  runId: string;
  /** The run's event log (from RunDetailPage). `memory.written` events here
   *  drive authoritative write-attribution when the host advertises it. */
  events: readonly RunEventDoc[];
  /** Refetch when the run reaches a terminal status (the run-summary is
   *  written on completion, so it only exists once the run finishes). */
  status?: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface WriteAttribution {
  nodeId?: string;
  agentId?: string;
}

function isRedacted(content: string): boolean {
  return /\[REDACTED:[^\]]*\]/.test(content);
}

// Fold the run's `memory.written` events (RFC 0057) into a memoryId → who-wrote
// map. The events passed in are already scoped to this run, so every entry is a
// write this run made. `nodeId` is read from the canonical payload (RFC 0057
// §B SHOULD) with the event envelope's `nodeId` as a fallback.
function buildAttribution(events: readonly RunEventDoc[]): Map<string, WriteAttribution> {
  const byMemoryId = new Map<string, WriteAttribution>();
  for (const ev of events) {
    if (ev.type !== 'memory.written') continue;
    const p = (ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as {
      memoryId?: unknown;
      nodeId?: unknown;
      agentId?: unknown;
    };
    if (typeof p.memoryId !== 'string') continue;
    const nodeId = typeof p.nodeId === 'string' ? p.nodeId : ev.nodeId;
    const attr: WriteAttribution = {};
    if (nodeId) attr.nodeId = nodeId;
    if (typeof p.agentId === 'string') attr.agentId = p.agentId;
    byMemoryId.set(p.memoryId, attr);
  }
  return byMemoryId;
}

export function RunMemoryPanel({ runId, events, status }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = not yet known; consume the attribution events only once we've
  // confirmed the host advertises them, so non-advertising hosts keep the
  // tag-heuristic behaviour rather than silently showing zero writes.
  const [attributionAdvertised, setAttributionAdvertised] = useState<boolean | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    getCapabilities()
      .then((caps) => {
        if (cancelled) return;
        const attribution = (
          caps as { capabilities?: { memory?: { attribution?: { emitsWriteEvents?: unknown } } } }
        ).capabilities?.memory?.attribution;
        setAttributionAdvertised(attribution?.emitsWriteEvents === true);
      })
      .catch(() => {
        // Discovery failed — fall back to the tag heuristic.
        if (!cancelled) setAttributionAdvertised(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const attribution = useMemo(() => buildAttribution(events), [events]);

  const thisRunTag = `run-id:${runId}`;
  // Authoritative when the host advertises attribution AND we've actually
  // received write events for this run; otherwise the tag heuristic.
  const useEvents = attributionAdvertised === true && attribution.size > 0;
  const mineFor = (e: MemoryEntry): boolean =>
    useEvents ? attribution.has(e.id) : e.tags.includes(thisRunTag);

  const { fromThisRun, total } = useMemo(() => {
    const list = entries ?? [];
    const count = list.filter((e) =>
      useEvents ? attribution.has(e.id) : e.tags.includes(thisRunTag),
    ).length;
    return { fromThisRun: count, total: list.length };
  }, [entries, useEvents, attribution, thisRunTag]);

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
        Tenant memory (RFC 0004 read-side).{' '}
        {useEvents
          ? 'Entries this run wrote are highlighted and attributed to the node that wrote them (RFC 0057).'
          : 'Entries this run wrote are highlighted.'}
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
              const mine = mineFor(e);
              const attr = attribution.get(e.id);
              return (
                <tr key={e.id} className={mine ? 'memory-row-mine' : undefined}>
                  <td>
                    {isRedacted(e.content) && (
                      <span className="memory-redacted-badge" title="Contains host-redacted secret material (SR-1)">
                        <LockIcon size={12} /> redacted
                      </span>
                    )}
                    {attr?.nodeId && (
                      <span
                        className="memory-wrote-badge"
                        title={`Written by node ${attr.nodeId}${attr.agentId ? ` (agent ${attr.agentId})` : ''} — RFC 0057 memory.written`}
                      >
                        <PencilIcon size={12} /> {attr.nodeId}
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
