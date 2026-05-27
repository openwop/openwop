/**
 * `/memory` route — MemoryAdapter inspector (RFC 0004 read-side).
 *
 * Lists the authenticated tenant's memory entries (host-extension
 * GET /v1/host/sample/memory), with a free-text search over content + tags
 * and an optional server-side tag filter. Each row can be deleted via the
 * demo-only DELETE /v1/host/sample/memory/:memoryId route.
 *
 * Companion to RunMemoryPanel (which shows the same ledger scoped to a single
 * run); this is the standalone, run-agnostic browser. Reuses the same
 * `.memory-table` / `.memory-tag` styles for visual consistency.
 *
 * CTI-1: every read/delete is tenant-scoped server-side from the caller's
 * principal. The page never sends a tenantId — tenant selection is the auth
 * layer's job — so it cannot cross a tenant boundary.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteMemoryEntry, listMemory, type MemoryEntry } from './lib/memoryClient.js';

function isRedacted(content: string): boolean {
  return /\[REDACTED:[^\]]*\]/.test(content);
}

export function MemoryInspectorPage(): JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [memoryRef, setMemoryRef] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const res = await listMemory({ limit: 200, ...(tag ? { tag } : {}) });
      setEntries(res.entries);
      setMemoryRef(res.memoryRef);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    }
  }, [tag]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Free-text search is client-side over the tenant-scoped result set (the
  // host route exposes a tag filter but no full-text index).
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = entries ?? [];
    if (!term) return list;
    return list.filter(
      (e) =>
        e.content.toLowerCase().includes(term) ||
        e.tags.some((t) => t.toLowerCase().includes(term)),
    );
  }, [entries, search]);

  async function onDelete(e: MemoryEntry) {
    if (!window.confirm(`Delete memory entry "${e.id}"? This cannot be undone.`)) return;
    try {
      await deleteMemoryEntry(e.id, memoryRef || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>Memory inspector</h2>
          <button className="secondary" onClick={() => { void refresh(); }}>Refresh</button>
        </div>
        <p className="muted">
          Browse the tenant&apos;s memory ledger (RFC 0004 read-side). Entries are
          written host-internally — the executor writes a run-summary on
          completion. Reads and deletes are scoped to your credential
          server-side; the inspector can&apos;t see another tenant&apos;s memory.
          {memoryRef && <> Showing <code>{memoryRef}</code>.</>}
        </p>

        <div className="form-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label>Search <span className="muted">(content or tags)</span></label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="filter entries…"
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label>Tag filter <span className="muted">(server-side)</span></label>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. run-summary"
              onKeyDown={(e) => { if (e.key === 'Enter') void refresh(); }}
            />
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        {entries === null && <p className="muted">Loading…</p>}

        {entries !== null && !error && (
          <>
            <p className="muted" style={{ fontSize: 12 }}>
              {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
              {entries.length !== filtered.length ? ` of ${entries.length}` : ''}
            </p>
            {filtered.length === 0 ? (
              <p className="muted">No memory entries.</p>
            ) : (
              <table className="memory-table">
                <thead>
                  <tr>
                    <th>Content</th>
                    <th>Tags</th>
                    <th>Created</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id}>
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
                          <span key={t} className="memory-tag">{t}</span>
                        ))}
                      </td>
                      <td className="memory-created" title={e.createdAt}>
                        {new Date(e.createdAt).toLocaleString()}
                        {e.expiresAt && (
                          <span className="muted" title={`Expires ${e.expiresAt}`}> · TTL</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="secondary"
                          onClick={() => { void onDelete(e); }}
                          title="Delete this memory entry"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  );
}
