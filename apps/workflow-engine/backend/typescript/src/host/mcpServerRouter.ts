/**
 * MCP JSON-RPC method dispatch.
 *
 * Implements the subset of modelcontextprotocol.io 2025-06-18 the sample
 * host advertises in `capabilities.mcp.serverMount.transports`:
 *   - `initialize`, `ping`, `logging/setLevel`
 *   - `tools/list`, `tools/call`
 *   - `resources/list`, `resources/templates/list`, `resources/read`
 *   - `prompts/list`, `prompts/get`
 *   - `completion/complete`  (stub — host returns empty completion array)
 *   - `sampling/createMessage`   (bridges into ctx.callAI via handle-sampling)
 *   - `elicitation/create`        (bridges into ctx.suspend via handle-elicitation)
 *
 * All inbound traffic crosses an `untrusted` boundary per RFC 0020 §D.
 * `tools/call.arguments` validates against the registered `inputSchema`
 * BEFORE workflow start — see `SECURITY/invariants.yaml`
 * `mcp-server-untrusted-args`. The resource URI sandbox normalizes via
 * `new URL()` + allowlists schemes (`mcp:`, `https:`, `openwop-resource:`)
 * + rejects path components containing `..` after decode, defeating
 * encoded-traversal attacks (`%2e%2e%2f`, `..%2f`, etc.).
 *
 * Downstream trustBoundary propagation (RFC 0020 §D): every MCP-originated
 * run is created with `metadata.trustBoundary: 'untrusted'`. The executor
 * reads that and surfaces it on each node's `ctx.trustBoundary` so pack
 * nodes that forward content to LLM surfaces can apply the
 * `threat-model-prompt-injection.md` UNTRUSTED-marker convention. Further
 * propagation hooks — emitting `agent.toolCalled` events with the trust
 * marker, attaching `inboundContentTrust` to `agent.reasoned` spans —
 * remain follow-up work and are tracked under the trust-marker plumbing
 * inside `core.openwop.ai`/`core.openwop.mcp` pack delegates.
 *
 * @see RFCS/0020-host-mcp-server-composition.md §D
 */

import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import type { Storage } from '../storage/storage.js';
import type { HostAdapterSuite } from './index.js';
import type { Principal, RunRecord } from '../types.js';
import { executeRun } from '../executor/executor.js';
import {
  findElicitationHandler,
  findPromptByName,
  findResourceByUri,
  findSamplingHandler,
  findToolByName,
  listPrompts,
  listResources,
  listResourceTemplates,
  listTools,
} from './mcpServerRegistry.js';
import {
  rpcError,
  rpcSuccess,
  RPC_INVALID_PARAMS,
  RPC_INTERNAL_ERROR,
  RPC_METHOD_NOT_FOUND,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcpJsonRpc.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('host.mcpServerRouter');

/** Compiled Ajv2020 instance shared across requests. The instance is
 *  thread-safe within a Node worker. Tool inputSchemas are added on
 *  first reference and cached by content hash. */
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaCache = new Map<string, ReturnType<typeof ajv.compile>>();

function compileSchema(schema: Record<string, unknown>): ReturnType<typeof ajv.compile> {
  // Cache key by JSON-stable hash of the schema. Cheap enough — tool
  // schemas are small. `JSON.stringify(schema)` is a deterministic
  // identity because Ajv treats object-property-order semantically.
  const key = JSON.stringify(schema);
  let validator = schemaCache.get(key);
  if (!validator) {
    validator = ajv.compile(schema);
    schemaCache.set(key, validator);
  }
  return validator;
}

export interface RouterDeps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
  principal: Principal;
}

export async function dispatch(
  request: JsonRpcRequest,
  deps: RouterDeps,
): Promise<JsonRpcResponse> {
  const id: JsonRpcId = request.id ?? null;
  const params = request.params ?? {};
  try {
    switch (request.method) {
      case 'initialize':
        return rpcSuccess(id, initializeResult());
      case 'ping':
        return rpcSuccess(id, {});
      case 'logging/setLevel': {
        const level = typeof params.level === 'string' ? params.level : 'info';
        log.info('mcp logging/setLevel', { level });
        return rpcSuccess(id, {});
      }
      case 'tools/list':
        return rpcSuccess(id, { tools: toolsListView() });
      case 'tools/call':
        return await dispatchToolsCall(id, params, deps);
      case 'resources/list':
        return rpcSuccess(id, { resources: resourcesListView() });
      case 'resources/templates/list':
        return rpcSuccess(id, { resourceTemplates: resourceTemplatesListView() });
      case 'resources/read':
        return await dispatchResourcesRead(id, params, deps);
      case 'prompts/list':
        return rpcSuccess(id, { prompts: promptsListView() });
      case 'prompts/get':
        return await dispatchPromptsGet(id, params, deps);
      case 'completion/complete':
        return rpcSuccess(id, { completion: { values: [], total: 0, hasMore: false } });
      case 'sampling/createMessage':
        return await dispatchSampling(id, params, deps);
      case 'elicitation/create':
        return await dispatchElicitation(id, params, deps);
      default:
        return rpcError(id, RPC_METHOD_NOT_FOUND, `method '${request.method}' not implemented`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('mcp dispatch failed', { method: request.method, error: message });
    return rpcError(id, RPC_INTERNAL_ERROR, message);
  }
}

function initializeResult(): Record<string, unknown> {
  // Mirrors modelcontextprotocol.io 2025-06-18 initialize/result shape.
  return {
    protocolVersion: '2025-06-18',
    serverInfo: {
      name: 'openwop-workflow-engine-sample',
      version: '0.1.0',
    },
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      prompts: { listChanged: false },
      logging: {},
    },
  };
}

function toolsListView(): unknown[] {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema,
  }));
}

