/**
 * OpenWOP Postgres reference host — SKELETON.
 *
 * Status: 2026-05-11 — not runnable as a full host. This file boots, exposes
 * `GET /.well-known/openwop` with a discovery document that explicitly
 * advertises `state: 'skeleton'`, and returns `501 not_implemented` on
 * every other route. The skeleton exists to:
 *
 *   1. Anchor the design described in `README.md` §"Build-out plan".
 *   2. Give operators something to clone + iterate on.
 *   3. Document the Postgres-specific concerns (advisory locks, SERIALIZABLE
 *      transactions, multi-tenancy, backpressure) inline next to where
 *      they'll eventually land.
 *
 * The full build-out is T2.1 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`. The
 * single biggest prerequisite is factoring the SQLite host's inline SQL
 * into a `StorageAdapter` interface — see README §"Phase A: Storage adapter".
 *
 * @see ../README.md
 * @see ../../sqlite/src/server.ts — the implementation this skeleton will
 *      eventually mirror via a shared host-core package.
 * @see spec/v1/production-profile.md (PROVISIONAL until ≥1 host advertises)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Client } from 'pg';

const HOST = process.env.OPENWOP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.OPENWOP_PORT ?? 3839);
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
const PG_DSN = process.env.OPENWOP_PG_DSN ?? '';

// ─── Pg client ───────────────────────────────────────────────────────────────
//
// Connection is lazy: we only open it when a real handler needs the DB.
// The skeleton's discovery endpoint doesn't touch Postgres, so the host
// boots even when no PG is reachable. This is deliberate — it lets the
// reader explore the design without a Postgres install.

let _pgClient: Client | null = null;
async function pg(): Promise<Client> {
  if (_pgClient) return _pgClient;
  if (!PG_DSN) {
    throw new Error(
      'OPENWOP_PG_DSN env var is required. Example: postgres://user:pass@localhost:5432/openwop',
    );
  }
  const c = new Client({ connectionString: PG_DSN });
  await c.connect();
  _pgClient = c;
  return c;
}

// ─── HTTP plumbing ───────────────────────────────────────────────────────────

function sendJSON(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJSON(res, status, { error: code, message });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function handleDiscovery(_req: IncomingMessage, res: ServerResponse): void {
  // Discovery doc deliberately marks the host as skeleton so smoke
  // scripts / conformance suites know not to expect a full surface.
  // Once the full build-out lands the `skeleton: true` field gets
  // removed and the rest of the capability fields populate per
  // production-profile.md.
  sendJSON(
    res,
    200,
    {
      protocolVersion: '1.0',
      implementation: {
        name: 'openwop-host-postgres',
        version: '0.1.0-skeleton',
        vendor: 'openwop-spec (reference example — SKELETON)',
        skeleton: true,
        readme: 'examples/hosts/postgres/README.md',
      },
      supportedEnvelopes: [],
      schemaVersions: {},
      limits: {
        clarificationRounds: 0,
        schemaRounds: 0,
        envelopesPerTurn: 0,
        maxNodeExecutions: 0,
      },
      supportedTransports: ['rest'],
      fixtures: [],
      capabilities: {
        // No optional profiles claimed in skeleton mode. The full host
        // will advertise: openwop-core, openwop-stream-poll, openwop-
        // stream-sse, openwop-audit-log-integrity, four interrupt
        // profiles, webhooks, observability, and (when ≥1 host claims
        // it on INTEROP-MATRIX) production-profile.
      },
    },
    { 'Cache-Control': 'public, max-age=300' },
  );
}

function notImplemented(req: IncomingMessage, res: ServerResponse): void {
  sendError(
    res,
    501,
    'not_implemented',
    `${req.method} ${req.url ?? '/'} is not yet implemented in the Postgres skeleton. ` +
      `See examples/hosts/postgres/README.md §"Build-out plan" for the path to a full host.`,
  );
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/.well-known/openwop') return handleDiscovery(req, res);

  // Everything else: explicit 501 with a pointer to the design doc.
  notImplemented(req, res);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  void route(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendError(res, 500, 'internal', message);
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[openwop-host-postgres SKELETON] listening on http://${HOST}:${PORT} (api key: ${API_KEY}; pg dsn: ${PG_DSN ? 'configured' : 'NOT CONFIGURED — many routes will fail'}). ` +
      `Only /.well-known/openwop is implemented; everything else returns 501. See README.md.`,
  );
});

const shutdown = (): void => {
  console.log('[openwop-host-postgres SKELETON] shutting down');
  if (_pgClient) void _pgClient.end();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
