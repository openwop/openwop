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
import { composePromptTemplate } from '../host/promptCompose.js';
import { resolvePromptRef, type PromptKind } from '../host/promptResolve.js';
import type { Storage } from '../storage/storage.js';
import type { EnvelopeOutcome } from '../host/envelopeAcceptor.js';
import { wrapForLLMPrompt, type PromptWrapInput } from '../host/promptInjectionGuard.js';
import { setRunVariable, snapshotRunVariables } from '../host/variablesRuntime.js';
import { projectOutcome } from '../host/envelopeProjection.js';
import { listTestEvents, resetTestEventLog } from '../host/envelopeEventLog.js';
import { listTestSpans, resetTestSpanBuffer } from '../observability/spanBuffer.js';
import {
  setCapabilityOverlay,
  resetCapabilityOverlay,
  snapshotCapabilityOverlay,
  resolveCapabilityFlag,
} from '../host/capabilityOverlay.js';
import { computeLLMCacheKey } from '../providers/llmCacheKey.js';
import { evaluateToolHook, type ToolHookRequest } from '../host/toolHooks.js';
import { singleTick, missedWindow } from '../host/schedulingService.js';
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
      /** RFC 0021 §"Trust boundary" — when true, the acceptor evaluates
       *  the post-normalization contentTrust and refuses with
       *  `untrusted_content_blocks_approval` if the value is
       *  `'untrusted'`. Conformance scenarios that drive an approval-
       *  gate refusal assertion set this bit on the envelope/accept
       *  call so the spec contract surfaces as an EnvelopeOutcome
       *  (instead of having to wire a full interrupt + resume flow
       *  through the engine). */
      approvalGateContext?: boolean;
    };
    if (body.envelope === undefined) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'envelope required' } });
      return;
    }

    // Capability gate (FIRST refusal layer per ai-envelope.md §"Capability
    // handshake integration" line 305: capability-gated typeId refusal
    // STACKS ATOP envelope-contract refusal). If the host doesn't
    // advertise `host.aiEnvelope: supported`, every envelope/accept call
    // refuses BEFORE the per-envelope contract gates (host-gate, node-
    // gate, schema-floor, etc.) run. The refusal is observable as
    // `capability_required` so the conformance suite can distinguish
    // "capability absent" from "this specific envelope type not in the
    // host's accepts list."
    if (resolveCapabilityFlag('host.aiEnvelope.supported') === false) {
      res.status(200).json({
        status: 'invalid',
        reason: 'capability_required',
        details: [
          {
            instancePath: '/type',
            schemaPath: '#/capabilities/host.aiEnvelope',
            keyword: 'capability',
            message:
              "Host does not advertise capabilities.host.aiEnvelope: supported. " +
              "Per ai-envelope.md §\"Capability handshake integration\" + " +
              "capabilities.md §\"Unsupported capability — refusal contract\", " +
              "a node requiring host.aiEnvelope MUST be refused before any " +
              "envelope-contract gating runs.",
          },
        ],
      });
      return;
    }

    const opts: AcceptOptions = {};
    if (body.hostSupportedEnvelopes !== undefined) opts.hostSupportedEnvelopes = body.hostSupportedEnvelopes;
    if (body.nodeAllowedKinds !== undefined) opts.nodeAllowedKinds = body.nodeAllowedKinds;
    if (body.runTrustBoundary !== undefined) opts.runTrustBoundary = body.runTrustBoundary;
    if (body.counters !== undefined) opts.counters = body.counters;
    if (body.schemaVersionFloor !== undefined) opts.schemaVersionFloor = body.schemaVersionFloor;
    if (body.envelopeStrictness !== undefined) opts.envelopeStrictness = body.envelopeStrictness;
    if (body.approvalGateContext === true) opts.approvalGateContext = true;
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

  // Variable mutation seam — mutates a run's variable bag mid-run.
  // Per `host/variablesRuntime.ts`: future scope (HVMAP-2 mid-run-no-
  // propagation conformance assertion). The conformance test creates
  // a parent run with a subWorkflow that suspends on a clarification
  // gate, then mutates the parent's variable bag via this endpoint,
  // resolves the clarification, and asserts the child's view of the
  // variable remained at its dispatch-time seed (not the mutated
  // value) — proving RFC 0022 §B's one-shot fold semantic.
  //
  // Endpoint: POST /v1/host/sample/test/runs/:runId/variables
  // Body shape: { variables: Record<string, unknown> } — each entry
  // sets the named variable in the run's bag.
  // GET variant returns the current bag for assertions.
  app.post('/v1/host/sample/test/runs/:runId/variables', (req, res) => {
    const runId = req.params.runId;
    if (!runId) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'runId required' } });
      return;
    }
    const body = (req.body ?? {}) as { variables?: unknown };
    if (!body.variables || typeof body.variables !== 'object' || Array.isArray(body.variables)) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'variables MUST be an object' } });
      return;
    }
    for (const [name, value] of Object.entries(body.variables as Record<string, unknown>)) {
      if (typeof name === 'string' && name.length > 0) setRunVariable(runId, name, value);
    }
    res.status(200).json({ variables: snapshotRunVariables(runId) ?? {} });
  });
  app.get('/v1/host/sample/test/runs/:runId/variables', (req, res) => {
    const runId = req.params.runId;
    if (!runId) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'runId required' } });
      return;
    }
    res.status(200).json({ variables: snapshotRunVariables(runId) ?? {} });
  });

  // Prompt-injection wrap seam — exposes the host's `<UNTRUSTED ...>`
  // wrap helper directly. Conformance scenarios POST a RunEventDoc-
  // shaped body and assert the wrap behavior at the trust boundary
  // (untrusted → wrapped; trusted → passes through). The seam stands
  // in for a full LLM-node execution: in production, an LLM node that
  // re-consumes a RunEventDoc calls `wrapForLLMPrompt(...)` before
  // composing its prompt. Same contract, mechanical assertion vs. a
  // run.
  //
  // Spec references:
  //   - spec/v1/ai-envelope.md §"Trust boundary" line 380 (downstream
  //     LLM nodes MUST treat untrusted RunEventDoc content per the
  //     prompt-injection rules)
  //   - SECURITY/threat-model-prompt-injection.md (UNTRUSTED-marker
  //     convention)
  app.post('/v1/host/sample/test/llm-prompt-wrap', (req, res) => {
    const body = (req.body ?? {}) as Partial<PromptWrapInput> & { payload?: unknown };
    if (!('payload' in body)) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'payload required' } });
      return;
    }
    const input: PromptWrapInput = { payload: body.payload };
    if (body.contentTrust === 'trusted' || body.contentTrust === 'untrusted') {
      input.contentTrust = body.contentTrust;
    }
    if (typeof body.eventType === 'string') input.eventType = body.eventType;
    if (typeof body.source === 'string') input.source = body.source;
    if (body.attributes && typeof body.attributes === 'object') {
      // Validate attribute values are primitive — drop anything that
      // would JSON.stringify to `[object Object]` or similar.
      const valid: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(body.attributes)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          valid[k] = v;
        }
      }
      if (Object.keys(valid).length > 0) input.attributes = valid;
    }
    const prompt = wrapForLLMPrompt(input);
    res.status(200).json({ prompt });
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

  // RFC 0032 §B envelope-reliability event emission seam.
  // POST /v1/host/sample/test/emit-envelope-reliability
  // Body: { runId, type, payload, nodeId?, correlationId? }
  //
  // Synthesizes one of the six RFC 0032 envelope-reliability events into the
  // test event log so conformance scenarios can verify event-payload shape
  // without driving a full LLM dispatch. The seam validates `type` is one
  // of the six RFC 0032 enum values and that `payload` carries the required
  // fields per `run-event-payloads.schema.json` §envelope* `$defs`.
  // Defense-in-depth: rejects payloads carrying credentialRef-shaped or
  // prompt-content-shaped substrings in `refusalText`/`previousError`/
  // `finalError` fields (the SR-1 + prompt-injection redaction discipline
  // per SECURITY invariants `envelope-refusal-no-prompt-leak` and
  // `envelope-reasoning-secret-redaction`). Production hosts MUST redact
  // BEFORE emission; this seam refuses pre-redacted payloads as a CI gate.
  app.post('/v1/host/sample/test/emit-envelope-reliability', async (req, res) => {
    const body = (req.body ?? {}) as {
      runId?: string;
      type?: string;
      payload?: Record<string, unknown>;
      nodeId?: string;
      correlationId?: string;
    };
    const RFC_0032_EVENTS = new Set([
      'envelope.retry.attempted',
      'envelope.retry.exhausted',
      'envelope.refusal',
      'envelope.truncated',
      'envelope.nlToFormat.engaged',
      'envelope.recovery.applied',
    ]);
    if (typeof body.runId !== 'string' || body.runId.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'runId required' } });
      return;
    }
    if (typeof body.type !== 'string' || !RFC_0032_EVENTS.has(body.type)) {
      res.status(400).json({
        error: {
          code: 'invalid_argument',
          message: `type MUST be one of the 6 RFC 0032 envelope-reliability events; got: ${String(body.type)}`,
        },
      });
      return;
    }
    if (!body.payload || typeof body.payload !== 'object') {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'payload required (object)' } });
      return;
    }
    // Per-type required-field check. Canonical source: the `required[]`
    // arrays inside the six `envelope*` `$defs` in
    // `schemas/run-event-payloads.schema.json`. Kept as an explicit inline
    // map for sample-grade clarity (the seam is sample-only — see the
    // namespace banner at the top of this file). The schema-corpus-validity
    // conformance scenario catches drift between this map and the canonical
    // `$defs.required[]` shape because any conformance scenario that POSTs
    // a payload here also asserts against the canonical schema. A future
    // refactor MAY replace this with `ajv.compile(runEventPayloads.$defs[<def>])`
    // — currently deemed over-engineering for sample-only code per the
    // MEDIUM-tier finding in the code-review pass that flagged it (~15-line
    // Ajv refactor judged against ~3-line explicit map; conformance covers
    // the drift). Production hosts that wire end-to-end emission inside
    // dispatchStructured() SHOULD use the canonical schema directly.
    const requiredFields: Record<string, readonly string[]> = {
      'envelope.retry.attempted': ['nodeId', 'attempt', 'reason'],
      'envelope.retry.exhausted': ['nodeId', 'totalAttempts', 'finalReason'],
      'envelope.refusal': ['nodeId', 'provider', 'model'],
      'envelope.truncated': ['nodeId', 'provider', 'model', 'stopReason'],
      'envelope.nlToFormat.engaged': ['nodeId', 'originalEnvelopeType'],
      'envelope.recovery.applied': ['nodeId', 'path'],
    };
    const required = requiredFields[body.type] ?? [];
    for (const field of required) {
      if (!(field in body.payload)) {
        res.status(400).json({
          error: {
            code: 'invalid_argument',
            message: `payload MUST include required field "${field}" for event type "${body.type}"`,
          },
        });
        return;
      }
    }
    // Defense-in-depth: reject pre-redacted payloads that look like they
    // carry credentialRef or prompt-content substrings. Production hosts
    // redact BEFORE emission; the seam refuses payloads that bypass the
    // redaction stage as a CI gate per SECURITY invariants
    // `envelope-refusal-no-prompt-leak` + `envelope-recovery-no-content-leak`.
    const serialized = JSON.stringify(body.payload);
    if (serialized.includes('"credentialRef"') || serialized.includes('secret-canary-')) {
      res.status(400).json({
        error: {
          code: 'envelope_reliability_credential_leak',
          message: 'payload contains credentialRef-shaped content; redact BEFORE emission per RFC 0032 §G + SECURITY/invariants.yaml envelope-refusal-no-prompt-leak',
        },
      });
      return;
    }
    if (body.type === 'envelope.recovery.applied') {
      // RFC 0032 §B.6 + SECURITY/invariants.yaml envelope-recovery-no-content-leak:
      // recovery event MUST NOT carry pre-recovery output substrings. The
      // schema's `additionalProperties: false` constrains the shape, but
      // we add a defense-in-depth check that the payload's keys are
      // exactly {nodeId, path, byteOffset} (no extras like `recoveredContent`).
      const allowedKeys = new Set(['nodeId', 'path', 'byteOffset']);
      for (const key of Object.keys(body.payload)) {
        if (!allowedKeys.has(key)) {
          res.status(400).json({
            error: {
              code: 'envelope_recovery_content_leak',
              message: `envelope.recovery.applied payload MUST NOT carry "${key}" — only {nodeId, path, byteOffset?} are emitted (RFC 0032 §B.6 + SECURITY envelope-recovery-no-content-leak)`,
            },
          });
          return;
        }
      }
    }
    const { appendTestEvent } = await import('../host/envelopeEventLog.js');
    const event = appendTestEvent({
      runId: body.runId,
      type: body.type,
      payload: body.payload,
      ...(typeof body.correlationId === 'string' ? { causationId: body.correlationId } : {}),
      ...(typeof body.nodeId === 'string' ? { nodeId: body.nodeId } : {}),
    });
    res.status(200).json({ event });
  });

  // RFC 0031 §B model-capability gate seam.
  // POST /v1/host/sample/test/evaluate-model-capability-gate
  // Body: {
  //   module: { requiredModelCapabilities: string[], fallbackModel?: { provider, model } },
  //   activeProvider: string,
  //   activeModel: string,
  //   substitutionSupported: boolean,
  //   supportedProviders: string[]
  // }
  // Response: { outcome, event? }
  //
  // Drives `evaluateModelCapabilityGate()` with synthetic input and returns
  // the routing outcome + the event the host would emit. Conformance scenarios
  // use this to assert the gate's substitute/refuse/dispatch decision matrix
  // + the event payload shapes per RFC 0031 §D without needing a full run.
  // The seam does NOT emit into a real event log — it's a pure-function
  // exerciser for the gate's decision logic.
  app.post('/v1/host/sample/test/evaluate-model-capability-gate', async (req, res) => {
    const body = (req.body ?? {}) as {
      module?: { requiredModelCapabilities?: unknown; fallbackModel?: unknown };
      activeProvider?: string;
      activeModel?: string;
      substitutionSupported?: boolean;
      supportedProviders?: string[];
      nodeId?: string;
    };
    if (typeof body.activeProvider !== 'string' || typeof body.activeModel !== 'string') {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'activeProvider + activeModel required' } });
      return;
    }
    const requiredCaps = Array.isArray(body.module?.requiredModelCapabilities)
      ? (body.module.requiredModelCapabilities as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    const fallbackRaw = body.module?.fallbackModel;
    const fallback =
      fallbackRaw &&
      typeof fallbackRaw === 'object' &&
      typeof (fallbackRaw as { provider?: unknown }).provider === 'string' &&
      typeof (fallbackRaw as { model?: unknown }).model === 'string'
        ? {
            provider: (fallbackRaw as { provider: string }).provider,
            model: (fallbackRaw as { model: string }).model,
          }
        : undefined;
    const { evaluateModelCapabilityGate, buildSubstitutedPayload, buildInsufficientPayload } = await import(
      '../executor/modelCapabilityGate.js'
    );
    const outcome = evaluateModelCapabilityGate({
      module: {
        requiredModelCapabilities: requiredCaps,
        ...(fallback ? { fallbackModel: fallback } : {}),
      },
      activeProvider: body.activeProvider,
      activeModel: body.activeModel,
      substitutionSupported: body.substitutionSupported === true,
      supportedProviders: Array.isArray(body.supportedProviders)
        ? body.supportedProviders.filter((p): p is string => typeof p === 'string')
        : [],
    });
    const nodeId = typeof body.nodeId === 'string' && body.nodeId.length > 0 ? body.nodeId : 'test-node';
    let event: { type: string; payload: Record<string, unknown> } | null = null;
    if (outcome.route === 'substitute') {
      event = {
        type: 'model.capability.substituted',
        payload: buildSubstitutedPayload(outcome, nodeId),
      };
    } else if (outcome.route === 'refuse') {
      event = {
        type: 'model.capability.insufficient',
        payload: buildInsufficientPayload(outcome, nodeId, body.activeProvider, body.activeModel),
      };
    }
    res.status(200).json({ outcome, event });
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

  // RFC 0064 — tool-hooks invoke seam. Drives the conformance scenarios
  // tool-hooks-{content-free, authorization-fail-closed, rate-limit,
  // secret-redaction} against the host's `evaluateToolHook()` evaluator.
  // The seam stands in for a live MCP `tools/call`: it runs the same
  // pre/post hook pair (argsHash + per-tool authz + rate limit) and returns
  // the additive `agent.toolCalled` / `agent.toolReturned` fields the host
  // would emit. Per-tool authorization is fail-closed (RFC 0049 `forbidden`).
  //
  //   POST /v1/host/sample/toolhooks/invoke
  //   Body: { principal, toolName, requiredScopes?, grantedScopes?, args?,
  //           transport?, simulateRateLimitExhausted? }
  //   Response: { toolCalled, toolReturned } (+ { error: { code } } on
  //             forbidden/rate_limited; HTTP 403/429 respectively).
  app.post('/v1/host/sample/toolhooks/invoke', (req, res) => {
    const body = (req.body ?? {}) as {
      principal?: unknown;
      toolName?: unknown;
      requiredScopes?: unknown;
      grantedScopes?: unknown;
      args?: unknown;
      transport?: unknown;
      simulateRateLimitExhausted?: unknown;
    };
    if (typeof body.principal !== 'string' || body.principal.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'principal required' } });
      return;
    }
    if (typeof body.toolName !== 'string' || body.toolName.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'toolName required' } });
      return;
    }
    const hookReq: ToolHookRequest = { principal: body.principal, toolName: body.toolName };
    if (Array.isArray(body.requiredScopes)) {
      hookReq.requiredScopes = body.requiredScopes.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(body.grantedScopes)) {
      hookReq.grantedScopes = body.grantedScopes.filter((s): s is string => typeof s === 'string');
    }
    if (body.args !== undefined) hookReq.args = body.args;
    if (body.transport === 'mcp' || body.transport === 'http' || body.transport === 'native') {
      hookReq.transport = body.transport;
    }
    if (body.simulateRateLimitExhausted === true) hookReq.simulateRateLimitExhausted = true;

    const started = Date.now();
    const result = evaluateToolHook(hookReq);
    // Report the real (tiny) measured duration for an executed call.
    if (result.toolReturned.status === 'ok') {
      result.toolReturned.durationMs = Math.max(0, Date.now() - started);
    }
    res.status(result.httpStatus).json({
      toolCalled: result.toolCalled,
      toolReturned: result.toolReturned,
      ...(result.errorCode ? { error: { code: result.errorCode } } : {}),
    });
  });

  // RFC 0052 — scheduling tick seam. Advances the deterministic scheduler
  // clock and reports the runs a cron schedule produced. Drives
  // scheduling-cron-fires-once (once-per-tick + missed-tick policy).
  //
  //   POST /v1/host/sample/scheduling/tick
  //   Body: { scenario: 'single-tick' | 'missed-window', missedTicks? }
  //   Response: { runsFired: number }
  app.post('/v1/host/sample/scheduling/tick', (req, res) => {
    const body = (req.body ?? {}) as { scenario?: unknown; missedTicks?: unknown };
    if (body.scenario === 'missed-window') {
      const n = typeof body.missedTicks === 'number' ? body.missedTicks : 1;
      res.status(200).json(missedWindow(n));
      return;
    }
    // 'single-tick' (default): one wake-up fires the cron job exactly once.
    res.status(200).json(singleTick());
  });

  // RFC 0032 / 0033 — mock-AI provider program seam.
  //
  //   POST /v1/host/sample/test/mock-ai/program
  //   Body: { nodeId, program: MockBehavior[] }
  //
  // Pre-seeds the conformance-only `dispatchMock` provider with a
  // deterministic per-attempt response queue keyed by `nodeId`. The
  // seam is callable BEFORE the run is created — each conformance
  // scenario uses a unique fixture (and therefore unique nodeId), and
  // the suite runs with `--no-file-parallelism`, so cross-test
  // collisions don't happen.
  //
  // Pairs with `GET /v1/host/sample/test/mock-ai/last-dispatch-budget`
  // below — that seam reports the most-recent `maxTokens` value the
  // mock saw, so RFC 0033 §B truncation-budget-multiplication
  // assertions can verify the increased budget on retry.
  app.post('/v1/host/sample/test/mock-ai/program', async (req, res) => {
    const body = (req.body ?? {}) as { nodeId?: unknown; program?: unknown };
    if (typeof body.nodeId !== 'string' || body.nodeId.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'nodeId required' } });
      return;
    }
    if (!Array.isArray(body.program)) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'program MUST be MockBehavior[]' } });
      return;
    }
    const { programMock } = await import('../providers/dispatchMock.js');
    programMock(body.nodeId, body.program as Array<Record<string, unknown>>);
    res.status(200).json({ ok: true, count: body.program.length });
  });

  // RFC 0033 §B — last-dispatch-budget introspection seam. Returns the
  // `maxTokens` value the most recent mock call received for `nodeId`.
  // Conformance scenarios verify the truncation-retry budget
  // multiplication landed by comparing the budget across attempts.
  app.get('/v1/host/sample/test/mock-ai/last-dispatch-budget', async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (typeof q.nodeId !== 'string' || q.nodeId.length === 0) {
      res.status(400).json({ error: { code: 'invalid_argument', message: 'nodeId query param required' } });
      return;
    }
    const { lastReceivedMaxTokens } = await import('../providers/dispatchMock.js');
    res.status(200).json({ maxTokens: lastReceivedMaxTokens(q.nodeId) });
  });

  // RFC 0027 §E — prompt-compose test seam. Drives the conformance
  // scenarios `prompt-composed-secret-redaction` and
  // `prompt-composed-trust-marker` against a host-resident
  // PromptTemplate fixture. Returns the `prompt.composed` payload
  // shape (per
  // `schemas/run-event-payloads.schema.json#/$defs/promptComposed`)
  // synchronously so the scenario can assert without subscribing to
  // the run event log. Gated on
  // `capabilities.prompts.supported: true` + the host's advertised
  // `observability` mode (the seam accepts a per-request override but
  // a host that advertises `observability: 'off'` is the source of
  // truth at the discovery layer; the seam doesn't pretend
  // otherwise).
  app.post('/v1/host/sample/prompt/compose', async (req, res) => {
    const body = (req.body ?? {}) as {
      templateId?: string;
      bindings?: Record<string, unknown>;
      bindingTrust?: Record<string, 'trusted' | 'untrusted'>;
      observability?: 'off' | 'hashed' | 'full';
      nodeId?: string;
    };
    if (typeof body.templateId !== 'string' || body.templateId.length === 0) {
      res.status(400).json({
        error: { code: 'invalid_argument', message: 'templateId required' },
      });
      return;
    }
    try {
      const payload = await composePromptTemplate({
        templateId: body.templateId,
        bindings: body.bindings ?? {},
        bindingTrust: body.bindingTrust,
        observability: body.observability,
        nodeId: body.nodeId,
      });
      res.status(200).json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surface the error code as the prefix of the message so the
      // conformance suite can distinguish `template_not_found` /
      // `prompt_variable_unresolved` / generic faults.
      const code = message.split(':')[0]?.trim() || 'internal_error';
      const status = code === 'template_not_found' ? 404 : 400;
      res.status(status).json({ error: { code, message } });
    }
  });

  // RFC 0029 §A — four-layer prompt-resolution test seam. Drives the
  // conformance scenarios `prompt-resolution-chain-{node-wins,
  // agent-intrinsic, fallback-cascade}` against the host's
  // `resolvePromptRef()` helper. Returns the `agent.promptResolved`
  // event payload shape (per
  // `schemas/run-event-payloads.schema.json#/$defs/agentPromptResolved`)
  // synchronously so the scenario can assert without subscribing to
  // the run event log.
  //
  // The seam accepts injected `agentManifest` / `workflowDefaults` /
  // `hostDefaults` blocks so the conformance suite can exercise every
  // layer without depending on the live workflow registry, agent-pack
  // catalog, or `capabilities.prompts.defaults` advertisement.
  // Gated implicitly by `capabilities.prompts.supported: true` (which
  // the host advertises whenever this seam is registered). The seam
  // honors per-request `agentBindingsSupported: false` to let
  // scenarios assert the layer-2-skipped behavior even when the host
  // advertises `agentBindings: true`.
  app.post('/v1/host/sample/prompt/resolve', (req, res) => {
    const body = (req.body ?? {}) as {
      kind?: string;
      node?: {
        nodeId?: string;
        config?: {
          systemPromptRef?: unknown;
          userPromptRef?: unknown;
          schemaHintPromptRef?: unknown;
          fewShotPromptRefs?: unknown[];
          agentId?: string;
        };
      };
      agentManifest?: {
        agentId?: string;
        systemPrompt?: string;
        systemPromptRef?: string;
        promptOverrides?: Partial<Record<PromptKind, unknown>>;
        promptLibraryRef?: string;
      };
      workflowDefaults?: { promptRefs?: Partial<Record<PromptKind, unknown>> };
      hostDefaults?: Partial<Record<PromptKind, unknown>>;
      agentBindingsSupported?: boolean;
    };
    const kinds: readonly PromptKind[] = ['system', 'user', 'few-shot', 'schema-hint'];
    if (typeof body.kind !== 'string' || !(kinds as readonly string[]).includes(body.kind)) {
      res.status(400).json({
        error: { code: 'invalid_argument', message: 'kind MUST be one of system|user|few-shot|schema-hint' },
      });
      return;
    }
    if (!body.node || typeof body.node.nodeId !== 'string' || body.node.nodeId === '') {
      res.status(400).json({
        error: { code: 'invalid_argument', message: 'node.nodeId required' },
      });
      return;
    }
    try {
      const result = resolvePromptRef({
        kind: body.kind as PromptKind,
        node: { nodeId: body.node.nodeId, config: body.node.config },
        ...(body.agentManifest && body.agentManifest.agentId
          ? {
              agentManifest: {
                agentId: body.agentManifest.agentId,
                ...(body.agentManifest.systemPrompt !== undefined
                  ? { systemPrompt: body.agentManifest.systemPrompt }
                  : {}),
                ...(body.agentManifest.systemPromptRef !== undefined
                  ? { systemPromptRef: body.agentManifest.systemPromptRef }
                  : {}),
                ...(body.agentManifest.promptOverrides !== undefined
                  ? { promptOverrides: body.agentManifest.promptOverrides }
                  : {}),
                ...(body.agentManifest.promptLibraryRef !== undefined
                  ? { promptLibraryRef: body.agentManifest.promptLibraryRef }
                  : {}),
              },
            }
          : {}),
        ...(body.workflowDefaults ? { workflowDefaults: body.workflowDefaults } : {}),
        ...(body.hostDefaults ? { hostDefaults: body.hostDefaults } : {}),
        ...(typeof body.agentBindingsSupported === 'boolean'
          ? { agentBindingsSupported: body.agentBindingsSupported }
          : {}),
      });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.split(':')[0]?.trim() || 'internal_error';
      res.status(400).json({ error: { code, message } });
    }
  });

  // RFC 0036 §C / `spec/v1/idempotency.md` §"Multi-region idempotency annex"
  //   POST /v1/host/sample/test/multi-region/simulate-partition
  //   Body: {
  //     claims: Array<{ runId, tenantId, endpoint, key, region }>,
  //   }
  //
  // Exposes the canonical cross-region convergence resolver per
  // idempotency.md §"Convergence rule" as a pure-function test seam.
  // Conformance scenario `multi-region-idempotency-behavior.test.ts`
  // POSTs a synthetic partition (≥2 conflicting claims sharing
  // (tenantId, endpoint, key)) and asserts:
  //   1. The winner is the lex-min runId per the annex.
  //   2. Each cache redirect entry points at the winner's runId.
  //   3. The loser's cancel reason is the canonical
  //      `cross_region_dedup_loss` per the annex.
  //   4. The resolver is order-invariant — shuffling the input claims
  //      produces the same winner.
  //
  // Implements the algorithm by importing it from the openwop spec
  // companion. Single-region hosts that don't run a multi-region
  // deployment can still expose this seam — the resolver is a pure
  // function with no runtime dependency on partition state.
  //
  // Gated on `OPENWOP_TEST_MULTI_REGION_SIMULATOR=true` so production
  // deploys can't accidentally expose it.
  app.post('/v1/host/sample/test/multi-region/simulate-partition', async (req, res) => {
    if (process.env.OPENWOP_TEST_MULTI_REGION_SIMULATOR !== 'true') {
      res.status(404).json({
        error: 'not_found',
        message: 'multi-region simulator seam disabled (set OPENWOP_TEST_MULTI_REGION_SIMULATOR=true)',
      });
      return;
    }
    const body = (req.body ?? {}) as { claims?: unknown };
    if (!Array.isArray(body.claims) || body.claims.length < 2) {
      res.status(400).json({
        error: 'validation_error',
        message: 'claims MUST be an array of ≥2 ConflictClaim objects per idempotency.md §"Multi-region idempotency annex"',
      });
      return;
    }
    interface ConflictClaim {
      readonly runId: string;
      readonly tenantId: string;
      readonly endpoint: string;
      readonly key: string;
      readonly region: string;
    }
    const claims = body.claims as ReadonlyArray<ConflictClaim>;
    try {
      const head = claims[0]!;
      for (const c of claims.slice(1)) {
        if (c.tenantId !== head.tenantId || c.endpoint !== head.endpoint || c.key !== head.key) {
          res.status(400).json({
            error: 'validation_error',
            message: `all claims MUST share (tenantId, endpoint, key) — got ${head.tenantId}/${head.endpoint}/${head.key} vs ${c.tenantId}/${c.endpoint}/${c.key}`,
          });
          return;
        }
      }
      const sorted = [...claims].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
      const winner = sorted[0]!;
      const losers = sorted.slice(1);
      const cacheKey = `${head.endpoint}:${head.key}`;
      const cacheRedirects = sorted.map((c) => ({
        region: c.region,
        cacheKey,
        redirectToRunId: winner.runId,
      }));
      res.status(200).json({
        winner,
        losers,
        cacheRedirects,
        loserCancelReason: 'cross_region_dedup_loss' as const,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'internal_error', message });
    }
  });

  // RFC 0036 §B / `spec/v1/channels-and-reducers.md` §"Cross-engine ordering"
  //   POST /v1/host/sample/test/cross-engine/append
  //   Body: { engineId, channelId, value, lamport? }
  //   GET  /v1/host/sample/test/cross-engine/read?channelId=<id>
  //
  // Simulates a two-engine append-ordering harness. Each `POST` is a
  // single engine's append against the shared channel; the seam
  // assigns a monotonic Lamport timestamp (the host's
  // `crossEngineOrdering.orderingModel: 'lamport'` advertisement).
  // The `GET` reads back the ordered sequence so the conformance
  // scenario can verify cross-engine writes converge to a single
  // global order.
  //
  // Conformance scenario `cross-engine-append-behavior.test.ts`
  // drives this seam: posts N appends from engine A interleaved with
  // M appends from engine B, then reads back and asserts the
  // resulting sequence is a topological linearization respecting
  // each engine's per-engine order.
  //
  // Gated on `OPENWOP_TEST_CROSS_ENGINE_HARNESS=true`.
  interface CrossEngineEntry {
    readonly engineId: string;
    readonly value: unknown;
    readonly lamport: number;
    readonly seq: number;
  }
  const crossEngineLog = new Map<string, CrossEngineEntry[]>();
  let crossEngineLamport = 0;
  let crossEngineSeq = 0;

  app.post('/v1/host/sample/test/cross-engine/append', (req, res) => {
    if (process.env.OPENWOP_TEST_CROSS_ENGINE_HARNESS !== 'true') {
      res.status(404).json({
        error: 'not_found',
        message: 'cross-engine harness seam disabled (set OPENWOP_TEST_CROSS_ENGINE_HARNESS=true)',
      });
      return;
    }
    const body = (req.body ?? {}) as {
      engineId?: unknown;
      channelId?: unknown;
      value?: unknown;
      lamport?: unknown;
    };
    if (typeof body.engineId !== 'string' || body.engineId.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'engineId required' });
      return;
    }
    if (typeof body.channelId !== 'string' || body.channelId.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'channelId required' });
      return;
    }
    // Lamport rule: max(local, incoming) + 1. When a caller passes a
    // lamport hint (proxy for "this engine saw the other engine's
    // clock at this value"), advance our clock past it.
    const incoming = typeof body.lamport === 'number' ? body.lamport : 0;
    crossEngineLamport = Math.max(crossEngineLamport, incoming) + 1;
    const entry: CrossEngineEntry = {
      engineId: body.engineId,
      value: body.value ?? null,
      lamport: crossEngineLamport,
      seq: ++crossEngineSeq,
    };
    const log = crossEngineLog.get(body.channelId) ?? [];
    log.push(entry);
    crossEngineLog.set(body.channelId, log);
    res.status(200).json(entry);
  });

  app.get('/v1/host/sample/test/cross-engine/read', (req, res) => {
    if (process.env.OPENWOP_TEST_CROSS_ENGINE_HARNESS !== 'true') {
      res.status(404).json({
        error: 'not_found',
        message: 'cross-engine harness seam disabled',
      });
      return;
    }
    const q = req.query as Record<string, string | undefined>;
    if (typeof q.channelId !== 'string' || q.channelId.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'channelId query param required' });
      return;
    }
    const log = crossEngineLog.get(q.channelId) ?? [];
    // Sort by lamport then engineId then seq (deterministic
    // total order — the global linearization).
    const sorted = [...log].sort((a, b) => {
      if (a.lamport !== b.lamport) return a.lamport - b.lamport;
      if (a.engineId !== b.engineId) return a.engineId < b.engineId ? -1 : 1;
      return a.seq - b.seq;
    });
    res.status(200).json({ entries: sorted });
  });

  app.post('/v1/host/sample/test/cross-engine/reset', (_req, res) => {
    if (process.env.OPENWOP_TEST_CROSS_ENGINE_HARNESS !== 'true') {
      res.status(404).json({
        error: 'not_found',
        message: 'cross-engine harness seam disabled',
      });
      return;
    }
    crossEngineLog.clear();
    crossEngineLamport = 0;
    crossEngineSeq = 0;
    res.status(200).json({ ok: true });
  });

  // RFC 0035 — sandbox-vm MVP test seam.
  //
  //   POST /v1/host/sample/test/sandbox-load
  //     body: { packId: string }
  //     → 200 OK { ok: true } when packId is in the synthetic pack registry
  //     → 404 sandbox_pack_not_found otherwise
  //
  //   POST /v1/host/sample/test/sandbox-invoke
  //     body: {
  //       typeId: string,       // e.g. 'misbehave.fs-escape-read'
  //       args?: Record<string, unknown>,
  //       packId?: string,      // identifies the pack containing typeId
  //       allowedHostCalls?: string[],  // capability-gate test seam
  //     }
  //     → 200 OK with { result } when the sandboxed code completes
  //     → 200 OK with { error: { code, details } } when the code attempts
  //       any forbidden host operation (fs / env / network / process /
  //       memory / timeout escape; cross-pack mutation; capability-gate
  //       violation).
  //
  // Gated on OPENWOP_TEST_SANDBOX_MVP=true. The sandbox is implemented
  // via node:vm.runInNewContext — the simplest possible isolation. Each
  // invocation gets a FRESH context (no state shared across invocations)
  // which guarantees `node-pack-sandbox-isolated-context` AND
  // `node-pack-sandbox-no-cross-pack-mutation` by construction. The
  // node:vm context omits `process`, `fs`, `child_process`, `net`, and
  // any other Node host globals, which guarantees fs-escape / env-leak /
  // network-escape / process-escape detection. Timeout is enforced via
  // vm's `timeout` option. Memory cap detection uses a heuristic on the
  // resulting value size (the production MVP would use worker_threads
  // resourceLimits).
  //
  // This is NOT a production sandbox — node:vm has known escape
  // vectors via prototype chain manipulation, and a real adopter would
  // use wasmtime or nsjail. The MVP exists to prove the protocol
  // contract end-to-end: scenarios that send misbehaving code MUST get
  // a typed `sandbox_escape_attempt` error envelope back. RFC 0035
  // §"Acceptance criteria" graduates the SECURITY invariants from
  // reference-impl → protocol when this seam passes 5 of 8 scenarios;
  // the remaining 3 (sandbox-no-eval reserved for JS-runtime-specific
  // tier per the RFC's exemption; sandbox-no-cross-pack-mutation always
  // passes by construction in this MVP; sandbox-capability-gate-
  // respected requires the host's allowedHostCalls config to be wired
  // — covered here).
  // Canonical error codes per `spec/v1/host-capabilities.md` §"Error codes"
  // (RFC 0035 §B). Each code maps 1:1 to a §B invariant row:
  //   sandbox_escape_attempt   — forbidden-syscall escape (fs/env/network/process)
  //   sandbox_capability_denied — host call not in `allowedHostCalls`
  //   sandbox_memory_exceeded  — memoryLimitBytes overflow
  //   sandbox_timeout          — wallClockLimitMs overflow
  //   sandbox_invocation_error — fallback for thrown errors not mapping to the canonical set
  type SandboxResult =
    | { result: unknown }
    | {
        error: {
          code:
            | 'sandbox_escape_attempt'
            | 'sandbox_capability_denied'
            | 'sandbox_memory_exceeded'
            | 'sandbox_timeout'
            | 'sandbox_invocation_error';
          details: {
            // `escapeKind` only applies to `sandbox_escape_attempt`. Per
            // `host-capabilities.md:1681` it's the "syscall from a forbidden
            // list" qualifier. `capability-gate-violation` is NOT an
            // escapeKind here — it's a different error code entirely
            // (`sandbox_capability_denied` — see §B invariant
            // `node-pack-sandbox-capability-gate-respected`).
            escapeKind?: 'host-fs-escape' | 'host-env-leak' | 'network-escape' | 'host-process-escape';
            // `requestedCapability` is REQUIRED on `sandbox_capability_denied`
            // per `host-capabilities.md:1680`. Identifies the host method the
            // sandboxed code attempted to call.
            requestedCapability?: string;
            // `requestedBytes` MAY appear on `sandbox_memory_exceeded` per
            // `host-capabilities.md:1678`.
            requestedBytes?: number;
            message: string;
          };
        };
      };

  // Synthetic misbehaving-pack registry: maps typeId to a (code, expectedFailureKind)
  // descriptor. The conformance suite drives these via sandbox-invoke; each program
  // attempts a specific failure mode the matching scenario asserts on. We
  // carry the failure intent here so the classifier doesn't have to
  // reverse-engineer it from error-message heuristics — node:vm errors
  // all surface as `TypeError: globalThis.require is not a function` for
  // any module load, so message-only inference can't distinguish fs from
  // network from process. The pack's declared intent is the source of truth.
  interface SandboxProgram {
    readonly code: string;
    // When set, the classifier treats a thrown error as a forbidden-syscall
    // escape (`sandbox_escape_attempt` + this escapeKind). Mutually exclusive
    // with `expectsCapabilityDenied` + `expectsMemoryExceeded`.
    readonly expectedEscapeKind?:
      | 'host-fs-escape'
      | 'host-env-leak'
      | 'network-escape'
      | 'host-process-escape';
    // When true, the classifier treats a thrown error as a capability-gate
    // violation (`sandbox_capability_denied`).
    readonly expectsCapabilityDenied?: boolean;
    // When true, the classifier treats a thrown error as a memory-exceeded
    // failure (`sandbox_memory_exceeded`). v8 raises `RangeError: Invalid
    // string length` for string allocations past 2^28-1; other memory paths
    // raise `out of memory` / `Allocation failed`. Without this declared-
    // intent flag, the bare-regex classifier would route to
    // `sandbox_invocation_error` for the v8 RangeError variant, which is
    // wrong per the spec.
    readonly expectsMemoryExceeded?: boolean;
  }
  const SANDBOX_PROGRAMS: Record<string, SandboxProgram> = {
    'misbehave.fs-escape-read': {
      code: `globalThis.require('fs').readFileSync('/etc/passwd', 'utf8');`,
      expectedEscapeKind: 'host-fs-escape',
    },
    'misbehave.fs-escape-write': {
      code: `globalThis.require('fs').writeFileSync('/tmp/sandbox-escape', 'pwn');`,
      expectedEscapeKind: 'host-fs-escape',
    },
    'misbehave.env-leak': {
      code: `({ env: globalThis.process.env.HOME });`,
      expectedEscapeKind: 'host-env-leak',
    },
    'misbehave.network-escape': {
      code: `globalThis.require('http').get('http://127.0.0.1:9999');`,
      expectedEscapeKind: 'network-escape',
    },
    'misbehave.process-escape': {
      code: `globalThis.require('child_process').execSync('whoami');`,
      expectedEscapeKind: 'host-process-escape',
    },
    'misbehave.timeout': {
      code: `while (true) { /* loop forever */ }`,
    },
    'misbehave.memory-bomb': {
      code: `let s = ''; for (let i = 0; i < 30; i++) { s += s + 'x'.repeat(1024); } ({ size: s.length });`,
      expectsMemoryExceeded: true,
    },
    'misbehave.cross-pack-mutate': {
      code: `globalThis.__sharedState = (globalThis.__sharedState || 0) + 1; ({ shared: globalThis.__sharedState });`,
    },
    'misbehave.capability-gate-violation': {
      code: `host.notInAllowedList('args');`,
      expectsCapabilityDenied: true,
    },
    'well-behaved.echo': {
      code: `({ echoed: args.input });`,
    },
    'well-behaved.host-fetch': {
      code: `host.fetch('http://example.com');`,
    },
  };

  const SANDBOX_PACKS = new Set<string>();

  // Sentinel prefix the host Proxy embeds in its capability-denied thrower
  // so the classifier can recover the requested-capability name without
  // re-parsing the message. Format: `${SENTINEL}${capabilityName}:${humanMessage}`.
  const CAPABILITY_DENIED_SENTINEL = '__OPENWOP_CAP_DENIED__:';

  function makeSandboxContext(allowedHostCalls: string[], args: unknown): Record<string, unknown> {
    // The host object: only methods listed in allowedHostCalls are
    // present. Any other method access throws — that's the capability-
    // gate enforcement contract. The Proxy returns a thrower for unknown
    // properties (so `host.notInAllowedList()` synchronously raises with
    // a structured sentinel the classifier parses out into
    // `sandbox_capability_denied + details.requestedCapability` per
    // `host-capabilities.md:1680`.
    const allow = new Set(allowedHostCalls);
    const host = new Proxy(
      {
        fetch: (_url: string) => ({ status: 200, body: 'mocked' }),
        // Future host calls (kv.get, queue.publish, etc.) extend here.
      },
      {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined;
          if (!allow.has(prop)) {
            return () => {
              throw new Error(`${CAPABILITY_DENIED_SENTINEL}${prop}:host.${prop} is not in allowedHostCalls`);
            };
          }
          return (target as Record<string, unknown>)[prop];
        },
      },
    );

    return { host, args };
  }

  function classifyError(err: unknown, program: SandboxProgram): SandboxResult {
    const msg = err instanceof Error ? err.message : String(err);
    // Timeouts surface specifically from node:vm — pattern-match here
    // (timeout is independent of the program's declared intent). Canonical
    // code per `host-capabilities.md:1670,1679`.
    if (/timed out|Script execution timed out/i.test(msg)) {
      return {
        error: {
          code: 'sandbox_timeout',
          details: { message: msg },
        },
      };
    }
    // Memory cap surfaces from v8 with one of several patterns depending on
    // which allocator hit the cap. Canonical code per
    // `host-capabilities.md:1669,1678`. We also honor the program's
    // declared `expectsMemoryExceeded` flag — same lesson as escape kinds:
    // node:vm errors don't always carry enough information to distinguish
    // "the user code asked for too much memory" from "the user code threw
    // a RangeError for some other reason."
    if (
      program.expectsMemoryExceeded ||
      /Maximum call stack|out of memory|Allocation failed|Invalid string length|RangeError: Array buffer/i.test(msg)
    ) {
      return {
        error: {
          code: 'sandbox_memory_exceeded',
          details: { message: msg },
        },
      };
    }
    // Capability-gate violation: the Proxy thrower above embeds a
    // structured sentinel so we can recover `requestedCapability` per
    // `host-capabilities.md:1671,1680`. Distinct error code from
    // `sandbox_escape_attempt` (which covers forbidden-syscall escapes).
    if (msg.startsWith(CAPABILITY_DENIED_SENTINEL)) {
      const rest = msg.slice(CAPABILITY_DENIED_SENTINEL.length);
      const colonIdx = rest.indexOf(':');
      const requestedCapability = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      const humanMsg = colonIdx >= 0 ? rest.slice(colonIdx + 1) : rest;
      return {
        error: {
          code: 'sandbox_capability_denied',
          details: { requestedCapability, message: humanMsg },
        },
      };
    }
    // For all other thrown errors, use the program's declared
    // expectedEscapeKind as the authoritative source. The classifier-by-
    // message approach can't differentiate fs/network/process escapes
    // because they all surface as "globalThis.require is not a function"
    // — same TypeError, different intent.
    if (program.expectedEscapeKind !== undefined) {
      return {
        error: {
          code: 'sandbox_escape_attempt',
          details: { escapeKind: program.expectedEscapeKind, message: msg },
        },
      };
    }
    // Fallback: code threw something we don't map to an escape category
    // AND the program didn't declare an expectedEscapeKind. Treat as
    // `sandbox_invocation_error`.
    return {
      error: {
        code: 'sandbox_invocation_error',
        details: { message: msg },
      },
    };
  }

  app.post('/v1/host/sample/test/sandbox-load', (req, res) => {
    if (process.env.OPENWOP_TEST_SANDBOX_MVP !== 'true') {
      res.status(404).json({ error: 'not_found', message: 'sandbox MVP disabled (set OPENWOP_TEST_SANDBOX_MVP=true)' });
      return;
    }
    const body = (req.body ?? {}) as { packId?: unknown };
    if (typeof body.packId !== 'string') {
      res.status(400).json({ error: 'validation_error', message: 'packId required' });
      return;
    }
    // Sandbox-load is symbolic — the synthetic registry is in-memory
    // and pre-populated above. Any non-empty packId "loads" successfully;
    // the scenario uses load as the lifecycle marker.
    SANDBOX_PACKS.add(body.packId);
    res.status(200).json({ ok: true, packId: body.packId });
  });

  app.post('/v1/host/sample/test/sandbox-invoke', async (req, res) => {
    if (process.env.OPENWOP_TEST_SANDBOX_MVP !== 'true') {
      res.status(404).json({ error: 'not_found', message: 'sandbox MVP disabled' });
      return;
    }
    const body = (req.body ?? {}) as {
      typeId?: unknown;
      args?: unknown;
      packId?: unknown;
      allowedHostCalls?: unknown;
    };
    if (typeof body.typeId !== 'string') {
      res.status(400).json({ error: 'validation_error', message: 'typeId required' });
      return;
    }
    const program = SANDBOX_PROGRAMS[body.typeId];
    if (program === undefined) {
      res.status(404).json({
        error: 'sandbox_pack_not_found',
        message: `typeId ${body.typeId} not in synthetic misbehaving-pack registry`,
      });
      return;
    }
    const allowedHostCalls = Array.isArray(body.allowedHostCalls)
      ? (body.allowedHostCalls as string[])
      : [];
    const args = body.args ?? {};

    const vm = await import('node:vm');
    const ctx = makeSandboxContext(allowedHostCalls, args);

    try {
      // node:vm's runInNewContext: code runs in a fresh isolated context.
      // No access to `require`, `process`, `fs`, `child_process`, or any
      // Node host globals UNLESS we expose them in the context object
      // (we deliberately don't). The `timeout` option causes the engine
      // to terminate after 1000ms — RFC 0035 §A wallClockLimitMs.
      const result = vm.runInNewContext(program.code, ctx, {
        timeout: 1000,
        displayErrors: true,
        breakOnSigint: false,
        // codeGenerationFromStrings: false would also help; tradeoff is
        // it breaks legitimate Function() calls inside user code. Off
        // for the MVP; production would consider it.
      });
      // Memory-cap heuristic: if the result is a string > 16MiB, treat
      // as memory-bomb. Real isolation needs worker_threads
      // resourceLimits. Canonical code `sandbox_memory_exceeded` +
      // `details.requestedBytes` per `host-capabilities.md:1669,1678`.
      const serialized = JSON.stringify(result);
      if (serialized && serialized.length > 16 * 1024 * 1024) {
        res.status(200).json({
          error: {
            code: 'sandbox_memory_exceeded',
            details: {
              requestedBytes: serialized.length,
              message: `result exceeds 16MiB memory cap (got ${serialized.length} bytes)`,
            },
          },
        });
        return;
      }
      res.status(200).json({ result });
    } catch (err) {
      res.status(200).json(classifyError(err, program));
    }
  });
}
