/**
 * Host-extension read routes for the demo MemoryAdapter (RFC 0004).
 *
 *   GET    /v1/host/sample/memory[?memoryRef=&tag=&limit=]  → { memoryRef, entries }
 *   GET    /v1/host/sample/memory/:memoryId[?memoryRef=]    → { memoryRef, entry }
 *   DELETE /v1/host/sample/memory/:memoryId[?memoryRef=]    → { memoryRef, memoryId, removed }
 *
 * Reads are per the agent-memory.md wire contract (host-internal writes — the
 * executor writes a run-summary on completion). DELETE is a demo-only host
 * convenience (it is NOT part of the normative agent-memory wire contract) that
 * backs `openwop memory delete` and the frontend inspector.
 * Tenant-scoped from `req.tenantId` (the auth middleware), never the
 * query/body, per the CTI-1 cross-tenant isolation invariant.
 */

import type { Express } from 'express';
import { getMemoryEntry, listMemoryEntries, removeMemoryEntry, MEMORY_DEMO_REF } from '../host/inMemorySurfaces.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.memory');

function resolveRef(raw: unknown): string {
  return typeof raw === 'string' && raw.length > 0 ? raw : MEMORY_DEMO_REF;
}

export function registerMemoryRoutes(app: Express): void {
  // authMiddleware() (global) rejects unauthenticated callers before these
  // handlers run; the path isn't in PUBLIC_PATH_PREFIXES. Tenant is resolved
  // exactly as run-create does (`req.tenantId ?? 'default'`) so the ledger
  // scopes to the same tenant the run wrote under. Never read tenant from the
  // query (CTI-1).
  app.get('/v1/host/sample/memory', (req, res) => {
    const tenantId = req.tenantId ?? 'default';
    const memoryRef = resolveRef(req.query.memoryRef);
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    const limRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(limRaw) && limRaw > 0 ? Math.floor(limRaw) : undefined;
    const entries = listMemoryEntries(tenantId, memoryRef, {
      ...(tag ? { tag } : {}),
      ...(limit ? { limit } : {}),
    });
    res.status(200).json({ memoryRef, entries });
  });

  app.get('/v1/host/sample/memory/:memoryId', (req, res) => {
    const tenantId = req.tenantId ?? 'default';
    const memoryRef = resolveRef(req.query.memoryRef);
    const entry = getMemoryEntry(tenantId, memoryRef, req.params.memoryId);
    if (!entry) {
      res.status(404).json({ error: 'not_found', message: 'memory entry not found' });
      return;
    }
    res.status(200).json({ memoryRef, entry });
  });

  app.delete('/v1/host/sample/memory/:memoryId', (req, res) => {
    const tenantId = req.tenantId ?? 'default';
    const memoryRef = resolveRef(req.query.memoryRef);
    const removed = removeMemoryEntry(tenantId, memoryRef, req.params.memoryId);
    if (!removed) {
      res.status(404).json({ error: 'not_found', message: 'memory entry not found' });
      return;
    }
    res.status(200).json({ memoryRef, memoryId: req.params.memoryId, removed: true });
  });

  log.info('memory read routes registered (GET /v1/host/sample/memory)');
}
