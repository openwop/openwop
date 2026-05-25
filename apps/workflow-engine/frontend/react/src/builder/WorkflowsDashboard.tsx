/**
 * Workflows dashboard — list view at `/builder`.
 *
 * Renders saved workflows as a searchable / sortable grid of cards.
 * Each card supports rename (inline), duplicate, delete, and export
 * JSON via a three-dot menu. Persistence is localStorage-only; the
 * `version` counter forces re-reads after mutations.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteSavedWorkflow,
  duplicateSavedWorkflow,
  exportSavedWorkflowAsJSON,
  listSavedWorkflows,
  newWorkflowId,
  renameSavedWorkflow,
  seedSavedWorkflowsIfFirstVisit,
  upsertSavedWorkflow,
} from './persistence/localStore.js';
import type { SavedWorkflow } from './schema/workflow.js';
import {
  CATEGORY_LABELS,
  PREMADE_WORKFLOWS,
  cloneTemplateToUserWorkflow,
  type TemplateWorkflow,
} from './templates/premadeWorkflows.js';
import { loadDynamicCatalog, useCatalog } from './palette/catalogRegistry.js';

/** A template is offerable when it needs no pack nodes, or every pack
 *  typeId it needs is present in the merged catalog (host has the pack). */
function templateAvailable(tpl: TemplateWorkflow, installed: ReadonlySet<string>): boolean {
  return !tpl.requiresTypeIds || tpl.requiresTypeIds.every((t) => installed.has(t));
}

type SortBy = 'updated' | 'created' | 'name';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortBy, string> = {
  updated: 'Updated',
  created: 'Created',
  name: 'Name',
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

function compareWorkflows(a: SavedWorkflow, b: SavedWorkflow, by: SortBy): number {
  switch (by) {
    case 'name':
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    case 'created':
      return a.createdAt.localeCompare(b.createdAt);
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt);
  }
}

