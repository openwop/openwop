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
import { buildHostSurfaceBundle, resolvePresignToken } from '../host/inMemorySurfaces.js';
import type { HostSurfaceBundle, SurfaceArgs, SurfaceFn } from '../host/inMemorySurfaces.js';
import { acceptEnvelope, type AcceptOptions } from '../host/envelopeAcceptor.js';
import type { Storage } from '../storage/storage.js';
import type { EnvelopeOutcome } from '../host/envelopeAcceptor.js';
import { projectOutcome } from '../host/envelopeProjection.js';
import { listTestEvents, resetTestEventLog } from '../host/envelopeEventLog.js';
import { listTestSpans, resetTestSpanBuffer } from '../observability/spanBuffer.js';
import {
  setCapabilityOverlay,
  resetCapabilityOverlay,
  snapshotCapabilityOverlay,
} from '../host/capabilityOverlay.js';
import { computeLLMCacheKey } from '../providers/llmCacheKey.js';
import { OpenwopError } from '../types.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.testSeam');

interface SeamBody {
  tenantId?: string;
  surface?: string;
  op?: string;
  args?: Record<string, unknown>;
}

const SURFACES = ['kv', 'table', 'cache', 'blob', 'queueBus', 'sql', 'vector', 'search', 'fs'] as const;
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
    case 'search': return bundle.db.search;
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

