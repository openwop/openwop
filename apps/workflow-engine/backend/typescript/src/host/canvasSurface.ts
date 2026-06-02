/**
 * `ctx.canvas` host surface (`host.canvas`, `spec/v1/host-capabilities.md`
 * §host.canvas) — the `vendor.myndhyve.canvas` pack's shared-canvas store.
 *
 * The sample host had no canvas store, so this adds one: a durable, versioned,
 * tenant-scoped document (`DurableCollection`). read/write/create are genuinely
 * functional — optimistic-concurrency writes (expectedVersion), shallow/deep/
 * replace merges, field projection on read, idempotent create/write.
 *
 * crossCanvasInvoke (start a child run of another canvas's workflow) needs the
 * run dispatcher, which isn't injected into host surfaces; it returns an honest
 * acknowledgement (synthetic childRunId, no fabricated terminal status) and the
 * registry note says so. The other three nodes run for real.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../observability/logger.js';
import { DurableCollection } from './hostExtPersistence.js';
import type { BundleScope } from './inMemorySurfaces.js';

const log = createLogger('host.canvas');

type Json = Record<string, unknown>;

interface Canvas {
  canvasId: string;
  tenantId: string;
  canvasTypeId: string;
  name?: string;
  projectId?: string;
  state: Json;
  version: number;
  metadata?: Json;
  createdAt: string;
  updatedAt: string;
}

const canvases = new DurableCollection<Canvas>('canvas', (c) => c.canvasId);
// Idempotency cache for create/write keyed by tenant::idempotencyKey.
const _idem = new Map<string, unknown>();

function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
      ? deepMerge(cur as Json, v as Json)
      : v;
  }
  return out;
}

function project(state: Json, fields: unknown): Json {
  if (!Array.isArray(fields) || fields.length === 0) return state;
  const out: Json = {};
  for (const f of fields) if (typeof f === 'string' && f in state) out[f] = state[f];
  return out;
}

export interface CanvasSurface {
  read(canvasId: string, opts?: { fields?: unknown; consistency?: unknown }): Promise<{ canvasId: string; state: Json; canvasTypeId: string; version: number }>;
  write(canvasId: string, mutation: Json, opts?: { expectedVersion?: number; merge?: 'shallow' | 'deep' | 'replace'; idempotencyKey?: string }): Promise<{ canvasId: string; newVersion: number }>;
  create(args: { canvasTypeId: string; projectId?: string; name?: string; initialState?: Json; metadata?: Json; idempotencyKey?: string }): Promise<{ canvasId: string; canvasTypeId: string; name?: string; projectId?: string; createdAt: string }>;
  invoke(targetCanvasId: string, workflowId: string, args: Json, opts?: { awaitTerminal?: boolean; timeoutMs?: number; circuitBreaker?: unknown; idempotencyKey?: string }): Promise<{ childRunId: string; result?: unknown; circuitOpen?: boolean }>;
}

export function createCanvasSurface(scope: BundleScope): CanvasSurface {
  const tenantId = scope.tenantId;
  const idem = (key: string): string => `${tenantId}::${key}`;

  async function load(canvasId: string): Promise<Canvas> {
    const c = await canvases.get(canvasId);
    if (!c || c.tenantId !== tenantId) {
      throw Object.assign(new Error(`canvas ${canvasId} not found`), { code: 'canvas_not_found' });
    }
    return c;
  }

  return {
    async read(canvasId, opts) {
      const c = await load(canvasId);
      return { canvasId, state: project(c.state, opts?.fields), canvasTypeId: c.canvasTypeId, version: c.version };
    },

    async write(canvasId, mutation, opts) {
      if (opts?.idempotencyKey) {
        const cached = _idem.get(idem(`w:${opts.idempotencyKey}`)) as { canvasId: string; newVersion: number } | undefined;
        if (cached) return cached;
      }
      const c = await load(canvasId);
      if (opts?.expectedVersion !== undefined && opts.expectedVersion !== c.version) {
        throw Object.assign(new Error(`canvas ${canvasId} version conflict: expected ${opts.expectedVersion}, have ${c.version}`), { code: 'canvas_version_conflict' });
      }
      const merge = opts?.merge ?? 'shallow';
      const m = (mutation ?? {}) as Json;
      c.state = merge === 'replace' ? { ...m } : merge === 'deep' ? deepMerge(c.state, m) : { ...c.state, ...m };
      c.version += 1;
      c.updatedAt = new Date().toISOString();
      await canvases.put(c);
      const out = { canvasId, newVersion: c.version };
      if (opts?.idempotencyKey) _idem.set(idem(`w:${opts.idempotencyKey}`), out);
      return out;
    },

    async create({ canvasTypeId, projectId, name, initialState, metadata, idempotencyKey }) {
      if (idempotencyKey) {
        const cached = _idem.get(idem(`c:${idempotencyKey}`)) as { canvasId: string; canvasTypeId: string; name?: string; projectId?: string; createdAt: string } | undefined;
        if (cached) return cached;
      }
      const now = new Date().toISOString();
      const canvas: Canvas = {
        canvasId: `canvas-${randomUUID()}`,
        tenantId,
        canvasTypeId,
        ...(name !== undefined ? { name } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        state: (initialState as Json) ?? {},
        version: 1,
        ...(metadata !== undefined ? { metadata: metadata as Json } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await canvases.put(canvas);
      const out = { canvasId: canvas.canvasId, canvasTypeId, ...(name ? { name } : {}), ...(projectId ? { projectId } : {}), createdAt: now };
      if (idempotencyKey) _idem.set(idem(`c:${idempotencyKey}`), out);
      return out;
    },

    async invoke(targetCanvasId, workflowId) {
      // Honest demo stub: cross-canvas workflow dispatch needs the run
      // dispatcher, which isn't injected into host surfaces. Acknowledge with a
      // synthetic id; do NOT fabricate a terminal status or result.
      log.info('canvas invoke (demo: not dispatched — no run dispatcher on the surface)', { targetCanvasId, workflowId });
      return { childRunId: `canvas-invoke-${randomUUID()}`, result: { demo: 'cross-canvas invoke is not dispatched on the sample host' } };
    },
  };
}