function resourcesListView(): unknown[] {
  return listResources().map((r) => {
    const view: Record<string, unknown> = { uri: r.uri };
    if (r.name !== undefined) view.name = r.name;
    if (r.description !== undefined) view.description = r.description;
    if (r.mimeType !== undefined) view.mimeType = r.mimeType;
    return view;
  });
}

function resourceTemplatesListView(): unknown[] {
  return listResourceTemplates().map((r) => {
    const view: Record<string, unknown> = { uriTemplate: r.uri };
    if (r.name !== undefined) view.name = r.name;
    if (r.description !== undefined) view.description = r.description;
    if (r.mimeType !== undefined) view.mimeType = r.mimeType;
    return view;
  });
}

function promptsListView(): unknown[] {
  return listPrompts().map((p) => {
    const view: Record<string, unknown> = { name: p.name };
    if (p.description !== undefined) view.description = p.description;
    if (p.arguments !== undefined) view.arguments = p.arguments;
    return view;
  });
}

// ─────────────────────────────────────────────────────────────────
// tools/call — workflow as MCP tool
// ─────────────────────────────────────────────────────────────────

async function dispatchToolsCall(
  id: JsonRpcId,
  params: Record<string, unknown>,
  deps: RouterDeps,
): Promise<JsonRpcResponse> {
  const name = typeof params.name === 'string' ? params.name : null;
  if (!name) return rpcError(id, RPC_INVALID_PARAMS, 'tools/call requires params.name');
  const tool = findToolByName(name);
  if (!tool) return rpcError(id, RPC_INVALID_PARAMS, `tool '${name}' not exposed`);

  const args: Record<string, unknown> =
    params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

  // RFC 0020 §D + SECURITY/invariants.yaml mcp-server-untrusted-args:
  // arguments MUST validate against the tool's declared inputSchema
  // BEFORE any workflow side-effects.
  try {
    const validate = compileSchema(tool.inputSchema);
    if (!validate(args)) {
      return rpcError(id, RPC_INVALID_PARAMS, 'tool arguments failed inputSchema validation', {
        violations: validate.errors ?? [],
      });
    }
  } catch (err) {
    return rpcError(id, RPC_INVALID_PARAMS, 'tool inputSchema compile failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const runResult = await runWorkflowSync({
    deps,
    workflowId: tool.workflowId,
    inputs: args,
    trustBoundary: 'untrusted',
  });

  // Pack the run's terminal outputs as CallToolResult per RFC 0020 §C.
  if (runResult.status === 'completed') {
    const text = coerceContentText(runResult.outputs);
    return rpcSuccess(id, {
      content: [{ type: 'text', text }],
      isError: false,
    });
  }
  if (runResult.status === 'failed') {
    return rpcSuccess(id, {
      content: [
        {
          type: 'text',
          text: runResult.error
            ? `run failed: ${runResult.error.code}: ${runResult.error.message}`
            : 'run failed',
        },
      ],
      isError: true,
    });
  }
  // Suspended or canceled — surface as MCP error result per §C.
  return rpcSuccess(id, {
    content: [{ type: 'text', text: `run ${runResult.status}` }],
    isError: true,
  });
}

// ─────────────────────────────────────────────────────────────────
// resources/read + prompts/get
// ─────────────────────────────────────────────────────────────────