export function WorkflowsDashboard() {
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Bumped after mutations to re-read localStorage on next render.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  // First-visit seed: every premade template lands in "Your workflows"
  // so the dashboard isn't empty on day one. Subsequent visits no-op
  // (a `seeded` flag is persisted alongside) — if the user deletes
  // everything, we honor that intent and don't re-seed.
  // Pull the dynamic (pack) catalog so pack-dependent templates can be
  // gated on what the connected host actually has installed.
  useEffect(() => { void loadDynamicCatalog(); }, []);
  const catalog = useCatalog();
  const installedTypeIds = useMemo(() => new Set(catalog.map((e) => e.typeId)), [catalog]);

  useEffect(() => {
    // Seed only built-in templates on first visit. Pack-dependent
    // templates are gallery-only + catalog-gated, so we never seed a
    // workflow with "Unknown" nodes before the catalog has loaded.
    const seeds = PREMADE_WORKFLOWS
      .filter((tpl) => !tpl.requiresTypeIds)
      .map((tpl) => cloneTemplateToUserWorkflow(tpl));
    const n = seedSavedWorkflowsIfFirstVisit(seeds);
    if (n > 0) refresh();
    // refresh is stable for this hook's lifetime (closes over setVersion);
    // intentionally run-once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = useMemo(() => listSavedWorkflows(), [version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? all.filter((wf) => wf.name.toLowerCase().includes(q)) : all;
    const sorted = [...matched].sort((a, b) => compareWorkflows(a, b, sortBy));
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [all, query, sortBy, sortDir]);

  // Single click-outside listener while any kebab menu is open.
  const gridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (menuOpenId === null) return;
    function onDocClick(e: MouseEvent) {
      const { target } = e;
      if (!(target instanceof Element)) return;
      if (!target.closest('.workflow-card-menu')) setMenuOpenId(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpenId]);

  function onCreate() {
    nav(`/builder/${newWorkflowId()}`);
  }

  function onOpen(id: string) {
    nav(`/builder/${id}`);
  }

  function onRenameCommit(id: string, name: string) {
    const trimmed = name.trim();
    if (trimmed) renameSavedWorkflow(id, trimmed);
    setRenamingId(null);
    refresh();
  }

  function onDuplicate(id: string) {
    duplicateSavedWorkflow(id);
    setMenuOpenId(null);
    refresh();
  }

  function onDelete(wf: SavedWorkflow) {
    if (!confirm(`Delete "${wf.name}"? This cannot be undone.`)) return;
    deleteSavedWorkflow(wf.id);
    setMenuOpenId(null);
    refresh();
  }

  function onExport(id: string) {
    const out = exportSavedWorkflowAsJSON(id);
    setMenuOpenId(null);
    if (!out) return;
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Older Safari/iOS need the URL to outlive the synchronous click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function onUseTemplate(template: TemplateWorkflow) {
    const cloned = cloneTemplateToUserWorkflow(template);
    upsertSavedWorkflow(cloned);
    nav(`/builder/${cloned.id}`);
  }

  return (
    <section className="workflows-dashboard">
      <div className="workflows-header">
        <h2>Workflows</h2>
        <button onClick={onCreate}>+ New workflow</button>
      </div>

      <div className="workflows-section">
        <div className="workflows-section-header">
          <h3>Your workflows</h3>
        </div>

        <div className="workflows-toolbar">
          <input
            type="search"
            className="workflows-search"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="workflows-sort">
            <label htmlFor="wf-sort">Sort by</label>
            <select
              id="wf-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
            >
              {(['updated', 'created', 'name'] as SortBy[]).map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
            <button
              className="secondary workflows-sort-dir"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              title={sortDir === 'asc' ? 'Ascending — click to flip' : 'Descending — click to flip'}
              aria-label={`Sort direction: ${sortDir}`}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <span className="workflows-toolbar-summary muted">
            {filtered.length} of {all.length}
          </span>
        </div>

        {all.length === 0 ? (
          <div className="card workflow-card-empty">
            <p>No workflows yet.</p>
            <p className="muted">
              Click <strong>+ New workflow</strong> for a blank canvas, or pick a template below.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card workflow-card-empty">
            <p className="muted">No workflows match “{query}”.</p>
          </div>
        ) : (
          <div className="workflows-grid" ref={gridRef}>
            {filtered.map((wf) => (
              <WorkflowCard
                key={wf.id}
                wf={wf}
                menuOpen={menuOpenId === wf.id}
                onMenuToggle={() => setMenuOpenId((cur) => (cur === wf.id ? null : wf.id))}
                renaming={renamingId === wf.id}
                onRenameStart={() => {
                  setRenamingId(wf.id);
                  setMenuOpenId(null);
                }}
                onRenameCommit={(name) => onRenameCommit(wf.id, name)}
                onRenameCancel={() => setRenamingId(null)}
                onOpen={() => onOpen(wf.id)}
                onDuplicate={() => onDuplicate(wf.id)}
                onDelete={() => onDelete(wf)}
                onExport={() => onExport(wf.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="workflows-section">
        <div className="workflows-section-header">
          <h3>Templates</h3>
          <span className="muted">Premade starting points — click <em>Use template</em> to clone into your workflows.</span>
        </div>
        <div className="workflows-grid">
          {PREMADE_WORKFLOWS.filter((tpl) => templateAvailable(tpl, installedTypeIds)).map((tpl) => (
            <TemplateCard key={tpl.templateId} template={tpl} onUse={() => onUseTemplate(tpl)} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface CardProps {
  wf: SavedWorkflow;
  menuOpen: boolean;
  onMenuToggle(): void;
  renaming: boolean;
  onRenameStart(): void;
  onRenameCommit(name: string): void;
  onRenameCancel(): void;
  onOpen(): void;
  onDuplicate(): void;
  onDelete(): void;
  onExport(): void;
}

function WorkflowCard({
  wf,
  menuOpen,
  onMenuToggle,
  renaming,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onOpen,
  onDuplicate,
  onDelete,
  onExport,
}: CardProps) {
  function onCardKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (renaming) return;
    // Only act on keystrokes targeting the card itself, not bubbled from
    // child <button>s — Enter/Space on the kebab or a menu item must not
    // also navigate to the canvas.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      className="workflow-card"
      role="button"
      tabIndex={renaming ? -1 : 0}
      onClick={(e) => {
        if (renaming) return;
        // Ignore clicks that originated inside the menu region.
        if (e.target instanceof Element && e.target.closest('.workflow-card-menu')) return;
        onOpen();
      }}
      onKeyDown={onCardKey}
    >
      <div className="workflow-card-title-row">
        {renaming ? (
          <RenameInput
            initialValue={wf.name}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <h3 className="workflow-card-title">{wf.name}</h3>
        )}
        <div className="workflow-card-menu">
          <button
            className="workflow-card-menu-btn secondary"
            aria-label="Workflow actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              onMenuToggle();
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="workflow-card-menu-popover" role="menu">
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); onRenameStart(); }}>
                Rename
              </button>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>
                Duplicate
              </button>
              <button role="menuitem" onClick={(e) => { e.stopPropagation(); onExport(); }}>
                Export JSON
              </button>
              <button
                role="menuitem"
                className="workflow-card-menu-danger"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="workflow-card-meta muted">
        <span>{wf.nodes.length} {wf.nodes.length === 1 ? 'node' : 'nodes'}</span>
        <span aria-hidden="true">·</span>
        <span title={wf.updatedAt}>Updated {formatRelativeTime(wf.updatedAt)}</span>
      </div>
    </div>
  );
}

interface RenameInputProps {
  initialValue: string;
  onCommit(name: string): void;
  onCancel(): void;
}

/**
 * Uncontrolled rename input. Parent remounts via `renaming` toggle so
 * `defaultValue` always reflects the live name. The committed ref
 * suppresses the blur→commit race when Enter triggers unmount before
 * blur fires.
 */
function RenameInput({ initialValue, onCommit, onCancel }: RenameInputProps) {
  const committed = useRef(false);

  function commit(value: string) {
    if (committed.current) return;
    committed.current = true;
    onCommit(value);
  }

  return (
    <input
      autoFocus
      className="workflow-card-rename-input"
      defaultValue={initialValue}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(e.currentTarget.value);
        else if (e.key === 'Escape') {
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  );
}

interface TemplateCardProps {
  template: TemplateWorkflow;
  onUse(): void;
}

function TemplateCard({ template, onUse }: TemplateCardProps) {
  const nodeCount = template.nodes.length;
  return (
    <div className="workflow-card workflow-template-card">
      <div className="workflow-card-title-row">
        <h3 className="workflow-card-title">{template.name}</h3>
        <span className={`workflow-template-badge workflow-template-badge-${template.category}`}>
          {CATEGORY_LABELS[template.category]}
        </span>
      </div>
      <p className="workflow-template-description muted">{template.description}</p>
      <div className="workflow-card-meta muted">
        <span>{nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}</span>
        {template.requiresBYOK && (
          <>
            <span aria-hidden="true">·</span>
            <span className="workflow-template-byok-pill" title="Needs a BYOK credential">
              Requires BYOK
            </span>
          </>
        )}
      </div>
      <div className="workflow-template-actions">
        <button onClick={onUse}>Use template</button>
      </div>
    </div>
  );
}
