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
import { snapshotRunVariables } from './variablesRuntime.js';
import type { BundleScope } from './inMemorySurfaces.js';
import type { Storage } from '../storage/storage.js';
import type { RunRecord } from '../types.js';

const log = createLogger('host.canvas');

type Json = Record<string, unknown>;

/** Injected at boot (createApp) so crossCanvasInvoke can spawn a real child
 *  run — host surfaces don't otherwise see the run dispatcher. Mirrors
 *  `setSubWorkflowDispatcher`. */
interface CanvasInvokeDeps {
  storage: Storage;
  getWorkflow: (workflowId: string) => Promise<{ definition: WorkflowDef } | null>;
  executeRun: (storage: Storage, run: RunRecord, definition: unknown, options?: unknown) => Promise<unknown>;
}
interface WorkflowDef { variables?: unknown }
let _invokeDeps: CanvasInvokeDeps | null = null;
export function setCanvasInvokeDispatcher(d: CanvasInvokeDeps): void {
  _invokeDeps = d;
}

/** Max canvas-invoke nesting depth (cycle/runaway guard), matching the
 *  sub-workflow dispatcher's cap. */
const MAX_INVOKE_DEPTH = 8;
const TERMINAL_RUN: readonly string[] = ['completed', 'failed', 'cancelled'];
// Per-tenant::target circuit breaker — consecutive child-run failures.
const _circuit = new Map<string, number>();

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
  invoke(targetCanvasId: string, workflowId: string, args: Json, opts?: { awaitTerminal?: boolean; timeoutMs?: number; circuitBreaker?: unknown; idempotencyKey?: string }): Promise<{ childRunId: string; result?: unknown; circuitOpen?: boolean; terminalStatus?: string; error?: unknown }>;
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

    async invoke(targetCanvasId, workflowId, args, opts) {
      // Surface-direct callers (no app boot) have no dispatcher — stay honest.
      if (!_invokeDeps) {
        log.info('canvas invoke: dispatcher not initialized (surface-direct)', { targetCanvasId, workflowId });
        return { childRunId: `canvas-invoke-${randomUUID()}`, result: { demo: 'run dispatcher not initialized' } };
      }
      const { storage, getWorkflow, executeRun } = _invokeDeps;

      // Circuit breaker: after N consecutive child-run failures for this
      // target, open the circuit (configurable threshold; default 5).
      const cbKey = `${tenantId}::${targetCanvasId}`;
      const threshold = Number((opts?.circuitBreaker as { threshold?: number } | undefined)?.threshold ?? 5);
      if ((_circuit.get(cbKey) ?? 0) >= threshold) {
        log.warn('canvas invoke: circuit open', { targetCanvasId, failures: _circuit.get(cbKey) });
        return { childRunId: '', circuitOpen: true };
      }

      // Recursion/depth guard — walk the parentRunId ancestor chain.
      const ancestors: string[] = [];
      let cursor = scope.runId;
      while (cursor && ancestors.length < MAX_INVOKE_DEPTH) {
        const a = await storage.getRun(cursor);
        if (!a) break;
        ancestors.push(a.workflowId);
        cursor = a.parentRunId;
      }
      if (ancestors.length >= MAX_INVOKE_DEPTH) {
        throw Object.assign(new Error(`canvas invoke depth ${ancestors.length} exceeds ${MAX_INVOKE_DEPTH}`), { code: 'canvas_invoke_depth_exceeded' });
      }
      if (ancestors.includes(workflowId)) {
        throw Object.assign(new Error(`canvas invoke cycle: '${workflowId}' already in ancestor chain`), { code: 'canvas_invoke_cycle_detected' });
      }

      const wf = await getWorkflow(workflowId);
      if (!wf) {
        throw Object.assign(new Error(`canvas invoke: workflow '${workflowId}' not found`), { code: 'canvas_invoke_workflow_not_found' });
      }

      const childRunId = randomUUID();
      const now = new Date().toISOString();
      const childRun: RunRecord = {
        runId: childRunId,
        workflowId,
        tenantId,
        ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
        status: 'pending',
        inputs: (args as Json) ?? {},
        metadata: { causationCanvasId: targetCanvasId },
        configurable: {},
        ...(scope.runId ? { parentRunId: scope.runId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await storage.insertRun(childRun);

      // awaitTerminal:false → fire-and-forget; return the id immediately.
      if (opts?.awaitTerminal === false) {
        void executeRun(storage, childRun, wf.definition, {}).catch((err) => log.warn('canvas child run (async) failed', { childRunId, error: err instanceof Error ? err.message : String(err) }));
        return { childRunId };
      }

      // Await terminal (executeRun resolves at terminal/suspend). Optional
      // timeout: stop waiting but let the run continue in the background.
      const runP = executeRun(storage, childRun, wf.definition, {}).catch(() => undefined);
      let timedOut = false;
      if (opts?.timeoutMs && opts.timeoutMs > 0) {
        await Promise.race([runP, new Promise<void>((r) => setTimeout(() => { timedOut = true; r(); }, opts.timeoutMs))]);
        if (timedOut) return { childRunId, result: { timedOut: true } };
      } else {
        await runP;
      }

      const finalChild = await storage.getRun(childRunId);
      const status = finalChild?.status ?? 'failed';
      // Circuit-breaker bookkeeping: count failures, reset on success.
      _circuit.set(cbKey, status === 'failed' ? (_circuit.get(cbKey) ?? 0) + 1 : 0);

      const result = snapshotRunVariables(childRunId) ?? {};
      const out: { childRunId: string; result?: unknown; circuitOpen?: boolean; terminalStatus?: string; error?: unknown } = {
        childRunId,
        ...(TERMINAL_RUN.includes(status) ? { terminalStatus: status } : {}),
        result,
        ...(finalChild?.error ? { error: finalChild.error } : {}),
      };
      return out;
    },
  };
}