async function dispatchResourcesRead(
  id: JsonRpcId,
  params: Record<string, unknown>,
  deps: RouterDeps,
): Promise<JsonRpcResponse> {
  const uri = typeof params.uri === 'string' ? params.uri : null;
  if (!uri) return rpcError(id, RPC_INVALID_PARAMS, 'resources/read requires params.uri');
  // RFC 0020 §D: resource URIs MUST be normalized + sandboxed. Parse via
  // WHATWG URL (handles percent-decoding), reject non-allowlisted schemes,
  // then reject any path component that decodes to `..` (defeats
  // encoded-traversal: `%2e%2e%2f`, `..%2f`, `%2e%2e/`, etc.).
  if (!isSafeResourceUri(uri)) {
    return rpcError(id, RPC_INVALID_PARAMS, 'resource uri rejected: unsupported scheme or path traversal');
  }
  const resource = findResourceByUri(uri);
  if (!resource) return rpcError(id, RPC_INVALID_PARAMS, `resource '${uri}' not exposed`);

  const runResult = await runWorkflowSync({
    deps,
    workflowId: resource.workflowId,
    inputs: { uri },
    trustBoundary: 'untrusted',
  });

  if (runResult.status === 'completed') {
    const text = coerceContentText(runResult.outputs);
    const view: Record<string, unknown> = { uri, text };
    if (resource.mimeType !== undefined) view.mimeType = resource.mimeType;
    return rpcSuccess(id, { contents: [view] });
  }
  return rpcError(id, RPC_INTERNAL_ERROR, `resource read failed: run ${runResult.status}`);
}

async function dispatchPromptsGet(
  id: JsonRpcId,
  params: Record<string, unknown>,
  deps: RouterDeps,
): Promise<JsonRpcResponse> {
  const name = typeof params.name === 'string' ? params.name : null;
  if (!name) return rpcError(id, RPC_INVALID_PARAMS, 'prompts/get requires params.name');
  const prompt = findPromptByName(name);
  if (!prompt) return rpcError(id, RPC_INVALID_PARAMS, `prompt '${name}' not exposed`);

  // RFC 0020 §D: prompt arguments are NOT template-evaluated. We pass
  // them as inputs.arguments and let the workflow do the rendering
  // explicitly (no eval, no Function constructor).
  const args: Record<string, unknown> =
    params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

  const runResult = await runWorkflowSync({
    deps,
    workflowId: prompt.workflowId,
    inputs: { arguments: args },
    trustBoundary: 'untrusted',
  });

  if (runResult.status === 'completed') {
    const text = coerceContentText(runResult.outputs);
    const view: Record<string, unknown> = {
      messages: [{ role: 'user', content: { type: 'text', text } }],
    };
    if (prompt.description !== undefined) view.description = prompt.description;
    return rpcSuccess(id, view);
  }
  return rpcError(id, RPC_INTERNAL_ERROR, `prompt render failed: run ${runResult.status}`);
}

// ─────────────────────────────────────────────────────────────────
// sampling/createMessage — bridge to ctx.callAI via handle-sampling node
// ─────────────────────────────────────────────────────────────────

