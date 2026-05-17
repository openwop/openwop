/**
 * JSON-RPC 2.0 envelope helpers for the MCP server mount.
 *
 * Spec reference: JSON-RPC 2.0 (https://www.jsonrpc.org/specification) +
 * modelcontextprotocol.io 2025-06-18 (MCP wire is JSON-RPC over a chosen
 * transport — we expose streamable-HTTP per RFC 0020 §A point 1).
 *
 * @see RFCS/0020-host-mcp-server-composition.md
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Canonical JSON-RPC 2.0 error codes (subset relevant to MCP). */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export function parseRequest(body: unknown): JsonRpcRequest | JsonRpcError {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return rpcError(null, RPC_INVALID_REQUEST, 'request body MUST be a JSON object');
  }
  const obj = body as Record<string, unknown>;
  if (obj.jsonrpc !== '2.0') {
    return rpcError(extractId(obj), RPC_INVALID_REQUEST, 'jsonrpc field MUST be "2.0"');
  }
  if (typeof obj.method !== 'string' || obj.method.length === 0) {
    return rpcError(extractId(obj), RPC_INVALID_REQUEST, 'method MUST be a non-empty string');
  }
  const params = obj.params;
  if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
    return rpcError(extractId(obj), RPC_INVALID_PARAMS, 'params MUST be an object when present');
  }
  const out: JsonRpcRequest = {
    jsonrpc: '2.0',
    method: obj.method,
  };
  if ('id' in obj) out.id = extractId(obj);
  if (params !== undefined) out.params = params as Record<string, unknown>;
  return out;
}

function extractId(obj: Record<string, unknown>): JsonRpcId {
  const id = obj.id;
  if (typeof id === 'string' || typeof id === 'number' || id === null) return id;
  return null;
}

export function rpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  const err: JsonRpcError = { jsonrpc: '2.0', id, error: { code, message } };
  if (data !== undefined) err.error.data = data;
  return err;
}

export function isErrorResponse(r: JsonRpcResponse): r is JsonRpcError {
  return 'error' in r;
}
