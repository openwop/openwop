/**
 * Left sidebar: draggable palette entries grouped by category.
 *
 * Drag payload: `application/openwop-node-kind` carries the
 * BuilderNodeKind string; the canvas's onDrop creates a node at the
 * drop point.
 *
 * The palette merges the local static catalog with whatever the
 * backend's `/v1/host/sample/node-catalog` endpoint advertises — that
 * pulls in registry packs (core.openwop.ai, core.openwop.http, …)
 * installed at boot.
 */

import { useEffect, useMemo } from 'react';
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

export function NodePalette() {
  useEffect(() => {
    loadDynamicCatalog();
  }, []);

  const catalog = useCatalog();
  const grouped = useMemo(() => {
    const g = new Map<NodeCategory, NodeCatalogEntry[]>();
    for (const c of CATEGORY_ORDER) g.set(c, []);
    for (const entry of catalog) {
      g.get(entry.category)?.push(entry);
    }
    return g;
  }, [catalog]);

  return (
    <aside className="builder-palette">
      <h3 className="builder-palette-title">Nodes</h3>
      <p className="builder-palette-hint muted">Drag onto the canvas.</p>
      {CATEGORY_ORDER.map((cat) => {
        const entries = grouped.get(cat) ?? [];
        if (entries.length === 0) return null;
        return (
          <div key={cat} className="builder-palette-group">
            <div className="builder-palette-group-label">{CATEGORY_LABELS[cat]}</div>
            {entries.map((entry) => (
              <PaletteItem key={entry.kind} entry={entry} />
            ))}
          </div>
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
  return (
    <div
      className="builder-palette-item"
      draggable
      onDragStart={onDragStart}
      title={entry.description}
    >
      <span
        className="builder-palette-item-badge"
        style={{ background: entry.accent }}
      >
        {entry.badge}
      </span>
      <span className="builder-palette-item-label">{entry.label}</span>
    </div>
  );
}
