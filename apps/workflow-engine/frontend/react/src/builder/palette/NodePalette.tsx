/**
 * Left sidebar: searchable, collapsible draggable palette.
 *
 * Three tiers:
 *   1. Search input filters by label / typeId / description / pack name
 *   2. Category sections (Flow / Data / Control / AI / Integration) — collapsible
 *   3. Pack sub-sections within each category (one per pack name; host-local
 *      nodes group under "Built-in") — collapsible
 *
 * Drag payload: `application/openwop-node-kind` carries the BuilderNodeKind
 * string; the canvas's onDrop creates a node at the drop point.
 *
 * The palette merges the local static catalog with whatever the backend's
 * `/v1/host/sample/node-catalog` endpoint advertises — that pulls in registry
 * packs (core.openwop.ai, core.openwop.http, …) installed at boot.
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { type NodeCatalogEntry } from './nodeCatalog.js';
import { loadDynamicCatalog, useCatalog } from './catalogRegistry.js';
import { PALETTE_MIME } from '../canvas/BuilderCanvas.js';
import type { NodeCategory } from '../schema/workflow.js';

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  flow: 'Flow',
  data: 'Data',
  ai: 'AI',
  control: 'Control',
  integration: 'Integration',
};

const CATEGORY_ORDER: NodeCategory[] = ['flow', 'data', 'control', 'ai', 'integration'];

const BUILTIN_SUBSECTION = '__builtin__';

/**
 * Derive a sub-section key for a catalog entry. Pack-sourced nodes group by
 * their full pack name (e.g., `core.openwop.flow`); host-local nodes group
 * under a single "Built-in" bucket.
 */
function subsectionKey(entry: NodeCatalogEntry): string {
  return entry.packName ?? BUILTIN_SUBSECTION;
}

/** Display label for a sub-section. Strips the `core.openwop.` prefix when
 *  present so users see `flow` / `data` / `http` rather than the full
 *  reverse-DNS pack name. */
function subsectionLabel(key: string): string {
  if (key === BUILTIN_SUBSECTION) return 'Built-in';
  if (key.startsWith('core.openwop.')) return key.slice('core.openwop.'.length);
  if (key.startsWith('vendor.')) return key.slice('vendor.'.length);
  if (key.startsWith('community.')) return key.slice('community.'.length);
  return key;
}

interface Filtered {
  byCategory: Map<NodeCategory, Map<string, NodeCatalogEntry[]>>;
  totalMatches: number;
}

