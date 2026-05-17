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
import { NODE_CATALOG, type ConfigField, type NodeCatalogEntry } from './nodeCatalog.js';
import type { NodeCategory } from '../schema/workflow.js';
import { config } from '../../client/config.js';

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

export function catalogEntry(kind: string): NodeCatalogEntry | undefined {
  return STATIC_BY_KIND.get(kind) ?? dynamicByKind.get(kind);
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
      const res = await fetch(`${config.baseUrl}/v1/host/sample/node-catalog`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
      });
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
    case 'flow': return '#5b8cff';
    case 'data': return '#4ade80';
    case 'ai': return '#a78bfa';
    case 'control': return '#fbbf24';
    case 'integration': return '#f59e0b';
  }
}

function badgeFor(label: string, typeId: string): string {
  const source = label || typeId;
  // Grab the first letter that isn't whitespace.
  const letter = source.replace(/[^a-zA-Z0-9]/g, '').charAt(0);
  return letter ? letter.toUpperCase() : '?';
}

/**
 * JSON-Schema → ConfigField[] mapping. Reads top-level `properties`
 * and creates one ConfigField per prop. Type inference:
 *   - boolean        → checkbox
 *   - number/integer → number input
 *   - object/array   → JSON textarea
 *   - everything else → plain text
 * Required fields surface via `field.required` so the inspector can
 * decorate them (red asterisk + `required` attribute on the input).
 */
function configFieldsFromSchema(schema: unknown): ConfigField[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props) return [];
  const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : []);
  const fields: ConfigField[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (!raw || typeof raw !== 'object') continue;
    const ps = raw as Record<string, unknown>;
    const type = Array.isArray(ps.type) ? (ps.type[0] as string) : (ps.type as string | undefined);
    let kind: ConfigField['kind'] = 'text';
    if (type === 'boolean') kind = 'checkbox';
    else if (type === 'number' || type === 'integer') kind = 'number';
    else if (type === 'object' || type === 'array') kind = 'textarea';
    const labelBase = (ps.title as string | undefined) ?? key;
    const def = ps.default;
    fields.push({
      key,
      label: labelBase,
      kind,
      required: required.has(key),
      defaultValue:
        typeof def === 'string' || typeof def === 'number' || typeof def === 'boolean'
          ? def
          : undefined,
      help: typeof ps.description === 'string' ? ps.description : undefined,
    });
  }
  return fields;
}
