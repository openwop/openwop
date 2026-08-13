/**
 * Track 6: in-process synthetic MCP server for roundtrip conformance.
 *
 * Implements just enough of the Model Context Protocol's HTTP/JSON-RPC
 * transport (https://spec.modelcontextprotocol.io/) to exercise the
 * host's MCP-integration code path:
 *
 *   - `initialize` — server info + capabilities
 *   - `tools/list` — returns a single deterministic `echo` tool
 *   - `tools/call name=echo` — records invocation, returns input verbatim
 *
 * Records every invocation in memory so scenarios can assert the host
 * called the expected tool with the expected arguments. The server is
 * Node-stdlib-only (no MCP SDK dependency) — the wire shape is small
 * enough to implement directly.
 *
 * Operator contract: when a host integrates MCP via a configurable
 * server URL, the operator points the host at this fake's endpoint
 * (printed at suite init). Hosts that hardcode MCP servers cannot
 * exercise the roundtrip scenario and the test skips.
 *
 * @see spec/v1/mcp-integration.md
 * @see SECURITY/threat-model-prompt-injection.md §"UNTRUSTED marker"
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface McpInvocation {
  readonly method: string;
  readonly params: unknown;
  readonly timestamp: number;
  /**
   * Request headers as received, lowercased.
   *
   * Added for RFC 0153 §A/§B alongside the identical addition to
   * `A2AFakePeer`. MCP's revision is negotiated in `MCP-Protocol-Version`, so a
   * recorder that captures only the JSON-RPC method and params can see that a
   * call happened and not which revision it was made under — which is the whole
   * of what §B governs.
   *
   * Both fake peers had the same gap, which is worth noting: the omission was
   * not an oversight in one file but a shared assumption that the interesting
   * part of a call is its body.
   */
  readonly headers: Readonly<Record<string, string>>;
}

export class McpFakeServer {
  private _server: Server | null = null;
  private _boundPort = 0;
  private readonly _invocations: McpInvocation[] = [];

  async start(port: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this._handle(req, res));
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        this._server = server;
        this._boundPort = addr.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this._server) return;
    const server = this._server;
    this._server = null;
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  endpoint(): string {
    return `http://127.0.0.1:${this._boundPort}`;
  }

  invocations(): readonly McpInvocation[] {
    return this._invocations;
  }

  reset(): void {
    this._invocations.length = 0;
  }

  private async _handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');

    let rpc: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
    try {
      rpc = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }));
      return;
    }

    if (typeof rpc.method === 'string') {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ');
      }
      this._invocations.push({
        method: rpc.method,
        params: rpc.params ?? null,
        timestamp: Date.now(),
        headers,
      });
    }

    const response = this._respond(rpc);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  private _respond(rpc: {
    id?: unknown;
    method?: string;
    params?: unknown;
  }): Record<string, unknown> {
    const id = rpc.id ?? null;
    switch (rpc.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'openwop-conformance-fake-mcp', version: '1.0.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'echo',
                description: 'Returns the `text` argument verbatim. Deterministic.',
                inputSchema: {
                  type: 'object',
                  properties: { text: { type: 'string' } },
                  required: ['text'],
                  additionalProperties: false,
                },
              },
            ],
          },
        };

      case 'tools/call': {
        const params = (rpc.params ?? {}) as { name?: string; arguments?: { text?: string } };
        if (params.name !== 'echo') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown tool: ${params.name}` },
          };
        }
        const text = params.arguments?.text ?? '';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text }],
            isError: false,
          },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${rpc.method}` },
        };
    }
  }
}

// Module-scope instance + lifecycle helpers, mirroring otel-collector.ts.
let _instance: McpFakeServer | null = null;

export function setMcpFakeServer(s: McpFakeServer | null): void {
  _instance = s;
}

export function getMcpFakeServer(): McpFakeServer | null {
  return _instance;
}