async function dispatchSampling(
  id: JsonRpcId,
  params: Record<string, unknown>,
  deps: RouterDeps,
): Promise<JsonRpcResponse> {
  const handler = findSamplingHandler();
  if (!handler) {
    return rpcError(
      id,
      RPC_METHOD_NOT_FOUND,
      'sampling/createMessage requires a workflow with core.openwop.mcp.handle-sampling',
    );
  }
  const runResult = await runWorkflowSync({
    deps,
    workflowId: handler.workflowId,
    inputs: { request: params },
    trustBoundary: 'untrusted',
  });

  if (runResult.status === 'completed') {
    // The handle-sampling delegate returns outputs.result = ctx.callAI result.
    const outputs = (runResult.outputs ?? {}) as Record<string, unknown>;
    const result = (outputs.result ?? {}) as Record<string, unknown>;
    return rpcSuccess(id, {
      role: 'assistant',
      content: {
        type: 'text',
        text: typeof result.content === 'string' ? result.content : JSON.stringify(result),
      },
      model: typeof result.model === 'string' ? result.model : 'unknown',
      stopReason: typeof result.finishReason === 'string' ? result.finishReason : 'endTurn',
    });
  }
  return rpcError(
    id,
    RPC_INTERNAL_ERROR,
    `sampling bridge failed: ${runResult.status}${runResult.error ? ` (${runResult.error.code})` : ''}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// elicitation/create — bridge to ctx.suspend via handle-elicitation node
// ─────────────────────────────────────────────────────────────────

async function dispatchElicitation(
  id: JsonRpcId,
  params: Record<string, unknown>,
  deps: RouterDeps,
): Promise<JsonRpcResponse> {
  const handler = findElicitationHandler();
  if (!handler) {
    return rpcError(
      id,
      RPC_METHOD_NOT_FOUND,
      'elicitation/create requires a workflow with core.openwop.mcp.handle-elicitation',
    );
  }
  const runResult = await runWorkflowSync({
    deps,
    workflowId: handler.workflowId,
    inputs: { request: params },
    trustBoundary: 'untrusted',
    /** Elicitation pauses the run — the suspend status is the normal
     *  terminal-for-this-call signal. The conformance test's host-side
     *  resolver can post the answer via the standard interrupt routes;
     *  here we just acknowledge the bridge dispatched. */
    acceptSuspended: true,
  });

  if (runResult.status === 'awaiting-input') {
    // Bridge dispatched and the workflow is waiting. Return a pending
    // response shape — MCP clients will receive the final accept/decline
    // /cancel via a follow-up notification once the interrupt resolves.
    return rpcSuccess(id, {
      action: 'pending',
      content: {},
    });
  }
  if (runResult.status === 'completed') {
    // Workflow completed without pausing — e.g., test mode with synthetic
    // accept. Surface outputs as the elicitation response.
    const outputs = (runResult.outputs ?? {}) as Record<string, unknown>;
    return rpcSuccess(id, {
      action: typeof outputs.action === 'string' ? outputs.action : 'accept',
      content: (outputs.content ?? {}) as Record<string, unknown>,
    });
  }
  return rpcError(
    id,
    RPC_INTERNAL_ERROR,
    `elicitation bridge failed: ${runResult.status}${runResult.error ? ` (${runResult.error.code})` : ''}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// Run-and-collect helper
// ─────────────────────────────────────────────────────────────────

interface RunResult {
  status: 'completed' | 'failed' | 'awaiting-input' | 'cancelled';
  outputs: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

async function runWorkflowSync(input: {
  deps: RouterDeps;
  workflowId: string;
  inputs: Record<string, unknown>;
  trustBoundary: 'trusted' | 'untrusted';
  acceptSuspended?: boolean;
}): Promise<RunResult> {
  const { deps, workflowId, inputs } = input;
  const wf = await deps.hostSuite.workflowCatalog.getWorkflow(workflowId);
  if (!wf) {
    return {
      status: 'failed',
      outputs: null,
      error: { code: 'workflow_not_found', message: `workflowId ${workflowId} unknown` },
    };
  }

  const tenantId = deps.principal.tenants[0] && deps.principal.tenants[0] !== '*'
    ? deps.principal.tenants[0]
    : 'mcp-default';

  const runId = randomUUID();
  const now = new Date().toISOString();
  const run: RunRecord = {
    runId,
    workflowId,
    tenantId,
    status: 'pending',
    inputs,
    metadata: { source: 'mcp-server-mount', trustBoundary: input.trustBoundary },
    configurable: {},
    createdAt: now,
    updatedAt: now,
  };
  await deps.storage.insertRun(run);

  const exec = await executeRun(deps.storage, run, wf.definition, {
    policyResolver: deps.hostSuite.providerPolicyResolver,
  });

  // Read terminal status + outputs from the event log.
  const events = await deps.storage.listEvents(runId);
  let outputs: Record<string, unknown> | null = null;
  let error: { code: string; message: string } | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'node.completed' && outputs === null) {
      const p = e.payload as { outputs?: unknown } | undefined;
      if (p?.outputs && typeof p.outputs === 'object') {
        outputs = p.outputs as Record<string, unknown>;
      }
    }
    if ((e.type === 'run.failed' || e.type === 'node.failed') && error === null) {
      const p = e.payload as { error?: { code?: string; message?: string } } | undefined;
      if (p?.error) {
        error = {
          code: typeof p.error.code === 'string' ? p.error.code : 'internal_error',
          message: typeof p.error.message === 'string' ? p.error.message : 'run failed',
        };
      }
    }
  }

  const status: RunResult['status'] =
    exec.status === 'completed'
      ? 'completed'
      : exec.status === 'failed'
        ? 'failed'
        : exec.status === 'cancelled'
          ? 'cancelled'
          : 'awaiting-input';
  return { status, outputs, error };
}

/** RFC 0020 §D resource URI sandbox. Returns true iff the URI parses,
 *  uses an allowlisted scheme, and no decoded path segment contains a
 *  parent-directory marker (`..`) or empty/space segment. Defeats
 *  encoded-traversal attacks: `%2e%2e%2f`, `..%2f`, `%2e%2e/`, etc. */
const ALLOWED_RESOURCE_SCHEMES = new Set(['mcp:', 'openwop-resource:', 'https:']);
function isSafeResourceUri(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!ALLOWED_RESOURCE_SCHEMES.has(parsed.protocol)) return false;
  // pathname is automatically percent-decoded for the comparison below.
  const segments = decodeURIComponent(parsed.pathname).split('/');
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed === '..' || trimmed === '.') return false;
  }
  return true;
}

function coerceContentText(outputs: Record<string, unknown> | null): string {
  if (!outputs) return '';
  if (typeof outputs.text === 'string') return outputs.text;
  if (typeof outputs.output === 'string') return outputs.output;
  if (typeof outputs.result === 'string') return outputs.result;
  return JSON.stringify(outputs);
}

/** Test seam — clears the schema cache. */
export function _resetMcpRouterCaches(): void {
  schemaCache.clear();
}
