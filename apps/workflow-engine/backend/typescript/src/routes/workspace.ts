/**
 * RFC 0059 — agent workspace file endpoints (§C) + the cross-owner test seam.
 *
 * Wire endpoints (owner = the authenticated `{tenant, workspace}`; this demo
 * has a single workspace per tenant, `'default'`):
 *   GET    /v1/host/workspace/files            → { files: WorkspaceFileMeta[] }
 *   GET    /v1/host/workspace/files/:path      → WorkspaceFile | 404
 *   PUT    /v1/host/workspace/files/:path      → WorkspaceFile | 409 | 413
 *   DELETE /v1/host/workspace/files/:path      → 204 | 404
 *
 * Owner identity comes from `req.tenantId` (the authenticated principal),
 * NEVER the body/query — the WCT-1 fail-closed contract. Cross-owner access
 * (a different `{tenant, workspace}`) simply finds nothing → 404, no leak.
 *
 * The `POST /v1/host/sample/workspace/op` seam lets a single-credential
 * conformance harness drive DISTINCT owners (its `{tenant, workspace}` come
 * from the body) so it can prove cross-owner isolation (WCT-1).
 *
 * @see RFCS/0059-agent-workspace.md §C/§E
 * @see SECURITY/invariants.yaml workspace-cross-tenant-isolation
 */

import type { Express, Request, Response } from 'express';
import {
  putWorkspaceFile,
  getWorkspaceFile,
  listWorkspaceFiles,
  deleteWorkspaceFile,
} from '../host/workspaceStore.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.workspace');

/** This demo binds one workspace per tenant. */
const DEFAULT_WORKSPACE = 'default';

function ownerOf(req: Request): { tenant: string; workspace: string } {
  return { tenant: req.tenantId ?? 'default', workspace: DEFAULT_WORKSPACE };
}

function ifMatch(req: Request): string | undefined {
  const h = req.get('If-Match');
  return typeof h === 'string' && h.length > 0 ? h : undefined;
}

/** Apply one workspace op against an explicit owner. Shared by the wire
 *  endpoints (owner from auth) and the cross-owner seam (owner from body). */
function applyOp(
  res: Response,
  owner: { tenant: string; workspace: string },
  op: { kind: 'list'; prefix?: string }
    | { kind: 'get'; path: string }
    | { kind: 'put'; path: string; content: string; contentType?: string; ifMatch?: string }
    | { kind: 'delete'; path: string },
): void {
  const { tenant, workspace } = owner;
  switch (op.kind) {
    case 'list':
      res.status(200).json({ files: listWorkspaceFiles(tenant, workspace, op.prefix) });
      return;
    case 'get': {
      const file = getWorkspaceFile(tenant, workspace, op.path);
      if (!file) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(200).json(file);
      return;
    }
    case 'put': {
      const outcome = putWorkspaceFile(tenant, workspace, op.path, {
        content: op.content,
        ...(op.contentType !== undefined ? { contentType: op.contentType } : {}),
        ...(op.ifMatch !== undefined ? { ifMatch: op.ifMatch } : {}),
      });
      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error, details: outcome.details });
        return;
      }
      res.status(200).json(outcome.file);
      return;
    }
    case 'delete': {
      const existed = deleteWorkspaceFile(tenant, workspace, op.path);
      if (!existed) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.status(204).end();
      return;
    }
  }
}

export function registerWorkspaceRoutes(app: Express): void {
  app.get('/v1/host/workspace/files', (req, res) => {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
    applyOp(res, ownerOf(req), { kind: 'list', ...(prefix !== undefined ? { prefix } : {}) });
  });

  app.get('/v1/host/workspace/files/:path', (req, res) => {
    applyOp(res, ownerOf(req), { kind: 'get', path: req.params.path });
  });

  app.put('/v1/host/workspace/files/:path', (req, res) => {
    const body = (req.body ?? {}) as { content?: unknown; contentType?: unknown };
    if (typeof body.content !== 'string') {
      res.status(400).json({ error: 'validation_error', details: { message: 'content (string) required' } });
      return;
    }
    const im = ifMatch(req);
    applyOp(res, ownerOf(req), {
      kind: 'put',
      path: req.params.path,
      content: body.content,
      ...(typeof body.contentType === 'string' ? { contentType: body.contentType } : {}),
      ...(im !== undefined ? { ifMatch: im } : {}),
    });
  });

  app.delete('/v1/host/workspace/files/:path', (req, res) => {
    applyOp(res, ownerOf(req), { kind: 'delete', path: req.params.path });
  });

  log.info('workspace CRUD routes registered (RFC 0059 §C: /v1/host/workspace/files)');

  // RFC 0059 §E WCT-1 cross-owner seam — owner from the BODY so a single
  // conformance credential can drive distinct `{tenant, workspace}` pairs.
  // SECURITY: because the owner is caller-supplied (not the authenticated
  // identity), this seam bypasses the WCT-1 owner binding and MUST NOT be
  // exposed in production — it is gated on OPENWOP_TEST_SEAM_ENABLED (OFF by
  // default). The real CRUD endpoints above derive the owner from
  // req.tenantId and are always safe to expose. Vendor-namespaced under
  // /v1/host/sample/* per host-extensions.md.
  if (process.env.OPENWOP_TEST_SEAM_ENABLED !== 'true') {
    log.info('workspace cross-owner seam disabled (set OPENWOP_TEST_SEAM_ENABLED=true to enable)');
    return;
  }
  log.warn('workspace cross-owner seam ENABLED — /v1/host/sample/workspace/op accepts a body-supplied owner. NEVER enable in production.');
  app.post('/v1/host/sample/workspace/op', (req, res) => {
    const body = (req.body ?? {}) as {
      tenant?: unknown;
      workspace?: unknown;
      op?: unknown;
      path?: unknown;
      content?: unknown;
      contentType?: unknown;
      ifMatch?: unknown;
      prefix?: unknown;
    };
    if (typeof body.tenant !== 'string' || typeof body.workspace !== 'string') {
      res.status(400).json({ error: 'validation_error', details: { message: 'tenant + workspace required' } });
      return;
    }
    const owner = { tenant: body.tenant, workspace: body.workspace };
    const path = typeof body.path === 'string' ? body.path : '';
    switch (body.op) {
      case 'list':
        applyOp(res, owner, { kind: 'list', ...(typeof body.prefix === 'string' ? { prefix: body.prefix } : {}) });
        return;
      case 'get':
        applyOp(res, owner, { kind: 'get', path });
        return;
      case 'put':
        if (typeof body.content !== 'string') {
          res.status(400).json({ error: 'validation_error', details: { message: 'content required for put' } });
          return;
        }
        applyOp(res, owner, {
          kind: 'put',
          path,
          content: body.content,
          ...(typeof body.contentType === 'string' ? { contentType: body.contentType } : {}),
          ...(typeof body.ifMatch === 'string' ? { ifMatch: body.ifMatch } : {}),
        });
        return;
      case 'delete':
        applyOp(res, owner, { kind: 'delete', path });
        return;
      default:
        res.status(400).json({ error: 'validation_error', details: { message: 'op must be list|get|put|delete' } });
    }
  });
}
