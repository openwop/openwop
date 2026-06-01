/**
 * Runtime-augmentable catalog of NodeCatalogEntry rows.
 *
 * On boot, `loadDynamicCatalog()` fetches GET /v1/host/sample/node-catalog
 * and merges every pack-declared node into the registry. Subscribers
 * (palette / canvas nodes / inspector) re-render via `useCatalog()`.
 *
 * Static entries (nodeCatalog.ts NODE_CATALOG) and dynamic entries
 * are merged at lookup time — `catalogEntry(kind)` returns dynamic
 * before static when both exist.
 */

import { useSyncExternalStore } from 'react';
import { NODE_CATALOG, type NodeCatalogEntry } from './nodeCatalog.js';
import { configFieldsFromSchema } from './configFieldsFromSchema.js';
import type { NodeCategory } from '../schema/workflow.js';
import { authedHeaders, config, fetchOpts } from '../../client/config.js';

// Re-exported for backward compat — `configFieldsFromSchema` used to live
// in this file but moved to its own module for unit testability.
export { configFieldsFromSchema };

interface ServerCatalogNode {
  typeId: string;
  version: string;
  label: string;
  description: string;
  category: string;
  role?: string;
  capabilities?: readonly string[];
  source: 'local' | 'pack';
  packName?: string;
  configSchema?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  /** Host surfaces this node needs (e.g. `host.kvStorage`). */
  requiresHostSurfaces?: readonly string[];
  /** Subset of requiresHostSurfaces this host does NOT advertise. */
  missingHostSurfaces?: readonly string[];
}

const dynamicByKind = new Map<string, NodeCatalogEntry>();
let lastLoadedAt = 0;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function getSnapshot(): number {
  return lastLoadedAt;
}

const STATIC_BY_KIND = new Map(NODE_CATALOG.map((e) => [e.kind, e]));
const STATIC_BY_TYPEID = new Map(NODE_CATALOG.map((e) => [e.typeId, e]));

export function catalogEntry(kind: string): NodeCatalogEntry | undefined {
  return STATIC_BY_KIND.get(kind) ?? dynamicByKind.get(kind);
}

/** Reverse lookup by canonical typeId (inverse of `kind`). Dynamic pack
 *  entries are keyed by typeId already, so this resolves both static and
 *  pack nodes. Used to import a canonical WorkflowDefinition (which
 *  references nodes by typeId) back into the builder. */
export function catalogEntryByTypeId(typeId: string): NodeCatalogEntry | undefined {
  return STATIC_BY_TYPEID.get(typeId) ?? dynamicByKind.get(typeId);
}

export function defaultConfigFor(kind: string): Record<string, unknown> {
  const entry = catalogEntry(kind);
  if (!entry) return {};
  const cfg: Record<string, unknown> = {};
  for (const f of entry.configFields) {
    if (f.defaultValue !== undefined) cfg[f.key] = f.defaultValue;
  }
  return cfg;
}

export function mergedCatalog(): NodeCatalogEntry[] {
  const seen = new Set<string>();
  const out: NodeCatalogEntry[] = [];
  for (const entry of NODE_CATALOG) {
    seen.add(entry.kind);
    out.push(entry);
  }
  for (const entry of dynamicByKind.values()) {
    if (seen.has(entry.kind)) continue;
    seen.add(entry.kind);
    out.push(entry);
  }
  return out;
}

export function useCatalog(): NodeCatalogEntry[] {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return mergedCatalog();
}

let loadPromise: Promise<void> | null = null;

export function loadDynamicCatalog(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(`${config.baseUrl}/v1/host/sample/node-catalog`, fetchOpts({
        headers: authedHeaders(),
      }));
      if (!res.ok) return;
      const body = (await res.json()) as { nodes: ServerCatalogNode[] };
      for (const node of body.nodes) {
        if (node.source !== 'pack') continue;
        // Skip server-side rows for nodes we already have a richer
        // static entry for (typeId match across the static catalog).
        if (NODE_CATALOG.some((e) => e.typeId === node.typeId)) continue;
        dynamicByKind.set(node.typeId, toCatalogEntry(node));
      }
      lastLoadedAt = Date.now();
      notify();
    } catch {
      /* registry unreachable; static catalog still works */
    } finally {
      // Don't null loadPromise — subsequent calls in the same session
      // reuse the resolved promise (catalog refreshes are explicit).
    }
  })();
  return loadPromise;
}

