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
import { LockIcon, TrashIcon } from '../ui/icons/index.js';
import { PageHeader } from '../ui/PageHeader.js';
import { DataTable, DensityToggle, type DataColumn } from '../ui/DataTable.js';
import { SkeletonRows } from '../ui/Skeleton.js';
import { toast } from '../ui/toast.js';

function isRedacted(content: string): boolean {
  return /\[REDACTED:[^\]]*\]/.test(content);
}

export function MemoryInspectorPage(): JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [memoryRef, setMemoryRef] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

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
      toast.success('Memory entry deleted.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error('Could not delete the memory entry.');
    }
  }

  async function onBulkDelete(rows: MemoryEntry[]) {
    if (rows.length === 0) return;
    if (!window.confirm(`Delete ${rows.length} memory ${rows.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`)) return;
    const results = await Promise.allSettled(rows.map((e) => deleteMemoryEntry(e.id, memoryRef || undefined)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const ok = rows.length - failed;
    if (ok > 0) toast.success(`Deleted ${ok} memory ${ok === 1 ? 'entry' : 'entries'}.`);
    if (failed > 0) toast.error(`${failed} ${failed === 1 ? 'entry' : 'entries'} could not be deleted.`);
    setSelected(new Set());
    await refresh();
  }

  const columns: DataColumn<MemoryEntry>[] = [
    {
      key: 'content',
      header: 'Content',
      render: (e) => (
        <>
          {isRedacted(e.content) && (
            <span className="memory-redacted-badge" title="Contains host-redacted secret material (SR-1)">
              <LockIcon size={12} /> redacted
            </span>
          )}
          <span className="memory-content">{e.content}</span>
        </>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      cellClassName: 'memory-tags',
      render: (e) => e.tags.map((t) => <span key={t} className="memory-tag">{t}</span>),
    },
    {
      key: 'created',
      header: 'Created',
      cellClassName: 'memory-created',
      sortValue: (e) => (e.createdAt ? Date.parse(e.createdAt) : 0),
      render: (e) => (
        <span title={e.createdAt}>
          {new Date(e.createdAt).toLocaleString()}
          {e.expiresAt && <span className="muted" title={`Expires ${e.expiresAt}`}> · TTL</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <button className="secondary btn-sm" onClick={() => { void onDelete(e); }} title="Delete this memory entry" aria-label={`Delete memory entry ${e.id}`}>
          <TrashIcon size={13} />
        </button>
      ),
    },
  ];

  return (
    <section>
      <PageHeader
        eyebrow="Memory"
        title="Memory inspector"
        lede={<>Browse the tenant&apos;s memory ledger (RFC 0004 read-side). Entries are written host-internally — the executor writes a run-summary on completion. Reads and deletes are scoped to your credential server-side; the inspector can&apos;t see another tenant&apos;s memory.{memoryRef && <> Showing <code>{memoryRef}</code>.</>}</>}
        actions={<button className="secondary" onClick={() => { void refresh(); }}>Refresh</button>}
      />
      <div className="card">

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

        {entries === null && <SkeletonRows rows={5} columns={[24, '60%', 120, 140, 60]} />}

        {entries !== null && !error && (
          <>
            <div className="action-bar" style={{ justifyContent: 'space-between' }}>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                {entries.length !== filtered.length ? ` of ${entries.length}` : ''}
              </p>
              <DensityToggle value={density} onChange={setDensity} />
            </div>
            <DataTable
              rows={filtered}
              rowKey={(e) => e.id}
              columns={columns}
              density={density}
              caption="Memory entries"
              initialSort={{ key: 'created', dir: 'desc' }}
              selectable
              selected={selected}
              onSelectionChange={setSelected}
              bulkActions={(rows) => (
                <button className="secondary btn-sm" onClick={() => { void onBulkDelete(rows); }}>
                  <TrashIcon size={13} /> Delete selected
                </button>
              )}
              empty={<p className="muted">No memory entries.</p>}
            />
          </>
        )}
      </div>
    </section>
  );
}