function filterAndGroup(catalog: NodeCatalogEntry[], query: string): Filtered {
  const q = query.trim().toLowerCase();
  const byCategory = new Map<NodeCategory, Map<string, NodeCatalogEntry[]>>();
  for (const c of CATEGORY_ORDER) byCategory.set(c, new Map());
  let totalMatches = 0;
  for (const entry of catalog) {
    if (q) {
      const haystack = `${entry.label} ${entry.typeId} ${entry.description} ${entry.packName ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    const cat = byCategory.get(entry.category);
    if (!cat) continue;
    const sub = subsectionKey(entry);
    let arr = cat.get(sub);
    if (!arr) {
      arr = [];
      cat.set(sub, arr);
    }
    arr.push(entry);
    totalMatches++;
  }
  return { byCategory, totalMatches };
}

export function NodePalette() {
  useEffect(() => {
    loadDynamicCatalog();
  }, []);

  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  // Track *expanded* sections, not collapsed. Default = empty = everything
  // collapsed. Searching force-expands all sections so matches are visible
  // regardless of saved state (see `searching` checks in the render below).
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(() => new Set());

  const { byCategory, totalMatches } = useMemo(() => filterAndGroup(catalog, query), [catalog, query]);

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const toggleCategory = (cat: NodeCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const togglePack = (key: string) => {
    setExpandedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <aside className="builder-palette">
      <div className="builder-palette-header">
        <h3 className="builder-palette-title">Nodes</h3>
        <p className="builder-palette-hint muted">Drag onto the canvas.</p>
        <div className="builder-palette-search">
          <input
            type="search"
            className="builder-palette-search-input"
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {searching ? (
            <button
              type="button"
              className="builder-palette-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>
        {searching ? (
          <p className="builder-palette-search-summary muted">
            {totalMatches} match{totalMatches === 1 ? '' : 'es'}
          </p>
        ) : null}
      </div>

      {searching && totalMatches === 0 ? (
        <p className="builder-palette-empty muted">No nodes match.</p>
      ) : null}

      {CATEGORY_ORDER.map((cat) => {
        const subsections = byCategory.get(cat);
        if (!subsections || subsections.size === 0) return null;
        const total = [...subsections.values()].reduce((n, arr) => n + arr.length, 0);
        // Default: collapsed. Open when the user has toggled it OR a search is active
        // (searching force-expands every section so all hits are visible).
        const categoryCollapsed = !searching && !expandedCategories.has(cat);
        const subKeys = [...subsections.keys()].sort((a, b) => {
          // Built-in first, then alphabetical.
          if (a === BUILTIN_SUBSECTION) return -1;
          if (b === BUILTIN_SUBSECTION) return 1;
          return a.localeCompare(b);
        });
        return (
          <section key={cat} className="builder-palette-group">
            <button
              type="button"
              className="builder-palette-group-label"
              onClick={() => toggleCategory(cat)}
              aria-expanded={!categoryCollapsed}
            >
              <span className="builder-palette-disclosure" aria-hidden>
                {categoryCollapsed ? '▸' : '▾'}
              </span>
              <span className="builder-palette-group-name">{CATEGORY_LABELS[cat]}</span>
              <span className="builder-palette-group-count">{total}</span>
            </button>

            {categoryCollapsed
              ? null
              : subKeys.map((subKey) => {
                  const entries = subsections.get(subKey) ?? [];
                  if (entries.length === 0) return null;
                  // Only render a sub-section header when this category has multiple sub-sections.
                  // Single-subsection categories render as a flat list (keeps the small-category UX clean).
                  const showSubHeader = subsections.size > 1;
                  const packCollapseKey = `${cat}:${subKey}`;
                  const packCollapsed = showSubHeader && !searching && !expandedPacks.has(packCollapseKey);
                  return (
                    <div key={subKey} className="builder-palette-subgroup">
                      {showSubHeader ? (
                        <button
                          type="button"
                          className="builder-palette-subgroup-label"
                          onClick={() => togglePack(packCollapseKey)}
                          aria-expanded={!packCollapsed}
                          title={subKey === BUILTIN_SUBSECTION ? 'Host-local nodes' : subKey}
                        >
                          <span className="builder-palette-disclosure" aria-hidden>
                            {packCollapsed ? '▸' : '▾'}
                          </span>
                          <span className="builder-palette-subgroup-name">{subsectionLabel(subKey)}</span>
                          <span className="builder-palette-subgroup-count">{entries.length}</span>
                        </button>
                      ) : null}
                      {packCollapsed
                        ? null
                        : entries.map((entry) => <PaletteItem key={entry.typeId} entry={entry} />)}
                    </div>
                  );
                })}
          </section>
        );
      })}
    </aside>
  );
}

function PaletteItem({ entry }: { entry: NodeCatalogEntry }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(PALETTE_MIME, entry.kind);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const missing = entry.missingHostSurfaces ?? [];
  const blocked = missing.length > 0;
  const titleParts = [entry.typeId];
  if (entry.description) titleParts.push(entry.description);
  if (blocked) {
    titleParts.push(
      `Needs host capability: ${missing.join(', ')}.\nDragging works, but execution will fail with HOST_CAPABILITY_MISSING.`,
    );
  }
  return (
    <div
      className={`builder-palette-item${blocked ? ' builder-palette-item-blocked' : ''}`}
      draggable
      onDragStart={onDragStart}
      title={titleParts.join('\n\n')}
    >
      <span
        className="builder-palette-item-badge"
        style={{ background: entry.accent }}
      >
        {entry.badge}
      </span>
      <span className="builder-palette-item-label">{entry.label}</span>
      {blocked ? (
        <span
          className="builder-palette-item-host-warn"
          aria-label={`Needs host capability ${missing.join(', ')}`}
        >
          host?
        </span>
      ) : null}
    </div>
  );
}
