/**
 * vendor.myndhyve.data-integration — typed data-source + transform + variable pack.
 *
 * 7 nodes route through ctx.dataIntegration.*:
 *   data.source.{rest, graphql, a2a, mcp}
 *   data.transform
 *   data.variable.{compute, fetch}
 *
 * Distinct from core.openwop.http (raw HTTP), core.openwop.mcp
 * (workflow-author MCP ops), and core.openwop.data (pure utilities).
 * This pack is for HIGHER-LEVEL data ingestion + transformation
 * tied to MyndHyve-registered data sources + variables.
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md
 */

import { createHash } from 'node:crypto';

function ensureDI(ctx) {
  if (!ctx.dataIntegration || typeof ctx.dataIntegration.fetchRest !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration'), { code: 'host_capability_missing' });
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

export async function sourceRest(ctx) {
  ensureDI(ctx);
  const { sourceId, method = 'GET', path, paginate = false } = ctx.config;
  const { params, body } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), sourceId, method, path ?? '', params ?? null, body ?? null, paginate,
  ]);
  const result = await ctx.dataIntegration.fetchRest({
    sourceId, method, paginate,
    ...(path !== undefined ? { path } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(body !== undefined ? { body } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      data: result?.data ?? null,
      status: typeof result?.status === 'number' ? result.status : 200,
      ...(typeof result?.pages === 'number' ? { pages: result.pages } : {}),
      fetchedAt: result?.fetchedAt ?? new Date().toISOString(),
    },
  };
}

export async function sourceGraphql(ctx) {
  ensureDI(ctx);
  if (typeof ctx.dataIntegration.fetchGraphql !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration.fetchGraphql'), { code: 'host_capability_missing' });
  }
  const { sourceId, operation, operationName } = ctx.config;
  const { variables } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), sourceId, operation, operationName ?? '', variables ?? null,
  ]);
  const result = await ctx.dataIntegration.fetchGraphql({
    sourceId, operation,
    ...(operationName !== undefined ? { operationName } : {}),
    ...(variables !== undefined ? { variables } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      data: result?.data ?? null,
      ...(Array.isArray(result?.errors) && result.errors.length ? { errors: result.errors } : {}),
      fetchedAt: result?.fetchedAt ?? new Date().toISOString(),
    },
  };
}

export async function sourceA2A(ctx) {
  ensureDI(ctx);
  if (typeof ctx.dataIntegration.fetchA2A !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration.fetchA2A'), { code: 'host_capability_missing' });
  }
  const { peerId, taskType, timeoutMs } = ctx.config;
  const { payload } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), peerId, taskType, payload ?? null,
  ]);
  const result = await ctx.dataIntegration.fetchA2A({
    peerId, taskType,
    ...(payload !== undefined ? { payload } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      ...(result?.result !== undefined ? { result: result.result } : {}),
      taskState: result?.taskState ?? 'completed',
      ...(result?.error ? { error: result.error } : {}),
      peerId,
      ...(result?.taskId ? { taskId: result.taskId } : {}),
    },
  };
}

export async function sourceMCP(ctx) {
  ensureDI(ctx);
  if (typeof ctx.dataIntegration.fetchMCP !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration.fetchMCP'), { code: 'host_capability_missing' });
  }
  const { serverId, operation } = ctx.config;
  const { args } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), serverId, operation, args ?? null,
  ]);
  const result = await ctx.dataIntegration.fetchMCP({
    serverId, operation,
    ...(args !== undefined ? { args } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      data: result?.data ?? null,
      kind: operation.kind,
      ...(operation.kind === 'tool' && result?.isError !== undefined ? { isError: result.isError === true } : {}),
      ...(operation.kind === 'resource' && result?.mimeType ? { mimeType: result.mimeType } : {}),
    },
  };
}

export async function dataTransform(ctx) {
  ensureDI(ctx);
  if (typeof ctx.dataIntegration.transform !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration.transform'), { code: 'host_capability_missing' });
  }
  const { expression, language } = ctx.config;
  const { data } = ctx.inputs;
  const result = await ctx.dataIntegration.transform({ expression, language, data });
  return { status: 'success', outputs: { result: result?.result ?? null } };
}

export async function variableCompute(ctx) {
  ensureDI(ctx);
  if (typeof ctx.dataIntegration.computeVariable !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration.computeVariable'), { code: 'host_capability_missing' });
  }
  const { variableName, expression, language = 'jsonata' } = ctx.config;
  const { context } = ctx.inputs;
  const result = await ctx.dataIntegration.computeVariable({
    variableName, expression, language,
    ...(context !== undefined ? { context } : {}),
  });
  return {
    status: 'success',
    outputs: {
      variableName,
      value: result?.value ?? null,
    },
  };
}

export async function variableFetch(ctx) {
  ensureDI(ctx);
  if (typeof ctx.dataIntegration.fetchVariable !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.dataIntegration.fetchVariable'), { code: 'host_capability_missing' });
  }
  const { variableName, defaultValue } = ctx.config;
  const hasDefault = Object.prototype.hasOwnProperty.call(ctx.config ?? {}, 'defaultValue');
  const result = await ctx.dataIntegration.fetchVariable({ variableName });

  if (result?.found === true) {
    return { status: 'success', outputs: { variableName, value: result.value, found: true } };
  }
  if (hasDefault) {
    return { status: 'success', outputs: { variableName, value: defaultValue, found: false, usedDefault: true } };
  }
  throw Object.assign(
    new Error(`variable '${variableName}' not found and no defaultValue configured`),
    { code: 'variable_not_found' }
  );
}

export const nodes = {
  'data.source.rest': sourceRest,
  'data.source.graphql': sourceGraphql,
  'data.source.a2a': sourceA2A,
  'data.source.mcp': sourceMCP,
  'data.transform': dataTransform,
  'data.variable.compute': variableCompute,
  'data.variable.fetch': variableFetch,
};

export default nodes;