function toCatalogEntry(node: ServerCatalogNode): NodeCatalogEntry {
  const category = mapCategory(node.category);
  const accent = accentFor(category);
  const badge = badgeFor(node.label, node.typeId);
  return {
    kind: node.typeId,
    typeId: node.typeId,
    label: node.label,
    description: node.description,
    category,
    badge,
    accent,
    inputs: portsFromSchema(node.inputSchema, 'in'),
    outputs: portsFromSchema(node.outputSchema, 'out'),
    configFields: configFieldsFromSchema(node.configSchema),
    ...(node.packName ? { packName: node.packName } : {}),
    ...(node.requiresHostSurfaces && node.requiresHostSurfaces.length > 0
      ? { requiresHostSurfaces: node.requiresHostSurfaces }
      : {}),
    ...(node.missingHostSurfaces && node.missingHostSurfaces.length > 0
      ? { missingHostSurfaces: node.missingHostSurfaces }
      : {}),
  };
}

/**
 * Derive port definitions from a JSON Schema. Top-level required
 * properties become individual ports so the canvas shows what data
 * each node expects/emits. If the schema has no `properties` or no
 * required fields, fall back to a single `<fallbackName>` port of
 * type `object` so the node still connects.
 *
 * Port types are mapped from JSON Schema types — string/number/
 * boolean stay, object/array collapse to 'object' (we don't model
 * 'array' in our PortType union).
 */
function portsFromSchema(schema: unknown, fallbackName: string): { name: string; type: import('../schema/workflow.js').PortType }[] {
  if (!schema || typeof schema !== 'object') {
    return [{ name: fallbackName, type: 'object' }];
  }
  const s = schema as Record<string, unknown>;
  const props = s.properties as Record<string, unknown> | undefined;
  const required = Array.isArray(s.required) ? (s.required as string[]) : [];
  if (!props || required.length === 0) {
    return [{ name: fallbackName, type: 'object' }];
  }
  const ports: { name: string; type: import('../schema/workflow.js').PortType }[] = [];
  for (const propName of required) {
    const prop = props[propName];
    if (!prop || typeof prop !== 'object') continue;
    const ps = prop as Record<string, unknown>;
    const t = Array.isArray(ps.type) ? (ps.type[0] as string) : (ps.type as string | undefined);
    let portType: import('../schema/workflow.js').PortType = 'any';
    if (t === 'string') portType = 'string';
    else if (t === 'number' || t === 'integer') portType = 'number';
    else if (t === 'boolean') portType = 'boolean';
    else if (t === 'object' || t === 'array') portType = 'object';
    ports.push({ name: propName, type: portType });
  }
  return ports.length > 0 ? ports : [{ name: fallbackName, type: 'object' }];
}

function mapCategory(raw: string): NodeCategory {
  switch (raw) {
    case 'data':
    case 'ai':
    case 'flow':
    case 'control':
    case 'integration':
      return raw;
    default:
      return 'control';
  }
}

function accentFor(category: NodeCategory): string {
  switch (category) {
    case 'flow': return 'var(--cat-flow)';
    case 'data': return 'var(--cat-data)';
    case 'ai': return 'var(--cat-ai)';
    case 'control': return 'var(--cat-control)';
    case 'integration': return 'var(--cat-integration)';
  }
}

function badgeFor(label: string, typeId: string): string {
  const source = label || typeId;
  // Grab the first letter that isn't whitespace.
  const letter = source.replace(/[^a-zA-Z0-9]/g, '').charAt(0);
  return letter ? letter.toUpperCase() : '?';
}

