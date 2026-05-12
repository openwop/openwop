/**
 * MCP client (Model Context Protocol) for the Postgres reference host.
 *
 * Phase H.2 — myndhyve.ai launch-blocker. Implements `core.mcp.toolCall`
 * typeId for invoking tools on configured MCP servers. The reference
 * host supports HTTP/JSON-RPC transport (the MCP spec's network mode);
 * stdio transport is a follow-up additive PR once an actual stdio
 * server lands in the conformance suite.
 *
 * **Wire contract** for `core.mcp.toolCall`:
 *
 *     node = {
 *       id: '...',
 *       typeId: 'core.mcp.toolCall',
 *       config: {
 *         serverId: 'my-mcp-server',     // operator-configured id
 *         toolName: 'echo',
 *         arguments?: Record<string, unknown>,
 *         timeoutMs?: number,            // default 30_000
 *       }
 *     }
 *
 * **Server configuration.** Operators map `serverId` → endpoint URL via
 * env: `OPENWOP_MCP_SERVER_<SERVER_ID>=http://...`. The reference host
 * does NOT discover MCP servers; production deployers wire a real
 * server registry (with auth + audit) behind the same lookup contract.
 *
 * **MCP-1 redaction invariant** (SECURITY/invariants.yaml + threat-
 * model-prompt-injection.md):
 *
 *   1. Tool arguments + tool results NEVER appear on emitted event
 *      payloads. The `node.completed` event carries a sanitized summary
 *      (toolName, argumentsSha256, resultSha256, resultLength, isError)
 *      that lets audit trails correlate tool calls without exposing
 *      payload contents.
 *   2. The full result IS persisted to `variables[node.id]` so the
 *      workflow can consume it — but variables are an AUTHENTICATED
 *      surface (only visible via GET /v1/runs/{id} with a valid
 *      bearer token), not a fanned-out event.
 *   3. The UNTRUSTED trust boundary (per threat-model-prompt-injection)
 *      is enforced: the result content is tagged `contentTrust:
 *      "untrusted"` so downstream LLM nodes treat it as user data,
 *      not as instructions.
 *
 * **JSON-RPC protocol** per MCP spec (2025-03-26):
 *   - All requests are POSTed to the server URL as JSON-RPC 2.0.
 *   - `initialize` is the first call on a fresh session; the reference
 *     host does this once per node invocation (no session pooling).
 *   - `tools/call` carries `{name, arguments}`; result is
 *     `{content: [...], isError?}`.
 *
 * @see spec/v1/host-capabilities.md §host.mcp
 * @see SECURITY/threat-model-prompt-injection.md §"UNTRUSTED marker"
 * @see https://spec.modelcontextprotocol.io/
 */

import { createHash } from 'node:crypto';

export interface McpToolCallConfig {
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
}

export interface McpToolCallResult {
  /** Full result content (passed to variables; NOT to event payloads). */
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string; readonly [k: string]: unknown }>;
  readonly isError: boolean;
  readonly contentTrust: 'untrusted';
  readonly durationMs: number;
}

export interface McpSanitizedSummary {
  /** Emitted on node.completed payload. SR-1/MCP-1 redaction-safe. */
  readonly serverId: string;
  readonly toolName: string;
  readonly argumentsSha256: string;
  readonly resultSha256: string;
  readonly resultLength: number;
  readonly isError: boolean;
  readonly durationMs: number;
}

export class McpClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpClientError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Resolve `serverId` → endpoint URL via env. Returns `null` when no
 * mapping exists. Operator contract:
 *     OPENWOP_MCP_SERVER_MY_SERVER=http://mcp.internal:9090
 * The lookup is case-insensitive on the suffix (env-var conventional
 * uppercase + dash-replaced-with-underscore).
 */
export function resolveMcpServerEndpoint(serverId: string): string | null {
  const normalized = serverId.toUpperCase().replace(/-/g, '_');
  const envKey = `OPENWOP_MCP_SERVER_${normalized}`;
  return process.env[envKey] ?? null;
}

/**
 * Issue a single JSON-RPC POST to an MCP server.
 *
 * Returns the parsed `result` field on success, throws `McpClientError`
 * on transport failure, JSON-RPC error, or unexpected shape. Used for
 * `initialize` and `tools/call` from `callMcpTool`.
 */
