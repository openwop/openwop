/**
 * Minimal MCP (RFC 0020) browser client.
 *
 * The reference host exposes its registered workflows as MCP tools over a
 * JSON-RPC seam at `POST /v1/host/sample/mcp` (gated behind
 * `OPENWOP_MCP_SERVER_ENABLED=true`). This issues a `tools/list` call so
 * the UI can show which tools the host advertises. The mount is disabled
 * by default, so callers must handle the "not enabled" (404) case.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpListResult {
  /** True when the host mount is reachable (enabled). */
  enabled: boolean;
  tools: McpTool[];
  /** JSON-RPC error message, if the host returned one. */
  error?: string;
}

export async function listMcpTools(): Promise<McpListResult> {
  let res: Response;
  try {
    res = await fetch(
      `${config.baseUrl}/v1/host/sample/mcp`,
      fetchOpts({
        method: 'POST',
        headers: authedHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
  } catch (e) {
    return { enabled: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  }
  // The mount isn't registered unless OPENWOP_MCP_SERVER_ENABLED=true →
  // a 404 means "MCP server composition is off on this host".
  if (res.status === 404) return { enabled: false, tools: [] };
  if (!res.ok) return { enabled: true, tools: [], error: `MCP endpoint returned ${res.status}` };

  const body = (await res.json()) as {
    result?: { tools?: McpTool[] };
    error?: { message?: string };
  };
  if (body.error) return { enabled: true, tools: [], error: body.error.message ?? 'JSON-RPC error' };
  return { enabled: true, tools: body.result?.tools ?? [] };
}
