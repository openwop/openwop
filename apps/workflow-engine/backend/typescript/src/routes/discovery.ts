/**
 * /.well-known/openwop + /v1/openapi.json + Capabilities-Etag.
 *
 * Honest advertisement: only what this sample actually supports. Real
 * deployers update the capabilities block whenever they swap a stub
 * for a real implementation.
 */

import { createHash } from 'node:crypto';
import type { Express } from 'express';
import type { AppConfig } from '../index.js';
import { listCapabilities } from '../executor/runtimeCapabilities.js';
import type { Storage } from '../storage/storage.js';
import { listHostSurfaces } from '../bootstrap/hostSurfaceRegistry.js';
import { universalEnvelopeKinds } from '../host/envelopeAcceptor.js';
import { MAX_INLINE_MEDIA_BYTES } from './mediaAssets.js';
import { getFsSandboxRoot } from '../host/inMemorySurfaces.js';
import { listLoadedConformanceFixtures } from '../host/index.js';
import { getPromptsHostConfig } from '../host/promptHostConfig.js';
import { getEnvelopeReasoningConfig } from '../host/envelopeReasoningConfig.js';
import { getModelCapabilityGateConfig } from '../host/modelCapabilityGateConfig.js';
import { getEnvelopeReliabilityConfig } from '../host/envelopeReliabilityConfig.js';

/**
 * RFC 0040 §D — this host's stable cross-host-causation `hostId`. Advertised in
 * `crossHostCausation.hostId` and echoed by `GET /v1/runs/{runId}/ancestry`
 * (the two MUST match). A real multi-host deployment overrides via env.
 */
export const CROSS_HOST_CAUSATION_HOST_ID =
  process.env.OPENWOP_CROSS_HOST_CAUSATION_HOST_ID ?? 'openwop-workflow-engine';

/**
 * RFC 0040 Phase 3 gate. Single source of truth shared by the discovery
 * advertisement (`crossHostCausation` + `version >= 3`) and the
 * `GET /v1/runs/{runId}/ancestry` endpoint gate, so the two never drift. The
 * ladder is additive — `phase4` implies `phase3` (a `version: 4` host MUST
 * implement Phase 3 too, per `capabilities.schema.json §...version`).
 */
export function isPhase3Enabled(): boolean {
  return (
    process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_3 === 'true' ||
    process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4 === 'true'
  );
}

interface Deps {
  storage: Storage;
  config: AppConfig;
}

