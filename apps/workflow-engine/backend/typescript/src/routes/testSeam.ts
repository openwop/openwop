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
import type { HostSurfaceBundle, SurfaceArgs, SurfaceFn } from '../host/inMemorySurfaces.js';
import { acceptEnvelope, type AcceptOptions } from '../host/envelopeAcceptor.js';
import { OpenwopError } from '../types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.testSeam');

interface SeamBody {
  tenantId?: string;
  surface?: string;
  op?: string;
  args?: Record<string, unknown>;
}

const SURFACES = ['kv', 'table', 'cache', 'blob', 'queueBus', 'sql', 'vector', 'fs'] as const;
type SurfaceName = (typeof SURFACES)[number];

function isSurfaceName(s: string): s is SurfaceName {
  return (SURFACES as readonly string[]).includes(s);
}

/** Map the requested surface name to its typed instance on the bundle.
 *  Each branch returns the surface as an `object` so the caller can do a
 *  string-keyed method lookup without double-casting through `unknown`. */
function selectSurface(bundle: HostSurfaceBundle, name: SurfaceName): object {
  switch (name) {
    case 'kv': return bundle.storage.kv;
    case 'table': return bundle.storage.table;
    case 'cache': return bundle.storage.cache;
    case 'blob': return bundle.storage.blob;
    case 'queueBus': return bundle.queueBus;
    case 'sql': return bundle.db.sql;
    case 'vector': return bundle.db.vector;
    case 'fs': return bundle.fs;
  }
}

/** Resolve `op` against a surface using a single-cast string-keyed lookup.
 *  Returns the typed `SurfaceFn` if `op` resolves to a function, else
 *  undefined. The in-memory surface factories use closures over their
 *  tenant scope (see `createKv` et al.), so no `this`-binding is needed. */
function lookupMethod(surface: object, op: string): SurfaceFn | undefined {
  const candidate = (surface as Record<string, unknown>)[op];
  return typeof candidate === 'function' ? (candidate as SurfaceFn) : undefined;
}

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
    if (typeof body.surface !== 'string' || !isSurfaceName(body.surface)) {
      res.status(400).json({
        error: 'invalid_argument',
        message: `surface must be one of {${SURFACES.join(', ')}}`,
      });
      return;
    }
    if (typeof body.op !== 'string' || body.op.length === 0) {
      res.status(400).json({ error: 'invalid_argument', message: 'op required' });
      return;
    }
    const args: SurfaceArgs = body.args && typeof body.args === 'object' ? body.args : {};

    let bundle: HostSurfaceBundle;
    try {
      bundle = buildHostSurfaceBundle({ tenantId: body.tenantId });
    } catch (err) {
      res.status(503).json({
        error: 'host_capability_missing',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const surface = selectSurface(bundle, body.surface);
    const method = lookupMethod(surface, body.op);
    if (!method) {
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

  // RFC 0021 §A — AIEnvelopeAcceptor reference implementation. The
  // conformance suite POSTs candidate envelopes here and asserts the
  // EnvelopeOutcome shape (accepted / invalid / gated / breached).
  // Closes the spec-to-impl loop for RFC 0021: the host now actually
  // runs the Ajv2020 gate that the spec section §A point 1-3 demands.
  app.post('/v1/host/sample/envelope/accept', async (req, res) => {
    const body = (req.body ?? {}) as {
      envelope?: unknown;
      hostSupportedEnvelopes?: string[];
      nodeAllowedKinds?: string[];
      runTrustBoundary?: 'trusted' | 'untrusted';
      counters?: AcceptOptions['counters'];
      schemaVersionFloor?: Record<string, number>;
      envelopeStrictness?: 'warn' | 'strict';
      /** Wire shape: `priorCorrelations` is a flat array on the JSON wire so
       *  the conformance harness can ship it as plain JSON without serializing
       *  a Map. The acceptor consumes a ReadonlyMap; we adapt here. */
      priorCorrelations?: Array<{ correlationId: string; outcome: unknown; envelopeType: string }>;
      byokCanaries?: string[];
    };
    if (body.envelope === undefined) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'envelope required' } });
      return;
    }
    const opts: AcceptOptions = {};
    if (body.hostSupportedEnvelopes !== undefined) opts.hostSupportedEnvelopes = body.hostSupportedEnvelopes;
    if (body.nodeAllowedKinds !== undefined) opts.nodeAllowedKinds = body.nodeAllowedKinds;
    if (body.runTrustBoundary !== undefined) opts.runTrustBoundary = body.runTrustBoundary;
    if (body.counters !== undefined) opts.counters = body.counters;
    if (body.schemaVersionFloor !== undefined) opts.schemaVersionFloor = body.schemaVersionFloor;
    if (body.envelopeStrictness !== undefined) opts.envelopeStrictness = body.envelopeStrictness;
    if (Array.isArray(body.byokCanaries) && body.byokCanaries.length > 0) {
      opts.byokCanaries = body.byokCanaries;
    }
    if (Array.isArray(body.priorCorrelations) && body.priorCorrelations.length > 0) {
      const map = new Map<string, { outcome: import('../host/envelopeAcceptor.js').EnvelopeOutcome; envelopeType: string }>();
      for (const e of body.priorCorrelations) {
        if (typeof e?.correlationId === 'string' && typeof e?.envelopeType === 'string') {
          map.set(e.correlationId, {
            outcome: e.outcome as import('../host/envelopeAcceptor.js').EnvelopeOutcome,
            envelopeType: e.envelopeType,
          });
        }
      }
      opts.priorCorrelations = map;
    }
    const outcome = acceptEnvelope(body.envelope, opts);
    res.status(200).json(outcome);
  });
}
