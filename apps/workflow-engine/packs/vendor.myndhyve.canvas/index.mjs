/**
 * vendor.myndhyve.canvas — MyndHyve canvas-coordination pack.
 *
 * First vendor-namespace pack. Ships four canvas-coordination
 * nodes that route through the host's canvas adapter (ctx.canvas.*).
 *
 * typeId-preserve strategy (per docs/plans/MYNDHYVE-TO-OPENWOP-PACK-
 * MIGRATION.md §4): the typeIds keep their existing `core.coordination.*`
 * prefixes even though the pack is vendor-namespaced. Stored MyndHyve
 * workflows that reference these typeIds work without rewriting.
 *
 * Replay model:
 *   All four nodes declare `side-effectful + cacheable` — canvas
 *   reads see time-varying state; writes mutate persistent state;
 *   creates allocate new identities; invokes start child runs.
 *   Engine's Layer-2 invocation log caches terminal payloads keyed
 *   on (runId, nodeId, request-hash). Replays return cached payloads
 *   without re-calling the canvas adapter — guaranteeing
 *   read-once-value, write-once-effect, create-once-id,
 *   invoke-once-child-run.
 *
 * Host contract (informative — the openwop spec doesn't yet
 * normatively declare `host.canvas`; per the migration plan §5.3
 * this surface needs spec-doc support via Tracks 10/13):
 *
 *   ctx.canvas.read(canvasId, { fields?, consistency? })
 *     → Promise<{ canvasId, state, canvasTypeId?, version }>
 *
 *   ctx.canvas.write(canvasId, mutation, { expectedVersion?, merge? })
 *     → Promise<{ canvasId, newVersion }>
 *
 *   ctx.canvas.create({ canvasTypeId, projectId?, name?, initialState?, metadata? })
 *     → Promise<{ canvasId, canvasTypeId, name?, projectId?, createdAt }>
 *
 *   ctx.canvas.invoke(targetCanvasId, workflowId, args, {
 *     awaitTerminal?, timeoutMs?, circuitBreaker?
 *   }) → Promise<{ childRunId, terminalStatus?, result?, error?, circuitOpen? }>
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md (in myndhyve)
 * @see spec/v1/host-extensions.md (host.* capability namespace)
 */

import { createHash } from 'node:crypto';

function ensureCanvas(ctx) {
  if (!ctx.canvas || typeof ctx.canvas.read !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.canvas — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing' }
    );
  }
}

function deriveIdempotencyKey(parts) {
  const h = createHash('sha256');
  for (const p of parts) {
    if (p === undefined || p === null) h.update('\0');
    else if (typeof p === 'string') h.update(p, 'utf8');
    else h.update(JSON.stringify(p), 'utf8');
    h.update('\x1e');
  }
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

/* ─── core.coordination.canvasRead ─────────────────────────── */

export async function canvasRead(ctx) {
  ensureCanvas(ctx);
  const { fields, consistency } = ctx.config;
  const { canvasId } = ctx.inputs;
  const result = await ctx.canvas.read(canvasId, {
    ...(fields !== undefined ? { fields } : {}),
    ...(consistency !== undefined ? { consistency } : {}),
  });
  return {
    status: 'success',
    outputs: {
      canvasId,
      state: result?.state ?? null,
      ...(result?.canvasTypeId ? { canvasTypeId: result.canvasTypeId } : {}),
      version: result?.version ?? 0,
      readAt: new Date().toISOString(),
    },
  };
}

/* ─── core.coordination.canvasWrite ────────────────────────── */

export async function canvasWrite(ctx) {
  ensureCanvas(ctx);
  if (typeof ctx.canvas.write !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.canvas.write'), { code: 'host_capability_missing' });
  }
  const { expectedVersion, merge = 'shallow' } = ctx.config;
  const { canvasId, mutation } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), canvasId, mutation, merge,
    expectedVersion ?? '',
  ]);
  const result = await ctx.canvas.write(canvasId, mutation, {
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    merge,
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      canvasId,
      newVersion: result?.newVersion ?? 0,
      writtenAt: new Date().toISOString(),
      idempotencyKey,
    },
  };
}

/* ─── core.coordination.canvasCreate ───────────────────────── */

export async function canvasCreate(ctx) {
  ensureCanvas(ctx);
  if (typeof ctx.canvas.create !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.canvas.create'), { code: 'host_capability_missing' });
  }
  const { canvasTypeId, projectId } = ctx.config;
  const { name, initialState, metadata } = ctx.inputs ?? {};
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), canvasTypeId,
    projectId ?? '', name ?? '', initialState ?? null,
  ]);
  const result = await ctx.canvas.create({
    canvasTypeId,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(initialState !== undefined ? { initialState } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      canvasId: result?.canvasId ?? '',
      canvasTypeId,
      ...(result?.name ? { name: result.name } : (name ? { name } : {})),
      ...(result?.projectId ? { projectId: result.projectId } : (projectId ? { projectId } : {})),
      createdAt: result?.createdAt ?? new Date().toISOString(),
      idempotencyKey,
    },
  };
}

/* ─── core.coordination.crossCanvasInvoke ──────────────────── */

export async function crossCanvasInvoke(ctx) {
  ensureCanvas(ctx);
  if (typeof ctx.canvas.invoke !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.canvas.invoke'), { code: 'host_capability_missing' });
  }
  const { targetCanvasId, workflowId, awaitTerminal, timeoutMs, circuitBreaker } = ctx.config;
  const { args } = ctx.inputs ?? {};
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    targetCanvasId, workflowId, args ?? null,
  ]);

  const result = await ctx.canvas.invoke(targetCanvasId, workflowId, args ?? {}, {
    ...(awaitTerminal !== undefined ? { awaitTerminal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(circuitBreaker !== undefined ? { circuitBreaker } : {}),
    idempotencyKey,
  });

  if (result?.circuitOpen === true) {
    return {
      status: 'success',
      outputs: {
        childRunId: '',
        targetCanvasId,
        circuitOpen: true,
        idempotencyKey,
      },
    };
  }

  return {
    status: 'success',
    outputs: {
      childRunId: result?.childRunId ?? '',
      targetCanvasId,
      ...(result?.terminalStatus ? { terminalStatus: result.terminalStatus } : {}),
      ...(result?.result !== undefined ? { result: result.result } : {}),
      ...(result?.error ? { error: result.error } : {}),
      idempotencyKey,
    },
  };
}

/* ─── Pack registry ────────────────────────────────────────── */

export const nodes = {
  'core.coordination.canvasRead': canvasRead,
  'core.coordination.canvasWrite': canvasWrite,
  'core.coordination.canvasCreate': canvasCreate,
  'core.coordination.crossCanvasInvoke': crossCanvasInvoke,
};

export default nodes;