export function registerDiscoveryRoutes(app: Express, _deps: Deps): void {
  app.get('/.well-known/openwop', (_req, res) => {
    const advertisement = buildAdvertisement(_deps.config);
    const etag = `"${createHash('sha256').update(JSON.stringify(advertisement)).digest('hex').slice(0, 16)}"`;
    res.set('Capabilities-Etag', etag);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(advertisement);
  });

  app.get('/v1/openapi.json', (_req, res) => {
    // Sample serves the published spec verbatim — points consumers at
    // the canonical openapi if they want full surface. Production hosts
    // ship a copy with their actual route subset.
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'openwop-workflow-engine-sample',
        version: _deps.config.serviceVersion,
        description:
          'Sample OpenWOP host. See https://openwop.dev for the canonical OpenAPI 3.1 spec.',
      },
      paths: {
        '/v1/runs': { post: { summary: 'Create a run' } },
        '/v1/runs/{runId}': { get: { summary: 'Fetch run snapshot' } },
        '/v1/runs/{runId}/cancel': { post: { summary: 'Cancel a run' } },
        '/v1/runs/{runId}:fork': { post: { summary: 'Fork a run from a sequence' } },
        '/v1/runs/{runId}/events': { get: { summary: 'SSE event stream' } },
        '/v1/runs/{runId}/events/poll': { get: { summary: 'Poll events (long-poll alternative to SSE)' } },
        '/v1/runs/{runId}/interrupts/{nodeId}': { post: { summary: 'Resolve a node-scoped interrupt' } },
        '/v1/interrupts/{token}': { post: { summary: 'Resolve an interrupt by signed token' } },
        '/v1/webhooks': {
          get: { summary: 'List webhook subscriptions (refs only; no secret)' },
          post: { summary: 'Register a webhook subscription' },
        },
        '/v1/webhooks/{subscriptionId}': { delete: { summary: 'Delete a webhook subscription' } },
        '/v1/webhooks/{subscriptionId}/test': { post: { summary: 'Fire a signed test delivery to a webhook subscription' } },
        '/v1/packs': { get: { summary: 'List installed packs' } },

        // RFC 0028 — prompt library. The reference host serves all
        // six routes via `routes/prompts.ts`. capabilities.prompts.
        // endpointsSupported is advertised as true; mutableLibrary as
        // true. Read endpoints (GET /v1/prompts, GET /v1/prompts/{id},
        // POST /v1/prompts:render) are gated on endpointsSupported;
        // mutating endpoints (POST/PUT/DELETE) are additionally gated
        // on mutableLibrary.
        '/v1/prompts': {
          get: { summary: 'List prompt templates (RFC 0028 §A)' },
          post: { summary: 'Create a user-source prompt template (RFC 0028 §A; requires mutableLibrary)' },
        },
        '/v1/prompts/{templateId}': {
          get: { summary: 'Fetch a prompt template (RFC 0028 §A)' },
          put: { summary: 'Replace a user-source prompt template (RFC 0028 §A; requires mutableLibrary)' },
          delete: { summary: 'Delete a user-source prompt template (RFC 0028 §A; requires mutableLibrary)' },
        },
        '/v1/prompts:render': {
          post: { summary: 'Render a prompt template with supplied variable bindings (RFC 0028 §A)' },
        },

        // ── Sample-extension routes (NOT part of the OpenWOP wire
        //    contract — vendor-prefixed per host-extensions.md) ──
        '/v1/host/sample/byok/secrets': {
          get: { summary: 'List stored BYOK credentialRefs (refs only)', tags: ['sample-extension'] },
          post: { summary: 'Store a BYOK credentialRef + value', tags: ['sample-extension'] },
        },
        '/v1/host/sample/byok/secrets/{credentialRef}': {
          delete: { summary: 'Remove a stored BYOK secret', tags: ['sample-extension'] },
        },
        '/v1/host/sample/runs/{runId}/interrupts': {
          get: { summary: 'List open interrupts for a run (authed; returns tokens)', tags: ['sample-extension'] },
        },
        '/v1/host/sample/demo-summary': {
          get: { summary: 'Summarize demo-app readiness for CLI and diagnostics', tags: ['sample-extension'] },
        },
        '/v1/host/sample/daemon-status': {
          get: { summary: 'Report demo-backend pid / startTime / uptimeSeconds / lastHeartbeat for CLI lifecycle commands', tags: ['sample-extension'] },
        },
        '/v1/host/sample/scheduler/jobs': {
          get: { summary: 'List scheduled cron jobs (RFC 0052 sample CRUD)', tags: ['sample-extension'] },
          post: { summary: 'Register a scheduled cron job; rejects beyond maxFutureHorizon with schedule_horizon_exceeded (RFC 0052 §B)', tags: ['sample-extension'] },
        },
        '/v1/host/sample/scheduler/jobs/{jobId}': {
          delete: { summary: 'Remove a scheduled cron job (RFC 0052 sample CRUD)', tags: ['sample-extension'] },
        },
        '/v1/host/sample/scheduler/jobs/{jobId}/trigger': {
          post: { summary: 'Fire a scheduled job once now (RFC 0052 §B.2 fire-once-per-tick)', tags: ['sample-extension'] },
        },
        '/v1/host/sample/chat/sessions': {
          get: { summary: 'List chat sessions for the calling tenant', tags: ['sample-extension'] },
          post: { summary: 'Create a new chat session', tags: ['sample-extension'] },
        },
        '/v1/host/sample/chat/sessions/{sessionId}': {
          get: { summary: 'Fetch a chat session header', tags: ['sample-extension'] },
          patch: { summary: 'Rename a chat session', tags: ['sample-extension'] },
          delete: { summary: 'Delete a chat session (cascades to messages)', tags: ['sample-extension'] },
        },
        '/v1/host/sample/chat/sessions/{sessionId}/messages': {
          get: { summary: 'Load every message in a chat session', tags: ['sample-extension'] },
          post: { summary: 'Append a message to a chat session', tags: ['sample-extension'] },
        },
        '/v1/host/sample/prompt/compose': {
          post: {
            summary: 'RFC 0027 §E compose seam — drives prompt-composed-* conformance scenarios (sample-only; NOT part of the canonical wire contract)',
            tags: ['sample-extension'],
          },
        },
        '/v1/host/sample/prompt/resolve': {
          post: {
            summary: 'RFC 0029 §A four-layer resolve seam — drives prompt-resolution-chain-* conformance scenarios (sample-only; NOT part of the canonical wire contract)',
            tags: ['sample-extension'],
          },
        },
        '/v1/host/sample/test/evaluate-model-capability-gate': {
          post: {
            summary: 'RFC 0031 §B model-capability gate seam — drives model-capability-{substituted,insufficient} conformance scenarios with synthetic input (sample-only; NOT part of the canonical wire contract)',
            tags: ['sample-extension'],
          },
        },
        '/v1/host/sample/test/emit-envelope-reliability': {
          post: {
            summary: 'RFC 0032 §B envelope-reliability event emission seam — drives envelope-{retry.*,refusal,truncated,nlToFormat.engaged,recovery.applied} conformance scenarios via synthetic test-event-log emission with defense-in-depth credentialRef/recoveredContent rejection (sample-only; NOT part of the canonical wire contract)',
            tags: ['sample-extension'],
          },
        },
      },
      tags: [
        { name: 'sample-extension', description: 'Sample-only routes outside the canonical OpenWOP v1 wire contract. Vendor-prefixed under /v1/host/sample/* per spec/v1/host-extensions.md.' },
      ],
    });
  });
}

