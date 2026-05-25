/**
 * Notification inbox routes (PR #146, follow-up PR moves routes under
 * the sample-host vendor prefix per `host-extensions.md`).
 *
 *   GET    /v1/host/sample/notifications                — list for tenant
 *   GET    /v1/host/sample/notifications/stream         — SSE: live new
 *   POST   /v1/host/sample/notifications/:id/read       — mark read
 *   POST   /v1/host/sample/notifications/:id/unread     — mark unread
 *   POST   /v1/host/sample/notifications/:id/archive    — archive
 *   POST   /v1/host/sample/notifications:mark-all-read  — mark every unread row read
 *   DELETE /v1/host/sample/notifications/:id            — hard delete
 *
 * Vendor-prefixed because notifications are NOT a normative openwop v1
 * surface — only the openwop demo app uses them. Other hosts MAY add
 * their own under their own vendor prefix.
 *
 * Tenant scope is taken from `req.tenantId` (set by the auth middleware
 * from the OIDC bearer / session cookie). Wildcard `*` principals
 * (admin / conformance harness) can pass `?tenantId=foo` for explicit
 * filtering; otherwise they see the union (no filter).
 *
 * Every read/write that operates on a specific notification id MUST
 * call `assertTenantOwnership()` first so a leaked id can't be used
 * to mutate another tenant's row (regression: PR #146 only checked on
 * DELETE — `read`/`archive`/`unread` were missing the check).
 *
 * The list view defaults to "hide archived" — the Archived tab opts
 * back in via `?status=archived`.
 */

import type { Express, Request } from 'express';
import type { Storage } from '../storage/storage.js';
import {
  OpenwopError,
  type NotificationStatus,
  type NotificationRecord,
} from '../types.js';
import { getNotificationEmitter } from '../notifications/emitter.js';

const VALID_STATUSES: readonly NotificationStatus[] = ['unread', 'read', 'archived'];

const BASE = '/v1/host/sample/notifications';

interface Deps {
  storage: Storage;
}

export function registerNotificationRoutes(app: Express, deps: Deps): void {
  const { storage } = deps;

  app.get(BASE, async (req, res, next) => {
    try {
      const tenantId = resolveTenantFromReq(req);
      if (!tenantId) {
        // Non-wildcard caller without a resolved tenant: return empty
        // rather than 401 — list endpoints stay generous to anon visitors.
        res.json({ notifications: [] });
        return;
      }

      const status = parseStatusFilter(req.query.status);
      const includeArchived = req.query.includeArchived === 'true';
      const limit = Math.min(Number(req.query.limit) || 100, 500);

      const notifications = await storage.listNotifications({
        tenantId,
        ...(status ? { status } : {}),
        includeArchived,
        limit,
      });
      res.json({ notifications: notifications.map(projectNotification) });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/stream`, async (req, res, next) => {
    try {
      const tenantId = resolveTenantFromReq(req);

      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();

      // Heartbeat every 15s — same cadence as the runs-event stream so
      // proxies (Cloud Run, Cloudflare) don't drop the connection.
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);

      // Tenant filter: wildcard principals get everything; tenanted
      // principals get only their own rows. Anon (no tenant) gets
      // only heartbeats — they have nothing to notify yet, but the
      // stream stays open so a sign-in-mid-session reconnect works.
      const unsubscribe = getNotificationEmitter().subscribe((n) => {
        if (tenantId !== undefined && n.tenantId !== tenantId) return;
        res.write(`event: notification\n`);
        res.write(`data: ${JSON.stringify(projectNotification(n))}\n\n`);
      });

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/:id/read`, async (req, res, next) => {
    try {
      const updated = await mutateStatus(storage, req, req.params.id, 'read');
      res.json(projectNotification(updated));
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/:id/archive`, async (req, res, next) => {
    try {
      const updated = await mutateStatus(storage, req, req.params.id, 'archived');
      res.json(projectNotification(updated));
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/:id/unread`, async (req, res, next) => {
    try {
      const updated = await mutateStatus(storage, req, req.params.id, 'unread');
      res.json(projectNotification(updated));
    } catch (err) {
      next(err);
    }
  });

  // The `:mark-all-read` action is a sub-resource on the collection
  // itself — Express's literal `:` is legal inside a path segment but
  // route-pattern dispatchers vary, so pin via regex for safety.
  app.post(new RegExp(`^${BASE.replace(/\//g, '\\/')}:mark-all-read$`), async (req, res, next) => {
    try {
      const tenantId = resolveTenantFromReq(req);
      if (!tenantId) {
        res.json({ updated: 0 });
        return;
      }
      const updated = await storage.markAllNotificationsRead(tenantId, new Date().toISOString());
      res.json({ updated });
    } catch (err) {
      next(err);
    }
  });

  app.delete(`${BASE}/:id`, async (req, res, next) => {
    try {
      const existing = await storage.getNotification(req.params.id);
      if (!existing) throw new OpenwopError('not_found', `notification ${req.params.id} not found`, 404);
      assertTenantOwnership(req, existing);
      const removed = await storage.deleteNotification(req.params.id);
      res.json({ deleted: removed });
    } catch (err) {
      next(err);
    }
  });
}

/**
 * Centralized "load + auth + mutate" used by /read, /unread, /archive.
 *
 * Tenant ownership is enforced via `assertTenantOwnership` — a row
 * owned by another tenant is reported as 404 (not 403) so the route
 * doesn't leak whether the id exists.
 */
async function mutateStatus(
  storage: Storage,
  req: Request,
  notificationId: string,
  status: NotificationStatus,
): Promise<NotificationRecord> {
  const existing = await storage.getNotification(notificationId);
  if (!existing) throw new OpenwopError('not_found', `notification ${notificationId} not found`, 404);
  assertTenantOwnership(req, existing);
  const updated = await storage.updateNotificationStatus(
    notificationId,
    status,
    new Date().toISOString(),
  );
  if (!updated) throw new OpenwopError('not_found', `notification ${notificationId} not found`, 404);
  return updated;
}

function parseStatusFilter(raw: unknown): readonly NotificationStatus[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const invalid = parts.filter((p) => !(VALID_STATUSES as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new OpenwopError(
      'validation_error',
      `invalid status filter: ${invalid.join(', ')}`,
      400,
      { allowed: VALID_STATUSES },
    );
  }
  return parts as readonly NotificationStatus[];
}

function resolveTenantFromReq(req: Request): string | undefined {
  const tenants = req.principal?.tenants ?? [];
  const wildcard = tenants.includes('*');
  const requestedTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  return wildcard ? requestedTenant : (req.tenantId ?? undefined);
}

function assertTenantOwnership(req: Request, record: NotificationRecord): void {
  const tenants = req.principal?.tenants ?? [];
  if (tenants.includes('*')) return;
  if (req.tenantId && req.tenantId === record.tenantId) return;
  // Anon / mismatched tenant — pretend the row doesn't exist rather
  // than leaking a 403 that confirms its existence.
  throw new OpenwopError('not_found', 'notification not found', 404);
}

function projectNotification(record: NotificationRecord): Record<string, unknown> {
  return {
    notificationId: record.notificationId,
    type: record.type,
    priority: record.priority,
    status: record.status,
    title: record.title,
    message: record.message,
    runId: record.runId,
    workflowId: record.workflowId,
    nodeId: record.nodeId,
    interruptId: record.interruptId,
    actionUrl: record.actionUrl,
    metadata: record.metadata,
    createdAt: record.createdAt,
    readAt: record.readAt,
    archivedAt: record.archivedAt,
  };
}