async function jsonRpc(
  endpoint: string,
  method: string,
  params: unknown,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  requestId: number,
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });

  const internalController = new AbortController();
  const timer = setTimeout(() => internalController.abort(), timeoutMs);
  const composedSignal = signal
    ? mergeSignals(signal, internalController.signal)
    : internalController.signal;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: composedSignal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (composedSignal.aborted && !signal?.aborted) {
      throw new McpClientError('mcp_timeout', `MCP ${method} timed out after ${timeoutMs}ms`);
    }
    throw new McpClientError(
      'mcp_network_error',
      `MCP ${method} network failure: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new McpClientError(
      'mcp_server_error',
      `MCP ${method} returned HTTP ${response.status}`,
      { status: response.status },
    );
  }

  let parsed: { result?: unknown; error?: { code?: number; message?: string } };
  try {
    parsed = (await response.json()) as typeof parsed;
  } catch {
    throw new McpClientError('mcp_protocol_error', `MCP ${method} response was not valid JSON`);
  }

  if (parsed.error) {
    throw new McpClientError(
      'mcp_tool_error',
      parsed.error.message ?? `MCP ${method} returned an error`,
      { rpcCode: parsed.error.code },
    );
  }
  return parsed.result ?? null;
}

let _requestId = 0;
function nextRequestId(): number {
  _requestId = (_requestId + 1) % 0x7fffffff;
  return _requestId;
}

/**
 * Invoke an MCP tool on a configured server.
 *
 * Performs `initialize` then `tools/call`. Returns the result with the
 * UNTRUSTED trust marker per threat-model-prompt-injection.md. Throws
 * `McpClientError` on any failure.
 *
 * Production hosts SHOULD pool the JSON-RPC connection per server to
 * avoid re-running `initialize` on every call; the reference host
 * forgoes pooling for simplicity (init is a single round-trip against
 * a local server, ~5ms overhead).
 */
export async function callMcpTool(
  config: McpToolCallConfig,
  signal?: AbortSignal,
): Promise<McpToolCallResult> {
  if (typeof config.serverId !== 'string' || !config.serverId) {
    throw new McpClientError('validation_error', 'core.mcp.toolCall: config.serverId MUST be a non-empty string');
  }
  if (typeof config.toolName !== 'string' || !config.toolName) {
    throw new McpClientError('validation_error', 'core.mcp.toolCall: config.toolName MUST be a non-empty string');
  }
  const endpoint = resolveMcpServerEndpoint(config.serverId);
  if (!endpoint) {
    throw new McpClientError(
      'mcp_server_not_configured',
      `MCP server "${config.serverId}" is not configured on this host (set OPENWOP_MCP_SERVER_<SERVER_ID>)`,
      { serverId: config.serverId },
    );
  }
  const timeoutMs = (() => {
    const t = config.timeoutMs;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(t, DEFAULT_TIMEOUT_MS * 4);
  })();

  const started = Date.now();

  // Spec requires an `initialize` handshake before tool calls.
  await jsonRpc(
    endpoint,
    'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'openwop-host-postgres', version: '1.0.0' },
    },
    timeoutMs,
    signal,
    nextRequestId(),
  );

  const result = await jsonRpc(
    endpoint,
    'tools/call',
    { name: config.toolName, arguments: config.arguments ?? {} },
    timeoutMs,
    signal,
    nextRequestId(),
  );

  if (typeof result !== 'object' || result === null) {
    throw new McpClientError('mcp_protocol_error', 'MCP tools/call returned a non-object result');
  }
  const typed = result as { content?: unknown; isError?: unknown };
  const content = Array.isArray(typed.content)
    ? (typed.content as McpToolCallResult['content'])
    : [];
  const isError = typed.isError === true;

  return {
    content,
    isError,
    contentTrust: 'untrusted' as const,
    durationMs: Date.now() - started,
  };
}

/**
 * Reduce a tool-call result to a redaction-safe summary for the event
 * log. MCP-1 invariant: tool arguments + content texts NEVER appear on
 * `node.completed` payloads — only the hashes + length.
 */
export function summarizeForEventLog(
  config: McpToolCallConfig,
  result: McpToolCallResult,
): McpSanitizedSummary {
  const argsJson = JSON.stringify(config.arguments ?? {});
  const resultJson = JSON.stringify(result.content);
  return {
    serverId: config.serverId,
    toolName: config.toolName,
    argumentsSha256: createHash('sha256').update(argsJson, 'utf8').digest('hex'),
    resultSha256: createHash('sha256').update(resultJson, 'utf8').digest('hex'),
    resultLength: resultJson.length,
    isError: result.isError,
    durationMs: result.durationMs,
  };
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}

/**
 * Capability advertisement payload. Operators configure additional
 * server endpoints via env; the host advertises that it supports the
 * MCP client surface, but NOT the specific server inventory (that's
 * deployment-private).
 */
export const REFERENCE_MCP_CLIENT_CAPABILITY = {
  supported: true,
  transports: ['http+jsonrpc'] as const,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  trustBoundary: 'untrusted' as const,
} as const;
