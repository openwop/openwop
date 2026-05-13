# `mcp-stdio-bridge/` — HTTP shim for stdio-transport MCP servers

The openwop MCP conformance probe
([`conformance/src/scenarios/mcp-tool-roundtrip.test.ts`](../../conformance/src/scenarios/mcp-tool-roundtrip.test.ts))
is HTTP-only: it POSTs JSON-RPC bodies and reads either
`application/json` or `text/event-stream` responses. But real
[`modelcontextprotocol/servers`](https://github.com/modelcontextprotocol/servers)
references default to **stdio** transport — JSON-RPC framed by
newlines over a child process's stdin/stdout. This bridge sits
between them so operators can collect real-impl interop evidence
against stdio servers without modifying the probe.

## Wire shape

```
┌──────────────────────┐    HTTP POST /mcp    ┌──────────────────────┐    stdin (JSON+\n)    ┌──────────────────────┐
│ openwop MCP probe    │ ───────────────────▶ │ mcp-stdio-bridge     │ ──────────────────▶  │ stdio MCP server     │
│ (Node + fetch)       │                      │ (this package)       │                       │ (child process)      │
│                      │ ◀─────────────────── │                      │ ◀────────────────── │                      │
└──────────────────────┘   application/json   └──────────────────────┘   stdout (JSON+\n)   └──────────────────────┘
```

Per-session lifecycle: one child per `mcp-session-id`. The probe sends
`initialize` without a session id; the bridge mints one, spawns a
fresh stdio child, forwards the request, and tags subsequent requests
to the same child. Children stay alive across the
initialize→list→call sequence so MCP session state survives.

## Quickstart

```bash
cd examples/mcp-stdio-bridge
npm install

# Boot against the bundled echo stdio server
OPENWOP_MCP_STDIO_CMD=node \
  OPENWOP_MCP_STDIO_ARGS='["./echo-stdio-server.mjs"]' \
  npm start
# → [mcp-stdio-bridge] listening on http://localhost:4021/mcp

# Run the openwop probe against the bridge (separate terminal)
cd ../../conformance
OPENWOP_MCP_REAL_SERVER_URL=http://localhost:4021/mcp \
  npx vitest run src/scenarios/mcp-tool-roundtrip.test.ts
# → ✓ real-server interop OK against http://localhost:4021/mcp
```

## Wrapping a real stdio MCP server

The bridge is transport-agnostic: any program that speaks
newline-delimited JSON-RPC on stdin/stdout works. Common examples
from `modelcontextprotocol/servers`:

```bash
# Filesystem server (Python)
OPENWOP_MCP_STDIO_CMD=uvx \
  OPENWOP_MCP_STDIO_ARGS='["mcp-server-filesystem","/tmp"]' \
  npm start

# Time server (TypeScript)
OPENWOP_MCP_STDIO_CMD=npx \
  OPENWOP_MCP_STDIO_ARGS='["@modelcontextprotocol/server-time"]' \
  npm start

# Custom Python server
OPENWOP_MCP_STDIO_CMD=python3 \
  OPENWOP_MCP_STDIO_ARGS='["./my-mcp-server.py"]' \
  npm start
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENWOP_MCP_STDIO_CMD` | Yes | — | The executable to spawn (e.g., `node`, `python3`, `uvx`). |
| `OPENWOP_MCP_STDIO_ARGS` | No | `[]` | JSON array of args (e.g., `'["./server.mjs", "--mode", "prod"]'`). |
| `PORT` | No | `4021` | Bridge bind port. |

## Files

- `bridge.mjs` — the HTTP-to-stdio shim. Stdlib + Express only; spawns child processes via `node:child_process`.
- `echo-stdio-server.mjs` — minimal stdio MCP server bundled for end-to-end smoke testing. Mirrors the HTTP reference at `/tmp/openwop-interop/mcp/server.mjs` (one `greet({name})` tool) so probe assertions stay shape-equivalent across transports.
- `package.json` — devDeps: `@modelcontextprotocol/sdk@1.29.0`, `express`, `zod`.

## What this is NOT

- **Not a production proxy.** Per-request error handling is minimal, no rate limiting, no auth. Use for conformance interop runs and local development only.
- **Not a substitute for native stdio support in the probe.** Eventually the probe SHOULD support stdio directly (spawn + pipe in-process). Until then this bridge is the documented operator workaround for closing the [Composition partners scope-limit](../../INTEROP-MATRIX.md) footnote about stdio.
- **Not SSE-aware.** The bridge returns `application/json` only — single JSON-RPC frame per response. Stdio MCP servers emit one response per request anyway, so SSE framing isn't necessary.

## See also

- [`spec/v1/mcp-integration.md`](../../spec/v1/mcp-integration.md) — openwop's MCP integration contract.
- [`conformance/src/scenarios/mcp-tool-roundtrip.test.ts`](../../conformance/src/scenarios/mcp-tool-roundtrip.test.ts) — the probe this bridge feeds.
- [`INTEROP-MATRIX.md`](../../INTEROP-MATRIX.md) §"Composition partners" — real-impl evidence row for MCP.
- [`gRPC HTTP/2 transport spec`](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md) — analogous shim pattern for protocols that need wire-format adaptation.
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — the canonical TypeScript SDK; `StdioServerTransport` is what `echo-stdio-server.mjs` uses.
