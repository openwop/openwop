/**
 * MCP server mount — RFC 0020 reference implementation.
 *
 * Exposes a JSON-RPC endpoint at `POST /v1/host/sample/mcp` so external
 * MCP clients (Claude Desktop, Cursor, conformance harness) can:
 *   - discover workflows exposed via `core.openwop.mcp.expose-{tool,
 *     resource,prompt}` nodes;
 *   - invoke them via `tools/call` / `resources/read` / `prompts/get`;
 *   - issue bidirectional `sampling/createMessage` + `elicitation/create`
 *     that bridge into the workflow's `ctx.callAI` / `ctx.suspend`.
 *
 * Env-gated on `OPENWOP_MCP_SERVER_ENABLED=true`. OFF by default; boot
 * log warns when ON. Sample-vendor-namespaced under `/v1/host/sample/*`
 * per `spec/v1/host-extensions.md` §"Canonical prefixes" — NOT part of
 * the openwop wire contract.
 *
 * @see RFCS/0020-host-mcp-server-composition.md
 */

import type { Express, Request } from 'express';
import type { Storage } from '../storage/storage.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { Principal } from '../types.js';
import { dispatch } from '../host/mcpServerRouter.js';
import { parseRequest } from '../host/mcpJsonRpc.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.mcp');

interface Deps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
}

export function registerMcpServerRoutes(app: Express, deps: Deps): void {
  if (process.env.OPENWOP_MCP_SERVER_ENABLED !== 'true') {
    log.info('mcp server mount disabled (set OPENWOP_MCP_SERVER_ENABLED=true to enable)');
    return;
  }
  log.warn(
    'mcp server mount ENABLED — POST /v1/host/sample/mcp is reachable. NEVER enable in production without auth review.',
  );

  app.post('/v1/host/sample/mcp', async (req, res) => {
    const principal = principalFromReq(req);
    const parsed = parseRequest(req.body);
    if ('error' in parsed) {
      res.status(200).json(parsed);
      return;
    }
    const response = await dispatch(parsed, {
      storage: deps.storage,
      hostSuite: deps.hostSuite,
      principal,
    });
    res.status(200).json(response);
  });
}

function principalFromReq(req: Request): Principal {
  const maybe = (req as Request & { principal?: Principal }).principal;
  if (maybe) return maybe;
  // Fallback synthetic principal — auth middleware should always populate
  // req.principal upstream, but the conformance harness with bypass
  // mode may not.
  return {
    principalId: 'mcp-anonymous',
    tenants: ['*'],
    token: '',
  };
}
