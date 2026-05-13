// HTTP-to-stdio bridge for the openwop MCP conformance probe.
//
// The probe (`conformance/src/scenarios/mcp-tool-roundtrip.test.ts`)
// only speaks HTTP — it POSTs JSON-RPC bodies and reads either
// `application/json` or `text/event-stream` responses. Real
// `modelcontextprotocol/servers` references default to **stdio**
// transport: JSON-RPC framed by newlines over a child's stdin/stdout.
// This bridge sits between them.
//
// Operator contract:
//   OPENWOP_MCP_STDIO_CMD       — path or argv0 of the stdio server
//   OPENWOP_MCP_STDIO_ARGS      — JSON array of args, e.g., '["--mode","prod"]'
//   PORT                        — bind port (default 4021)
//
// Per-session lifecycle: one child per `mcp-session-id`. The probe
// sends initialize without a session id; the bridge picks one up
// from the child's initialize response and routes subsequent
// requests by header.
//
// Single-response mode only — returns `application/json` with one
// JSON-RPC frame per request, matching the probe's
// content-negotiated default. SSE-stream upgrades aren't needed
// here because stdio MCP servers emit one response per request.

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import express from 'express';

const PORT = Number(process.env.PORT ?? 4021);
const STDIO_CMD = process.env.OPENWOP_MCP_STDIO_CMD;
const STDIO_ARGS = JSON.parse(process.env.OPENWOP_MCP_STDIO_ARGS ?? '[]');

if (!STDIO_CMD) {
  console.error(
    '[mcp-stdio-bridge] OPENWOP_MCP_STDIO_CMD is required. Example:\n' +
      "  OPENWOP_MCP_STDIO_CMD=node OPENWOP_MCP_STDIO_ARGS='[\"./echo-stdio-server.mjs\"]' npm start",
  );
  process.exit(1);
}

// session-id → { child, pending: Map<id, resolve> }
const sessions = new Map();

function spawnChild(sessionId) {
  const child = spawn(STDIO_CMD, STDIO_ARGS, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });
  const pending = new Map();
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      console.error(`[mcp-stdio-bridge:${sessionId}] non-JSON line dropped: ${trimmed.slice(0, 80)}`);
      return;
    }
    // Match by JSON-RPC id. Notifications (no id) are routed to the
    // most-recently-pending request as a best-effort log; the probe
    // doesn't assert on them.
    const id = msg.id;
    if (id !== undefined && id !== null) {
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(msg);
      } else {
        console.error(
          `[mcp-stdio-bridge:${sessionId}] response id=${id} arrived after timeout or duplicate`,
        );
      }
    }
  });
  child.on('exit', (code, signal) => {
    console.error(`[mcp-stdio-bridge:${sessionId}] child exited code=${code} signal=${signal}`);
    sessions.delete(sessionId);
    for (const [, resolve] of pending) {
      resolve({ jsonrpc: '2.0', error: { code: -32000, message: 'stdio child exited' }, id: null });
    }
    pending.clear();
  });
  return { child, pending };
}

function send(session, rpc) {
  return new Promise((resolve, reject) => {
    const id = rpc.id;
    if (id === undefined || id === null) {
      // Notification — just write, no response expected.
      session.child.stdin.write(JSON.stringify(rpc) + '\n');
      resolve(null);
      return;
    }
    session.pending.set(id, resolve);
    session.child.stdin.write(JSON.stringify(rpc) + '\n');
    // Per-request timeout — 10s is generous for local stdio.
    setTimeout(() => {
      if (session.pending.has(id)) {
        session.pending.delete(id);
        reject(new Error(`stdio response timeout for id=${id}`));
      }
    }, 10_000).unref();
  });
}

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  try {
    const rpc = req.body;
    if (!rpc || typeof rpc !== 'object' || rpc.jsonrpc !== '2.0') {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid JSON-RPC envelope' },
        id: null,
      });
      return;
    }

    let sessionId = req.headers['mcp-session-id'];
    let session;
    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId);
    } else {
      // New session — spawn a fresh child. The first request is
      // typically `initialize`; the bridge issues a session id even
      // though stdio MCP doesn't have a native session concept.
      sessionId = randomUUID();
      session = spawnChild(sessionId);
      sessions.set(sessionId, session);
    }

    const result = await send(session, rpc);
    res.setHeader('mcp-session-id', sessionId);
    res.json(result ?? { jsonrpc: '2.0', result: null, id: rpc.id ?? null });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: String(err.message ?? err) },
        id: null,
      });
    }
  }
});

process.on('SIGINT', () => {
  for (const [, s] of sessions) {
    s.child.kill('SIGTERM');
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(
    `[mcp-stdio-bridge] listening on http://localhost:${PORT}/mcp — wrapping stdio cmd: ${STDIO_CMD} ${STDIO_ARGS.join(' ')}`,
  );
});