function buildAdvertisement(config: AppConfig): Record<string, unknown> {
  // Honest advertise/enforce parity (capabilities.md): seam-only capabilities
  // are advertised ONLY when their (test-seam) implementation is reachable. A
  // default deploy claims only the production-wired surface — runTimeoutMs +
  // workspace (real executor wiring / real CRUD endpoints). This mirrors the
  // existing multiAgent/sandbox env-gating convention (a not-fully-wired
  // capability OMITS itself by default rather than over-claim in
  // /.well-known/openwop).
  const seamEnabled = process.env.OPENWOP_TEST_SEAM_ENABLED === 'true';
  const compactionEnabled = process.env.OPENWOP_TEST_TRIGGER_COMPACTION === 'true';
  const phase5 = process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_5 === 'true';
  const advertisement = {
    protocolVersion: '1.1',
    implementation: {
      name: config.serviceName,
      version: config.serviceVersion,
      vendor: 'openwop-samples',
    },
    // Per spec/v1/capabilities.md §3 — REQUIRED top-level fields.
    // `supportedEnvelopes` is the AI Envelope kind catalog per RFC 0021
    // (NOT the transport list — that's `supportedTransports` below).
    // The 4 universal kinds are always advertised because the host
    // implements the AIEnvelopeAcceptor (host/envelopeAcceptor.ts) which
    // validates them against schemas/envelopes/<kind>.schema.json.
    // RFC 0055 §C: the three OPTIONAL media.* kinds are advertised because
    // the host ships their per-kind schemas + serves their assets
    // (routes/mediaAssets.ts). They are NOT universal (not in
    // universalEnvelopeKinds()) — a consumer that doesn't recognize them
    // falls back to raw rendering.
    supportedEnvelopes: [...universalEnvelopeKinds(), 'media.image', 'media.audio', 'media.file'],
    schemaVersions: {
      runEvent: 1,
      capabilities: 1,
      // RFC 0021 §C: schemaVersions[<universal-kind>] MUST be 1 when the
      // host implements the per-kind schemas. The reference acceptor
      // ships v1 of all 4 universals.
      'clarification.request': 1,
      'schema.request': 1,
      'schema.response': 1,
      error: 1,
      // RFC 0055 §C media kinds (v1).
      'media.image': 1,
      'media.audio': 1,
      'media.file': 1,
    },
    limits: {
      // Per capabilities.md §3 (CapabilityLimiter shape) — non-negative integers.
      clarificationRounds: 5,
      schemaRounds: 3,
      envelopesPerTurn: 32,
      maxNodeExecutions: 1000,
      // RFC 0058 — wall-clock ceiling per run; upper bound for
      // RunOptions.configurable.runTimeoutMs. Breach emits
      // cap.breached{kind:'run-duration'} + error run_timeout. MUST equal
      // RUN_DURATION_CEILING_MS in executor/executor.ts (advertise/enforce
      // must agree).
      maxRunDurationMs: 600_000,
      // RFC 0058 + RFC 0061 — ceiling on agent-loop iterations (orchestrator
      // turns). Advertised ONLY under phase5, when host/agentLoop.ts's
      // re-entrant loop (the surface that actually counts turns + breaches
      // cap.breached{kind:'loop-iterations'}) is advertised. The linear-walk
      // executeRun path does not count orchestrator turns, so claiming this
      // unconditionally would over-advertise an unenforced bound.
      ...(phase5 ? { maxLoopIterations: 100 } : {}),
    },
    // RFC 0064 — per-tool authorization + rate-limit + content-free audit.
    // This host demonstrates the contract through the
    // `POST /v1/host/sample/toolhooks/invoke` seam (host/toolHooks.ts); the
    // live MCP `tools/call` path is not yet hooked. So advertise ONLY when
    // the seam is reachable (OPENWOP_TEST_SEAM_ENABLED) — never over-claim
    // toolHooks on a production deploy where no path emits the events.
    ...(seamEnabled
      ? {
          toolHooks: {
            supported: true,
            prePostEvents: true,
            perToolAuthorization: true,
            perToolRateLimit: true,
          },
        }
      : {}),
    // RFC 0052 — time-based run initiation. The once-per-tick + missed-tick
    // policy is demonstrated through the deterministic-clock
    // `POST /v1/host/sample/scheduling/tick` seam (host/schedulingService.ts);
    // no clock yet fires real runs from the trigger node. Advertise ONLY when
    // the seam is reachable. `delayed`/`calendar` honestly absent.
    ...(seamEnabled
      ? {
          scheduling: {
            supported: true,
            cron: true,
            maxFutureHorizon: 'P30D',
          },
        }
      : {}),
    // RFC 0059 — durable, {tenant, workspace}-scoped file layer (host/
    // workspaceStore.ts). §C CRUD + If-Match/etag + maxFileBytes, §E WCT-1
    // owner isolation + WSR-1 SR-1 redaction. Not `versioned` (latest-only).
    workspace: {
      supported: true,
      maxFileBytes: 65_536,
    },
    // Kanban boards — sample host-extension (non-normative). Demonstrates
    // the RFCS/0086 "named workflow agents" work surface: a card landing
    // in a trigger column starts a workflow run (RFC 0086 §E keeps the
    // board itself a host/vendor extension, not a normative protocol
    // surface). Routes under `/v1/host/sample/kanban/*`.
    kanban: {
      supported: true,
      features: ['boards', 'columns', 'cards', 'card-move-trigger'],
    },
    supportedTransports: ['rest', 'sse'],
    stream: { modes: ['values', 'updates', 'messages', 'debug'] },
    // Conformance fixtures loaded from in-tree `conformance/fixtures/`
    // at boot. Each fixture id here is a workflowId the host can run
    // via `POST /v1/runs { workflowId }` — the openwop conformance
    // suite reads this top-level `fixtures` array (per
    // `conformance/src/lib/fixtures.ts:80` — `c.fixtures`) at suite
    // init to decide which fixture-gated scenarios apply to this
    // host. Mirrors the SQLite reference host's discovery shape.
    fixtures: listLoadedConformanceFixtures(),
    capabilities: {
      auth: { profiles: [] },
      secrets: {
        supported: true,
        scopes: ['tenant', 'user', 'run'],
        resolution: 'host-managed',
      },
      // Spec-shaped per `spec/v1/capabilities.md:126-163` + `host-capabilities.md §host.aiProviders`.
      // Sample host wires three providers via raw fetch (see
      // `providers/dispatch.ts`); each requires BYOK. Tool-calling is
      // Anthropic-only for v1 (the only provider with a wired
      // tool_use loop in `providers/dispatchAnthropicTools.ts`).
      // Embeddings + image/video generation are NOT implemented — honestly
      // advertised so packs that depend on those sub-caps don't load.
      aiProviders: {
        supported: ['anthropic', 'openai', 'google'],
        byok: ['anthropic', 'openai', 'google'],
        policies: {
          modes: ['disabled', 'optional', 'required', 'restricted'],
          scopes: ['workspace', 'project', 'canvas-type'],
          errorCode: 'provider_policy_denied',
        },
        toolCalling: { supported: true, providers: ['anthropic'] },
        embeddings: { supported: false },
        imageGeneration: { supported: false },
        videoGeneration: { supported: false },
        // RFC 0055 §C rule 2 — inline-vs-URL cap for media.* envelope payloads.
        // Assets above this size are served by a tenant-scoped URL
        // (GET /v1/host/sample/assets/{token}) rather than inlined.
        maxInlineMediaBytes: MAX_INLINE_MEDIA_BYTES,
      },
      interrupts: {
        supported: true,
        kinds: ['approval', 'clarification', 'refinement', 'cancellation', 'external-event'],
        // `interrupt-profiles.md` (FINAL v1) catalogs optional
        // interrupt profiles. Sample claims only the profiles its
        // implementation actually backs end-to-end today:
        //
        //   - `openwop-interrupt-parent-child` — cancel cascade is
        //     wired in `routes/runs.ts` (walks `parentRunId`, cancels
        //     children + invalidates their open interrupts) and the
        //     `core.subWorkflow` node surfaces the child's open
        //     interrupt as a parent-side suspension. Conformance
        //     scenario `interrupt-parent-child-cascade.test.ts`
        //     passes; INTEROP-MATRIX row updated to match.
        //   - `openwop-interrupt-external-event` — `core.externalEvent`
        //     typeId + `interrupts/{token}` correlation matching are
        //     implemented; the `interrupt-external-event-correlation`
        //     scenario passes.
        //
        // Profiles NOT claimed (despite partial implementation):
        // `openwop-interrupt-quorum` (vote ledger exists but no
        // multi-tenant identity story), `openwop-interrupt-auth-required`
        // (auth path bears it via Bearer enforcement but no signed-
        // callback-token scoping yet).
        //
        // NOTE: the spec profile id for parent-cancel cascade is
        // `openwop-interrupt-cascade-cancel` (per `interrupt-profiles.md
        // §"openwop-interrupt-cascade-cancel"`). The conformance fixture
        // happens to use a `parent-child-cancel` slug but the canonical
        // profile id is the cascade-cancel one.
        profiles: [
          'openwop-interrupt-cascade-cancel',
          'openwop-interrupt-external-event',
        ],
      },
      // Sample stubs fork: the route accepts the request and copies
      // events 0..fromSeq, but doesn't reconstruct the executor's
      // resume position. Honest advertisement: not yet supported.
      replay: { supported: false, fork: false },
      // RFC 0056 — run feedback / annotations. The sample persists annotations
      // in a per-run side-store and serves POST/GET /v1/runs/{runId}/annotations
      // with secret-pattern + SR-1 redaction of correction/note.
      feedback: {
        supported: true,
        targets: ['run', 'event', 'node'],
        signals: ['rating', 'correction', 'label', 'flag'],
      },
      // Phase 1 of the multi-agent shift + RFC 0024 streaming. Sample
      // host emits both `agent.reasoned` (closing) AND
      // `agent.reasoning.delta` (streaming) events from the chat-responder
      // (`vendor.openwop-sample.chat-responder`) for managed-provider
      // turns. Per-run override via `RunOptions.configurable.reasoningVerbosity`.
      agents: {
        supported: true,
        reasoning: { verbosity: 'full', tokenLimit: 512, streaming: true },
        // RFC 0070 — this host loads pack `agents[]` into an AgentRegistry
        // (RFC 0003 installAgents) and dispatches a manifest agent via the
        // floor seam (`POST /v1/host/sample/agents/{agentId}/dispatch`),
        // enforcing toolAllowlist (§A14) + handoff schema validation (§D).
        manifestRuntime: { supported: true, handoffValidation: true },
        // RFCS/0086 reference impl — standing agent roster (named agent
        // instances owning a workflow portfolio). Sample host-extension
        // under `/v1/host/sample/roster`; tenant-scoped. Non-normative
        // until RFC 0086 reaches Active.
        roster: { supported: true, installScope: 'tenant' },
      },
      // RFC 0026 — `provider.usage` event support. Reference host emits
      // one `provider.usage` event per real LLM dispatch from
      // `aiProvidersHost.ts` (callAI / callAIWithTools / callAIManaged).
      // `costEstimates: true` because the dispatcher attaches advisory
      // `costEstimateUsd` for models in its static rate-table snapshot;
      // `currency: 'USD'` matches what `usageEmitter.ts` stamps.
      providerUsage: {
        supported: true,
        costEstimates: true,
        currency: 'USD',
      },
      // RFC 0027 — prompt-template resolution. Reference host loads
      // host-resident PromptTemplate fixtures from
      // `conformance-fixtures/prompt-templates/` (vendored from
      // `conformance/fixtures/prompt-templates/` by `sync-fixtures.sh`)
      // and exposes a `POST /v1/host/sample/prompt/compose` test seam
      // that drives the conformance suite's `prompt.composed`
      // assertions. observability: 'full' is advertised so the
      // capability-gated scenarios `prompt-composed-secret-redaction`
      // and `prompt-composed-trust-marker` activate. The composed body
      // redaction + trust-marker invariants are enforced by
      // `composePromptTemplate()` in `host/promptCompose.ts`; the
      // SECURITY invariants `prompt-composed-secret-redaction` and
      // `prompt-composed-trust-marker` in `SECURITY/invariants.yaml`
      // gate the conformance assertions.
      // Sourced from `host/promptHostConfig.ts` so the discovery
      // advertisement and the dispatch-time compose+resolve calls in
      // `bootstrap/nodes.ts` can't drift apart. Production hosts
      // override the single config module rather than editing two
      // call sites.
      prompts: { ...getPromptsHostConfig() },
      // RFC 0030 envelope-track advertisement. The universal-kind payload
      // schemas (`schemas/envelopes/*.schema.json`) carry the OPTIONAL
      // `reasoning` field per RFC 0030 §A. The reference host injects a
      // system-prompt directive instructing the model to populate it when
      // the dispatched `responseSchema` declares a top-level `reasoning`
      // property — implemented by `host/envelopeDirective.ts` and wired
      // into `aiProviders/aiProvidersHost.ts` `dispatchStructured()`.
      // Default posture is `"advisory"` (suggestive); operators override
      // via `OPENWOP_ENVELOPE_REASONING_DIRECTIVE` ∈ {`off`, `advisory`,
      // `mandatory`}. The advertisement reads through the same accessor
      // (`host/envelopeReasoningConfig.ts`) so what the host advertises
      // and what it actually injects stay in lockstep.
      //
      // `tierOneSubsetCompliance: "warn"` is honest — the universal-kind
      // schemas use OpenAI-strict-incompatible constraints (minLength /
      // maxLength / minItems) that pre-date RFC 0030; the strict-mode
      // static scenario surfaces violations under `"strict"` advertisement
      // but soft-skips under `"warn"`. A future RFC may bring the
      // universal-kind schemas into Tier-1 strict compliance.
      envelopes: {
        reasoning: (() => {
          const cfg = getEnvelopeReasoningConfig();
          return { supported: cfg.supported, promptDirective: cfg.promptDirective };
        })(),
        tierOneSubsetCompliance: 'warn',
        // RFC 0032 §C envelope-reliability event vocabulary. The reference
        // host emits four events end-to-end from `dispatchStructured()`'s
        // retry loop (per-attempt failure classification → emit →
        // truncation-routing-aware retry per RFC 0033 §A/§B/§C):
        //   - envelope.retry.attempted (per RFC 0032 §B.1, on attempt ≥ 2)
        //   - envelope.retry.exhausted (MUST-tier per RFC 0032 §C)
        //   - envelope.refusal (MUST-tier per RFC 0032 §C)
        //   - envelope.truncated (SHOULD-tier per RFC 0032 §B.4)
        // The MAY-tier `envelope.recovery.applied` event IS advertised:
        // dispatchStructured tries lenient parsing (markdown-fence
        // strip, balanced-brace walker) before declaring a parse-error
        // and emits the event when a recovery path engages (RFC 0032
        // §B.6 + `envelopeReliabilityEmit.ts:tryLenientParse`). The
        // remaining MAY-tier event (`envelope.nlToFormat.engaged`) is
        // OMITTED until NL-to-Format fallback lands — that recovery
        // strategy isn't implemented yet. The seam still accepts both
        // for conformance shape assertions.
        //
        // RFC 0033 §E `distinguishesTruncation: true` — the retry loop
        // inspects `finishReason: 'length'` and routes truncation through
        // a budget-multiplied retry per `OPENWOP_ENVELOPE_RELIABILITY_
        // TRUNCATION_MULTIPLIER` (default 2) WITHOUT applying the schema-
        // correction fragment. Schema-violation continues to retry with
        // the corrective fragment + unchanged budget per RFC 0033 §C.
        //
        // Operator circuit-breaker: `OPENWOP_ENVELOPE_RELIABILITY_END_TO_END
        // =false` falls back to legacy undifferentiated retry (no events,
        // no truncation routing) — the advertisement honors the toggle.
        reliability: (() => {
          const rel = getEnvelopeReliabilityConfig();
          if (!rel.endToEndEnabled) {
            return {
              supported: true,
              events: [],
              maxRetryAttempts: rel.maxRetryAttempts,
              completion: {
                distinguishesTruncation: false,
                truncationBudgetMultiplier: rel.truncationBudgetMultiplier,
              },
            };
          }
          return {
            supported: true,
            events: [
              'envelope.retry.attempted',
              'envelope.retry.exhausted',
              'envelope.refusal',
              'envelope.truncated',
              'envelope.recovery.applied',
              'envelope.nlToFormat.engaged',
            ],
            maxRetryAttempts: rel.maxRetryAttempts,
            completion: {
              distinguishesTruncation: true,
              truncationBudgetMultiplier: rel.truncationBudgetMultiplier,
            },
          };
        })(),
      },
      // RFC 0031 §E. The executor evaluates `NodeModule.requiredModelCapabilities`
      // at dispatch-time against the host's configured default provider AND
      // emits `model.capability.{substituted,insufficient}` events per
      // RFC 0031 §D. `substitutionSupported: false` by default — the
      // sample's `dispatchPlain()` doesn't yet intercept per-call provider
      // selection; operators that wire the interception set
      // OPENWOP_MODEL_CAPABILITY_SUBSTITUTION=true. `advertised[]` is the
      // union of capabilities the host knows each provider in
      // `aiProviders.supported[]` offers (per `host/modelCapabilityProbe.ts`).
      modelCapabilities: (() => {
        const cfg = getModelCapabilityGateConfig();
        return {
          supported: cfg.supported,
          advertised: cfg.advertised,
          substitutionSupported: cfg.substitutionSupported,
        };
      })(),
      // `supported: false` — no standard four-op MemoryAdapter; this demo
      // only does host-internal run-summary writes + the read-side
      // (GET /v1/host/sample/memory). RFC 0057: it DOES attribute those
      // writes via the content-free `memory.written` event, so it advertises
      // attribution independently of the adapter contract.
      // RFC 0012 — compaction. The host distills its internal longTerm
      // entries into one SR-1-redacted archive + emits `memory.compacted`,
      // but the ONLY trigger is the `/v1/test/memory/{seed,compact}` seam
      // (gated on OPENWOP_TEST_TRIGGER_COMPACTION) — there is no automatic
      // host-managed or production client trigger. So advertise compaction
      // ONLY when that seam is reachable, never on a default deploy.
      memory: {
        supported: false,
        attribution: { supported: true, emitsWriteEvents: true },
        ...(compactionEnabled ? { compaction: { supported: true, trigger: 'both' } } : {}),
      },
      // RFC 0023 §B.2 — capabilities.conformance.mockAgent. Reference
      // host registers core.conformance.mock-agent unconditionally
      // (see bootstrap/conformanceMockAgent.ts). Production deployments
      // of this codebase SHOULD remove the registration call AND set
      // this to false.
      conformance: { mockAgent: true },
      // RFC 0025 — test-mode mirror namespace advertisement. The
      // /v1/packs-test/* routes (routes/packs-test.ts) only mount when
      // OPENWOP_PACKS_TEST_NAMESPACE_ENABLED=true; we advertise the
      // capability only when the seam is mounted, so a conformance
      // suite that finds the advertisement is guaranteed to find
      // serving endpoints. The reference impl persists test-mode packs
      // to a module-scoped in-memory Map distinct from the production
      // catalog (which the reference doesn't even ship — production
      // pack storage is delegated to packs.openwop.dev), so the §C
      // isolation guarantee holds trivially. `catalogResetEndpoint`
      // points at POST /v1/packs-test/reset for suite teardown.
      ...(process.env.OPENWOP_PACKS_TEST_NAMESPACE_ENABLED === 'true'
        ? {
            packs: {
              testMode: {
                supported: true,
                isolated: true,
                catalogResetEndpoint: '/v1/packs-test/reset',
                scopes: ['core', 'vendor', 'community'] as const,
              },
            },
          }
        : {}),
      webhooks: { supported: true, signed: true, durable: false },
      observability: {
        otel: { namespace: 'openwop' },
        // RFC 0034 — OTel collector test seam advertisement. The two test
        // endpoints (GET /v1/host/sample/test/otel/spans and POST
        // /v1/host/sample/test/debug-bundle/export) live in routes/testSeam.ts
        // and only mount when OPENWOP_TEST_SEAM_ENABLED=true. We advertise the
        // capability only when the seam is mounted, so a conformance suite
        // that finds the advertisement is guaranteed to find serving endpoints.
        // Hosts that don't enable the seam advertise nothing here; the
        // envelope-reasoning-secret-redaction scenario's downstream-projection
        // assertions then soft-skip per spec/v1/observability.md §"OTel
        // collector test seam (RFC 0034)".
        ...(process.env.OPENWOP_TEST_SEAM_ENABLED === 'true'
          ? { testSeams: { otelScrape: true, debugBundleExport: true } }
          : {}),
      },
      // RFC 0035 — sandbox-vm MVP advertisement. The node:vm-based
      // sandbox executes synthetic misbehaving packs via the
      // POST /v1/host/sample/test/sandbox-{load,invoke} seams in
      // routes/testSeam.ts. Advertised only when OPENWOP_TEST_SANDBOX_MVP=true
      // is set — the MVP is conformance-only (production deployments use
      // wasmtime/nsjail for real isolation).
      //
      // The MVP proves 5 of 8 RFC 0035 §B failure-mode invariants by
      // construction:
      //   - host-fs-escape, host-env-leak, network-escape, host-process-escape
      //     (node:vm context omits these globals → access throws)
      //   - sandbox-timeout (vm.runInNewContext timeout option)
      // The other 3 invariants either require a JS-runtime-specific test
      // (sandbox-no-eval), graduate by construction (cross-pack-mutation —
      // each invocation gets a fresh context), or need the host's
      // allowedHostCalls config (capability-gate-respected — implemented
      // via the Proxy host object).
      ...(process.env.OPENWOP_TEST_SANDBOX_MVP === 'true'
        ? {
            sandbox: {
              supported: true,
              isolationModel: 'vm' as const,
              wallClockLimitMs: 1000,
              memoryLimitBytes: 16 * 1024 * 1024,
              allowedHostCalls: ['fetch'] as const,
            },
          }
        : {}),
      // RFC 0037 Phase 1 — multi-agent execution model + handoff state
      // machine. Env-gated so the reference workflow-engine advertises
      // the capability only when the operator opts in; otherwise the
      // existing RFC 0007/0022 dispatch loop runs without emitting
      // `core.workflowChain.event` records (preserving the
      // pre-RFC-0037 wire surface for back-compat). When advertised,
      // every supervisor-driven `core.dispatch` invocation emits the
      // 7 handoff state-machine transition events per
      // `spec/v1/multi-agent-execution.md` §"Handoff state machine".
      // RFC 0037 Phase 1 = version 1; RFC 0039 Phase 2 = version 2. Operator
      // env-flags select the implemented ceiling: setting
      // OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_2=true requires
      // OPENWOP_MULTI_AGENT_EXECUTION_MODEL=true too (Phase 2 builds on Phase
      // 1). The confidenceEscalationFloor advertisement defaults to 0.5
      // (the spec floor) and can be tightened via
      // OPENWOP_MULTI_AGENT_CONFIDENCE_FLOOR=<n> per RFC 0039 §A.
      // When NEITHER phase env-flag is set, the `multiAgent` block is
      // OMITTED entirely — advertising `{supported: false, version: 1}` is
      // honest-but-confusing ("version 1 of an unimplemented feature"); the
      // capabilities.schema.json makes the block optional precisely so
      // non-implementers can stay silent. Capability-gated conformance
      // scenarios soft-skip on absence per the existing convention.
      ...(process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL === 'true'
        ? (() => {
            // RFC 0061 — version 5 (stateful agent-loop lifecycle). Ladder is
            // additive: phase5 ⇒ phase4 ⇒ … ⇒ phase1. A `version: 5`
            // advertisement is only honest when the re-entrant loop with the
            // observable per-turn `iteration` counter (host/agentLoop.ts) +
            // statefulResume are implemented.
            // `phase5` is hoisted at the buildAdvertisement scope (also gates
            // limits.maxLoopIterations); reuse it here.
            const phase4 = process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4 === 'true' || phase5;
            // The execution-model ladder is ADDITIVE: a host advertising
            // version N MUST implement phases 1..N (capabilities.schema.json
            // §multiAgent.executionModel.version). So a higher phase implies
            // every lower phase — phase4 ⇒ phase3 ⇒ phase2 ⇒ phase1. RFC 0040
            // Phase 3 (cross-host causation) is the rung between confidence
            // escalation (Phase 2) and replay determinism (Phase 4); a
            // `version: 4` advertisement is only honest when Phase 3 is
            // implemented too (the ancestry endpoint + crossHostCausation).
            const phase3 = isPhase3Enabled();
            const phase2 = process.env.OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_2 === 'true' || phase3;
            const floorRaw = process.env.OPENWOP_MULTI_AGENT_CONFIDENCE_FLOOR;
            const floor = (() => {
              const parsed = floorRaw === undefined ? 0.5 : Number(floorRaw);
              if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 1.0) return 0.5;
              return parsed;
            })();
            // Version advertisement is the ceiling of phases the host
            // implements per RFCS/0037-multi-agent-execution-model.md §"Phases".
            const version = phase5 ? 5 : phase4 ? 4 : phase3 ? 3 : phase2 ? 2 : 1;
            return {
              multiAgent: {
                executionModel: {
                  supported: true,
                  version,
                  ...(phase2 ? { confidenceEscalationFloor: floor } : {}),
                  // RFC 0040 §D — cross-host causation. A host advertising
                  // version >= 3 MUST advertise this sub-block with
                  // `supported: true` + a stable `hostId`; this host also
                  // serves `GET /v1/runs/{runId}/ancestry` (Phase-3 §C).
                  ...(phase3
                    ? {
                        crossHostCausation: {
                          supported: true,
                          hostId: CROSS_HOST_CAUSATION_HOST_ID,
                          ancestryEndpointSupported: true,
                        },
                      }
                    : {}),
                  // RFC 0041 §D — replayDeterminism advertisement. Hosts
                  // advertising `version: 4` MUST advertise this sub-block
                  // with `supported: true` and
                  // `refusalDivergenceEmission: true`. The LLM cache-key
                  // recipe is the spec-canonical
                  // `spec-rfc-0041` for the reference impl.
                  ...(phase4
                    ? {
                        replayDeterminism: {
                          supported: true,
                          llmCacheKeyRecipe: 'spec-rfc-0041',
                          refusalDivergenceEmission: true,
                        },
                      }
                    : {}),
                  // RFC 0061 §A/§D — version 5: a clarify/escalate suspend
                  // resumes the loop at the same iteration with the snapshot
                  // lineage + iteration counter intact (host/agentLoop.ts).
                  ...(phase5 ? { statefulResume: true } : {}),
                },
              },
            };
          })()
        : {}),
      runtimeCapabilities: listCapabilities(),
      // Host surface registry — what `ctx.*` surfaces this host wires.
      // The catalog endpoint cross-references this to mark each node
      // as runnable-here or "needs host.X".
      hostSurfaces: listHostSurfaces(),
      // RFC 0014 — host.fs capability block (canonical spec shape).
      // Mirrors the host-surface-registry advertisement so generic
      // openwop clients can read the standard shape from
      // `capabilities.fs.{supported,sandboxRoot,maxFileSizeBytes}`.
      fs: (() => {
        const root = getFsSandboxRoot();
        if (!root) return { supported: false };
        return {
          supported: true,
          sandboxRoot: root,
          maxFileSizeBytes: 50 * 1024 * 1024, // 50 MiB
        };
      })(),
      // RFC 0015 — host.kvStorage. In-memory adapter advertises full
      // surface; restart wipes state.
      kvStorage: {
        supported: true,
        maxKeyBytes: 1024,
        maxValueBytes: 1024 * 1024, // 1 MiB
        maxTtlSeconds: 7 * 24 * 60 * 60, // 7 days
        atomicIncrement: true,
        compareAndSwap: true,
      },
      // RFC 0016 — host.tableStorage.
      tableStorage: {
        supported: true,
        maxRowsPerTable: 100000,
        maxColumnsPerRow: 128,
        indexable: false,
        fullTextSearch: false,
      },
      // RFC 0017 — host.queueBus. Demo backend; in-memory pub/sub.
      queueBus: {
        supported: true,
        backends: ['in-memory'] as const,
        deadLetterSupported: true,
        stream: { supported: false, fromBeginning: false },
      },
      // RFC 0018 — host.sql via sqlite-in-memory.
      sql: {
        supported: true,
        transactions: true,
        drivers: ['sqlite'] as const,
      },
      // RFC 0018 — host.vectorStore via brute-force cosine over in-memory Map.
      vectorStore: {
        supported: true,
        backends: ['in-memory'] as const,
      },
      // RFC 0019 — host.blobStorage. presign() returns a synthetic data: URL.
      blobStorage: {
        supported: true,
        presignSupported: true,
        maxObjectBytes: 50 * 1024 * 1024, // 50 MiB
      },
      // RFC 0019 — host.cache.
      cache: {
        supported: true,
        maxValueBytes: 1024 * 1024, // 1 MiB
        maxTtlSeconds: 24 * 60 * 60, // 24 hours
      },
      // RFC 0020 — host-side MCP server composition. Sample host
      // exposes workflows as MCP tools/resources/prompts when
      // OPENWOP_MCP_SERVER_ENABLED=true. Endpoint:
      // POST /v1/host/sample/mcp (sample-vendor-namespaced).
      //
      // Wire shape (per spec/v1/mcp-integration.md §"Conformance +
      // interop"): a top-level `mcp` slot with `supported: boolean`
      // and (when supported) `serverUrls: string[]`. Sample-specific
      // detail (transports, sampling/elicitation bridges) lives
      // under `mcp.serverMount` so it's namespaced without breaking
      // the canonical discoverability contract.
      mcp: process.env.OPENWOP_MCP_SERVER_ENABLED === 'true'
        ? {
            supported: true,
            serverUrls: ['/v1/host/sample/mcp'],
            serverMount: {
              supported: true,
              transports: ['streamable-http'] as const,
              samplingBridge: true,
              elicitationBridge: true,
            },
          }
        : {
            supported: false,
            serverUrls: [],
            serverMount: { supported: false },
          },
    },
    extensions: {
      // Sample-namespace extensions block. Clients tolerate absence.
      'sample.notes': 'This is the openwop reference application sample. Not production-hardened.',
    },
  };
  // RFC 0073 — capability families are document-root properties of the
  // discovery response (capabilities.schema.json roots agents/secrets/etc.;
  // there is no `capabilities` wrapper property). Emit them at the root
  // canonically, and retain the nested `capabilities` object as a DEPRECATED
  // backward-compat mirror for the v1.x migration window (removed once
  // consumers migrate — see spec/v1/capabilities.md §"Document-root layout").
  // No family key collides with a root field, so the spread is order-safe.
  return { ...advertisement, ...advertisement.capabilities };
}