export function registerTestSeamRoutes(app: Express, deps: { storage: Storage }): void {
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
      /** RFC 0021 §"Redaction" + `agent-memory.md` §SR-1 — canonical SR-1
       *  shape is `{ value, secretId }`. The seam validates each entry has
       *  both fields before passing to the acceptor; entries with empty
       *  `value` are dropped. */
      byokCanaries?: Array<{ value: string; secretId: string }>;
      /** When supplied, projects the outcome onto a test-only run event
       *  log (`envelopeEventLog.ts`) so the conformance suite can query
       *  the spec-prescribed events (cap.breached, node.failed,
       *  interrupt.requested, log.appended) via
       *  `GET /v1/host/sample/test/runs/:runId/events`. RFC 0021 §A point
       *  1-7 + interrupt.md + capabilities.md §"cap.breached". */
      projectTo?: {
        runId: string;
        nodeId?: string;
        refusalMode?: 'fail-node' | 'discard-and-warn';
      };
      /** Persisted dedup-state seam — backs the cross-process replay
       *  contract from `ai-envelope.md §"Replay determinism"`. When set,
       *  the acceptor's priorCorrelations is seeded from the
       *  `envelope_correlations` storage table (keyed by runId), so a
       *  fresh process (or any caller without an in-memory map) gets
       *  the SAME cached outcome it would have gotten from the
       *  original process's in-memory priorCorrelations. After accept,
       *  the resulting outcome is persisted so subsequent re-emissions
       *  read it back. Combine with `priorCorrelations` to override
       *  per-call; persisted entries win on collision with explicit
       *  entries (the persisted store is the cross-process source of
       *  truth). */
      persistedDedup?: { runId: string };
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
      // Drop entries missing either field — keeps the acceptor's
      // [REDACTED:<secretId>] substitution deterministic.
      const canaries = body.byokCanaries.filter(
        (c): c is { value: string; secretId: string } =>
          typeof c?.value === 'string' && c.value.length > 0 && typeof c?.secretId === 'string' && c.secretId.length > 0,
      );
      if (canaries.length > 0) opts.byokCanaries = canaries;
    }
    const dedupMap = new Map<string, { outcome: EnvelopeOutcome; envelopeType: string }>();
    if (Array.isArray(body.priorCorrelations) && body.priorCorrelations.length > 0) {
      for (const e of body.priorCorrelations) {
        if (typeof e?.correlationId === 'string' && typeof e?.envelopeType === 'string') {
          dedupMap.set(e.correlationId, {
            outcome: e.outcome as EnvelopeOutcome,
            envelopeType: e.envelopeType,
          });
        }
      }
    }
    // Persisted dedup seam: if a runId is supplied AND the inbound
    // envelope carries a correlationId, consult the persisted store
    // and merge any cached outcome into the dedup map (overriding any
    // explicit entry for the same correlationId — the persisted store
    // is authoritative for cross-process semantics).
    const inboundCorrelationId =
      body.envelope && typeof body.envelope === 'object' &&
      typeof (body.envelope as { correlationId?: unknown }).correlationId === 'string'
        ? (body.envelope as { correlationId: string }).correlationId
        : null;
    if (body.persistedDedup?.runId && inboundCorrelationId) {
      const persisted = await deps.storage.getEnvelopeCorrelation(
        body.persistedDedup.runId,
        inboundCorrelationId,
      );
      if (persisted) {
        dedupMap.set(inboundCorrelationId, {
          outcome: persisted.outcome as EnvelopeOutcome,
          envelopeType: persisted.envelopeType,
        });
      }
    }
    if (dedupMap.size > 0) opts.priorCorrelations = dedupMap;

    const outcome = acceptEnvelope(body.envelope, opts);

    // Persist the outcome for future cross-process re-emissions. Only
    // persist when the caller supplied persistedDedup AND the inbound
    // envelope carried a correlationId AND the cache didn't already
    // serve this call (re-persisting an already-cached outcome would
    // bump recordedAt for no reason — semantically the same record).
    if (
      body.persistedDedup?.runId &&
      inboundCorrelationId &&
      !dedupMap.has(inboundCorrelationId)
    ) {
      const envType =
        body.envelope && typeof body.envelope === 'object' &&
        typeof (body.envelope as { type?: unknown }).type === 'string'
          ? (body.envelope as { type: string }).type
          : 'unknown';
      await deps.storage.putEnvelopeCorrelation(
        body.persistedDedup.runId,
        inboundCorrelationId,
        outcome,
        envType,
        new Date().toISOString(),
      );
    }
    // Optional E.1 projection: emit the spec-prescribed events into the
    // test event log so conformance can query them via /test/runs/:runId/events.
    if (body.projectTo && typeof body.projectTo.runId === 'string') {
      const env = (body.envelope ?? {}) as { type?: string; correlationId?: string; schemaVersion?: number };
      if (typeof env.type === 'string' && typeof env.correlationId === 'string') {
        const driftFloor = body.schemaVersionFloor?.[env.type];
        projectOutcome(outcome, {
          runId: body.projectTo.runId,
          correlationId: env.correlationId,
          envelopeType: env.type,
          ...(typeof env.schemaVersion === 'number' ? { envelopeSchemaVersion: env.schemaVersion } : {}),
          ...(typeof driftFloor === 'number' ? { driftFloor } : {}),
          ...(body.projectTo.nodeId !== undefined ? { nodeId: body.projectTo.nodeId } : {}),
          ...(body.projectTo.refusalMode !== undefined ? { refusalMode: body.projectTo.refusalMode } : {}),
        });
      }
    }
    res.status(200).json(outcome);
  });

  // E.1 — event-log query seam. Returns the test-only run event log
  // populated by `envelope/accept` with `projectTo`. Supports filtering
  // by type / causationId / correlationId (= causationId) / nodeId.
  app.get('/v1/host/sample/test/runs/:runId/events', (req, res) => {
    const runId = req.params.runId;
    if (!runId) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'runId required' } });
      return;
    }
    const filter: { type?: string; correlationId?: string; causationId?: string; nodeId?: string } = {};
    const q = req.query as Record<string, string | undefined>;
    if (typeof q.type === 'string') filter.type = q.type;
    if (typeof q.correlationId === 'string') filter.correlationId = q.correlationId;
    if (typeof q.causationId === 'string') filter.causationId = q.causationId;
    if (typeof q.nodeId === 'string') filter.nodeId = q.nodeId;
    res.status(200).json({ events: listTestEvents(runId, filter) });
  });

  // Reset the test event log + capability overlay + OTel span buffer (suite teardown).
  app.post('/v1/host/sample/test/reset', (_req, res) => {
    resetTestEventLog();
    resetCapabilityOverlay();
    resetTestSpanBuffer();
    res.status(200).json({ ok: true });
  });

  // E.2 — OTel scrape seam. Returns the test-only span buffer populated
  // by `envelopeProjection.ts` so conformance scenarios can assert
  // attribute redaction (canary absent) + drift attrs.
  app.get('/v1/host/sample/test/otel/spans', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const filter: { envelopeId?: string; runId?: string; name?: string } = {};
    if (typeof q.envelopeId === 'string') filter.envelopeId = q.envelopeId;
    if (typeof q.runId === 'string') filter.runId = q.runId;
    if (typeof q.name === 'string') filter.name = q.name;
    res.status(200).json({ spans: listTestSpans(filter) });
  });

  // E.3 — Debug-bundle export seam. Bundles the run's events + spans
  // into a single payload mirroring what a production host's debug-
  // bundle export endpoint would return. Lets conformance assert the
  // bundle contains no BYOK canary plaintext (SR-1 carry-forward across
  // the debug-bundle surface).
  app.post('/v1/host/sample/test/debug-bundle/export', (req, res) => {
    const body = (req.body ?? {}) as { runId?: string };
    if (typeof body.runId !== 'string' || body.runId.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'runId required' } });
      return;
    }
    res.status(200).json({
      bundle: {
        runId: body.runId,
        events: listTestEvents(body.runId),
        spans: listTestSpans({ runId: body.runId }),
        exportedAt: new Date().toISOString(),
      },
    });
  });

  // Presigned-URL resolver — RFC 0019 §B point 1. The blob surface's
  // `presign` issues opaque tokens (registered in inMemorySurfaces'
  // `_blobPresignTokens` map); this route resolves them, returning the
  // payload as raw bytes inside the TTL window and 403 after expiry.
  app.get('/v1/host/sample/blob/presigned/:token', (req, res) => {
    const token = decodeURIComponent(req.params.token ?? '');
    const result = resolvePresignToken(token);
    if (!result.ok && result.reason === 'not_found') {
      res.status(404).json({ error: { code: 'blob_presign_not_found', message: 'unknown presign token' } });
      return;
    }
    if (!result.ok && result.reason === 'expired') {
      res.status(403).json({ error: { code: 'blob_presign_expired', message: 'presign token past its TTL' } });
      return;
    }
    if (!result.ok) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'unexpected presign result' } });
      return;
    }
    const { entry } = result;
    res.status(200);
    res.setHeader('Content-Type', entry.contentType ?? 'application/octet-stream');
    res.send(Buffer.from(entry.contentBase64, 'base64'));
  });

  // RFC 0026 — provider.usage event emission seam.
  // POST /v1/host/sample/test/emit-provider-usage
  // Body: { runId, payload: ProviderUsagePayload, correlationId?, nodeId? }
  // Synthesizes the event into the test event log; conformance scenarios
  // query it via the E.1 event-log seam to verify shape.
  app.post('/v1/host/sample/test/emit-provider-usage', async (req, res) => {
    const body = (req.body ?? {}) as { runId?: string; payload?: Record<string, unknown>; correlationId?: string; nodeId?: string };
    if (typeof body.runId !== 'string' || body.runId.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'runId required' } });
      return;
    }
    const payload = body.payload;
    if (!payload || typeof payload !== 'object' || typeof payload.provider !== 'string' || typeof payload.model !== 'string' || typeof payload.inputTokens !== 'number' || typeof payload.outputTokens !== 'number') {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'payload MUST be { provider, model, inputTokens, outputTokens } per RFC 0026 §A' } });
      return;
    }
    // Defense-in-depth: refuse payloads that look like they could carry a
    // credentialRef (`credentialRef` field literally OR a value containing
    // 'secret:' which is the openwop credential-ref prefix). This enforces
    // the `provider-usage-no-credential-leak` SECURITY invariant at the
    // seam layer; downstream emitters MUST sanitize further per RFC 0026 §D.
    const serialized = JSON.stringify(payload);
    if (serialized.includes('credentialRef') || serialized.includes('"secret:')) {
      res.status(400).json({ error: { code: 'provider_usage_credential_leak', message: 'payload contains credentialRef-shaped content; RFC 0026 §D + SECURITY/invariants.yaml provider-usage-no-credential-leak' } });
      return;
    }
    // Project to the test event log via the projection seam's append helper.
    const { appendTestEvent } = await import('../host/envelopeEventLog.js');
    const event = appendTestEvent({
      runId: body.runId,
      type: 'provider.usage',
      payload: payload as Record<string, unknown>,
      ...(typeof body.correlationId === 'string' ? { causationId: body.correlationId } : {}),
      ...(typeof body.nodeId === 'string' ? { nodeId: body.nodeId } : {}),
    });
    res.status(200).json({ event });
  });

  // LLM cache-key recipe seam — replay.md §"LLM cache-key recipe".
  // POST /v1/host/sample/test/llm-cache-key
  // Body: an LLMCacheKeyInput-shaped object (extra fields ignored per §A).
  // Response: { cacheKey: <lowercase-hex SHA-256> }
  app.post('/v1/host/sample/test/llm-cache-key', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.provider !== 'string' || typeof body.model !== 'string' || !Array.isArray(body.messages)) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'provider + model + messages[] required per replay.md §A' } });
      return;
    }
    res.status(200).json({ cacheKey: computeLLMCacheKey(body) });
  });

  // Capability-toggle test seam (RFC 0022 §C refusal-case tests).
  // POST /v1/host/sample/test/capability-toggle
  // Body shapes:
  //   { name: 'agents.dispatchMapping', value: false }   // set overlay
  //   { name: 'agents.dispatchMapping', value: null }    // remove overlay (restore default)
  //   { reset: true }                                    // clear ALL overlay entries
  // Response: { overlay: <current overlay snapshot> }
  app.post('/v1/host/sample/test/capability-toggle', (req, res) => {
    const body = (req.body ?? {}) as { name?: unknown; value?: unknown; reset?: unknown };
    if (body.reset === true) {
      resetCapabilityOverlay();
      res.status(200).json({ overlay: snapshotCapabilityOverlay(), reset: true });
      return;
    }
    if (typeof body.name !== 'string' || body.name.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'name required when reset:false' } });
      return;
    }
    let value: boolean | undefined;
    if (body.value === null) value = undefined;
    else if (typeof body.value === 'boolean') value = body.value;
    else {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'value MUST be boolean | null' } });
      return;
    }
    setCapabilityOverlay(body.name, value);
    res.status(200).json({ overlay: snapshotCapabilityOverlay(), set: { name: body.name, value: value ?? null } });
  });
}
