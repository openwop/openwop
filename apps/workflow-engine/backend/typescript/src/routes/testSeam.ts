/**
 * Test seam — env-gated dispatch endpoint for the conformance suite to
 * exercise in-memory host surfaces with explicit tenant control.
 *
 * Gated on `OPENWOP_TEST_SEAM_ENABLED=true`. The seam is OFF by default
 * so production deploys can't accidentally expose it. CI / conformance
 * runs flip it on, drive cross-tenant + atomicity + injection-rejection
 * proofs through it, then read typed results back.
 *
 * Namespace: `/v1/host/sample/test/*` per `spec/v1/host-extensions.md`
 * §"Canonical prefixes" — sample-vendor-namespaced. NOT part of the
 * openwop wire contract; conformance scenarios that depend on this seam
 * soft-skip on hosts that don't expose it (404).
 *
 * Two-tenant model:
 *   The seam accepts `tenantId` in each request body. The bearer-authed
 *   conformance harness can issue requests under any tenant id; the
 *   surface bundle is scoped per-call. This lets a single test file
 *   prove cross-tenant isolation without juggling multiple bearer tokens.
 *
 * Endpoint shape:
 *   POST /v1/host/sample/test/surface
 *   body: {
 *     tenantId: string,                // e.g. 'tenant-a' / 'tenant-b'
 *     surface: 'kv' | 'table' | 'cache' | 'blob' | 'queueBus' | 'sql' | 'vector' | 'fs',
 *     op: string,                       // e.g. 'set', 'get', 'increment', 'cas', 'publish', 'consume', ...
 *     args: object                      // op-specific
 *   }
 *
 * Response is the raw surface call result, OR a 4xx envelope when the
 * surface rejects (e.g., path traversal, sql injection).
 *
 * @see SECURITY/invariants.yaml — kv-cross-tenant-isolation,
 *                                   queue-cross-tenant-isolation,
 *                                   sql-parametric-only, fs-path-traversal
 */

import type { Express } from 'express';
import { buildHostSurfaceBundle } from '../host/inMemorySurfaces.js';
import { OpenwopError } from '../types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.testSeam');

interface SeamBody {
  tenantId?: string;
  surface?: string;
  op?: string;
  args?: Record<string, unknown>;
}

const VALID_SURFACES = new Set(['kv', 'table', 'cache', 'blob', 'queueBus', 'sql', 'vector', 'fs']);

export function registerTestSeamRoutes(app: Express): void {
  if (process.env.OPENWOP_TEST_SEAM_ENABLED !== 'true') {
    log.info('test seam disabled (set OPENWOP_TEST_SEAM_ENABLED=true to enable)');
    return;
  }
  log.warn('test seam ENABLED — /v1/host/sample/test/surface is reachable. NEVER enable in production.');

  app.post('/v1/host/sample/test/surface', async (req, res) => {
    const body = (req.body ?? {}) as SeamBody;
    if (typeof body.tenantId !== 'string' || body.tenantId.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'tenantId required' });
      return;
    }
    if (typeof body.surface !== 'string' || !VALID_SURFACES.has(body.surface)) {
      res.status(400).json({
        error: 'invalid_argument',
        message: `surface must be one of {${[...VALID_SURFACES].join(', ')}}`,
      });
      return;
    }
    if (typeof body.op !== 'string' || body.op.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'op required' });
      return;
    }
    const args = body.args && typeof body.args === 'object' ? body.args : {};

    let bundle;
    try {
      bundle = buildHostSurfaceBundle({ tenantId: body.tenantId });
    } catch (err) {
      res.status(503).json({
        error: 'host_capability_missing',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    type SurfaceMethod = (args: Record<string, unknown>) => Promise<unknown> | unknown;
    const dispatch: Record<string, Record<string, SurfaceMethod>> = {
      kv: bundle.storage.kv as unknown as Record<string, SurfaceMethod>,
      table: bundle.storage.table as unknown as Record<string, SurfaceMethod>,
      cache: bundle.storage.cache as unknown as Record<string, SurfaceMethod>,
      blob: bundle.storage.blob as unknown as Record<string, SurfaceMethod>,
      queueBus: bundle.queueBus as unknown as Record<string, SurfaceMethod>,
      sql: bundle.db.sql as unknown as Record<string, SurfaceMethod>,
      vector: bundle.db.vector as unknown as Record<string, SurfaceMethod>,
      fs: bundle.fs as unknown as Record<string, SurfaceMethod>,
    };

    const surface = dispatch[body.surface];
    if (!surface) {
      res.status(503).json({ error: 'host_capability_missing', message: `surface ${body.surface} not wired` });
      return;
    }
    const method = surface[body.op];
    if (typeof method !== 'function') {
      res.status(400).json({
        error: 'invalid_argument',
        message: `op '${body.op}' not implemented on surface '${body.surface}'`,
      });
      return;
    }

    try {
      const result = await method(args);
      res.status(200).json(result ?? null);
    } catch (err) {
      if (err instanceof OpenwopError) {
        res.status(err.httpStatus ?? 400).json({ error: err.code, message: err.message });
        return;
      }
      const code = (err as { code?: string })?.code;
      const message = err instanceof Error ? err.message : String(err);
      // Map host-side error codes to 4xx for the conformance suite.
      res.status(400).json({ error: { code: code ?? 'internal_error', message } });
    }
  });

  // Optional convenience endpoint mirrors the fs.read shape the
  // fs-path-traversal scenario already probes. Keeps that older
  // scenario backward-compatible without forcing it to know about the
  // surface-dispatch endpoint.
  app.post('/v1/host/sample/fs/read', async (req, res) => {
    const body = (req.body ?? {}) as { path?: string; tenantId?: string };
    if (typeof body.path !== 'string' || body.path.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'path required' } });
      return;
    }
    const tenant = body.tenantId ?? 'tenant-a';
    try {
      const bundle = buildHostSurfaceBundle({ tenantId: tenant });
      const result = await bundle.fs.read({ path: body.path });
      res.status(200).json(result ?? null);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: { code: code ?? 'internal_error', message } });
    }
  });
}
