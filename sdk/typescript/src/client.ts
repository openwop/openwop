/**
 * OpenwopClient — typed HTTP client for the openwop REST surface.
 *
 * Hand-authored. Each method maps 1:1 to a documented endpoint in
 * ../../api/openapi.yaml. Request/response types live in ./types.ts.
 *
 * Auth: a single bearer-style API key, supplied at construction. See
 * ../../auth.md for credential format.
 */

import { streamEvents, type EventsStreamOptions } from './sse.js';
import {
  WopError,
  type AuditVerifyResult,
  type BulkCancelRunsRequest,
  type BulkCancelRunsResponse,
  type Capabilities,
  type CancelRunRequest,
  type CancelRunResponse,
  type CreateRunRequest,
  type CreateRunResponse,
  type ErrorEnvelope,
  type ForkRunRequest,
  type ForkRunResponse,
  type Annotation,
  type CreateAnnotationRequest,
  type WorkspaceFile,
  type PutWorkspaceFileRequest,
  type GetPromptRequest,
  type InterruptByTokenInspection,
  type DebugBundle,
  type DebugBundleOptions,
  type ListPromptsRequest,
  type ListPromptsResponse,
  type PromptTemplate,
  type RegisterWebhookRequest,
  type RegisterWebhookResponse,
  type PauseRunRequest,
  type PauseRunResponse,
  type PollEventsResponse,
  type RenderPromptRequest,
  type RenderPromptResponse,
  type ResolveInterruptByTokenResponse,
  type ResolveInterruptRequest,
  type ResolveInterruptResponse,
  type ResumeRunRequest,
  type ResumeRunResponse,
  type RunAncestryResponse,
  type RunDiffResponse,
  type RunEventDoc,
  type RunSnapshot,
  type AgentInventoryEntry,
  type AgentInventoryResponse,
  type CreateUserAgentRequest,
  type UserAgentRecord,
  type AgentPackRegistryResponse,
  type InstallAgentPackRequest,
  type InstallAgentPackResponse,
} from './types.js';

export interface OpenwopClientOptions {
  /** Base URL of the openwop server, e.g., `https://api.example.com`. Trailing slash optional. */
  readonly baseUrl: string;
  /** API key (bearer-style). See auth.md. */
  readonly apiKey: string;
  /** Optional fetch implementation override (test injection). Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Default `Accept-Language` to send. Optional. */
  readonly acceptLanguage?: string;
}

export interface MutationOptions {
  /** RFC-spec'd Idempotency-Key for at-most-once mutation semantics. */
  readonly idempotencyKey?: string;
  /** Optional X-Dedup hint for cross-host claim coordination on POST /v1/runs. */
  readonly dedup?: 'enforce';
}

interface RawRequestOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export class OpenwopClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #acceptLanguage: string | undefined;

  constructor(opts: OpenwopClientOptions) {
    if (!opts.baseUrl) throw new TypeError('OpenwopClient: baseUrl is required');
    if (!opts.apiKey) throw new TypeError('OpenwopClient: apiKey is required');
    this.#baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? fetch;
    this.#acceptLanguage = opts.acceptLanguage;
  }

  // ── Discovery ────────────────────────────────────────────────────────
  readonly discovery = {
    capabilities: (): Promise<Capabilities> =>
      this.#request<Capabilities>({ method: 'GET', path: '/.well-known/openwop' }, false),

    openapi: (): Promise<unknown> =>
      this.#request<unknown>({ method: 'GET', path: '/v1/openapi.json' }, false),
  };

  // ── Workflows ────────────────────────────────────────────────────────
  readonly workflows = {
    get: (workflowId: string): Promise<unknown> =>
      this.#request<unknown>({
        method: 'GET',
        path: `/v1/workflows/${encodeURIComponent(workflowId)}`,
      }),
  };

  // ── Runs ─────────────────────────────────────────────────────────────
  readonly runs = {
    create: (body: CreateRunRequest, opts: MutationOptions = {}): Promise<CreateRunResponse> =>
      this.#request<CreateRunResponse>({
        method: 'POST',
        path: '/v1/runs',
        body,
        headers: this.#mutationHeaders(opts),
      }),

    get: (runId: string): Promise<RunSnapshot> =>
      this.#request<RunSnapshot>({
        method: 'GET',
        path: `/v1/runs/${encodeURIComponent(runId)}`,
      }),

    /**
     * Fetch the portable JSON diagnostic export for a single run per
     * `spec/v1/debug-bundle.md`. The bundle's `redactionMode` reflects
     * the host's advertised `capabilities.compliance.defaultMode`; the
     * caller MUST treat masked/omitted/hashed fields as the
     * spec-canonical value. The `truncated` + `truncatedReason` fields
     * indicate the host hit its size cap.
     *
     * Returns `null` when the host doesn't advertise
     * `capabilities.debugBundle.supported: true` (the endpoint returns
     * 404 in that case per `debug-bundle.md` §"Authorization").
     */
    debugBundle: async (runId: string, opts: DebugBundleOptions = {}): Promise<DebugBundle | null> => {
      const params = new URLSearchParams();
      if (opts.maxEvents !== undefined) params.set('maxEvents', String(opts.maxEvents));
      const query = params.toString();
      const path = `/v1/runs/${encodeURIComponent(runId)}/debug-bundle${query ? `?${query}` : ''}`;
      try {
        return await this.#request<DebugBundle>({ method: 'GET', path });
      } catch (err) {
        // Host doesn't advertise the capability → 404. Surface as null so callers
        // can branch on capability discovery without try/catch.
        if (err instanceof Error && /\b404\b/.test(err.message)) return null;
        throw err;
      }
    },

    cancel: (
      runId: string,
      body: CancelRunRequest = {},
      opts: MutationOptions = {},
    ): Promise<CancelRunResponse> =>
      this.#request<CancelRunResponse>({
        method: 'POST',
        path: `/v1/runs/${encodeURIComponent(runId)}/cancel`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    pause: (
      runId: string,
      body: PauseRunRequest = {},
      opts: MutationOptions = {},
    ): Promise<PauseRunResponse> =>
      this.#request<PauseRunResponse>({
        method: 'POST',
        path: `/v1/runs/${encodeURIComponent(runId)}:pause`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    resume: (
      runId: string,
      body: ResumeRunRequest = {},
      opts: MutationOptions = {},
    ): Promise<ResumeRunResponse> =>
      this.#request<ResumeRunResponse>({
        method: 'POST',
        path: `/v1/runs/${encodeURIComponent(runId)}:resume`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * Bulk-cancel a set of in-flight runs in a single request per
     * `rest-endpoints.md` §"POST /v1/runs:bulk-cancel" (closes R1).
     * The top-level call returns 200 + per-id `results[]` whenever the
     * request reaches the host; partial failures surface inside the
     * array (each entry carries `ok: boolean` + optional `error`). Host-
     * defined cap on `runIds[]` length (RECOMMENDED 100); over-cap
     * returns `400 validation_error` with `details.maxRunIds`.
     */
    bulkCancel: (
      body: BulkCancelRunsRequest,
      opts: MutationOptions = {},
    ): Promise<BulkCancelRunsResponse> =>
      this.#request<BulkCancelRunsResponse>({
        method: 'POST',
        path: '/v1/runs:bulk-cancel',
        body,
        headers: this.#mutationHeaders(opts),
      }),

    fork: (
      runId: string,
      body: ForkRunRequest,
      opts: MutationOptions = {},
    ): Promise<ForkRunResponse> =>
      this.#request<ForkRunResponse>({
        method: 'POST',
        path: `/v1/runs/${encodeURIComponent(runId)}:fork`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * RFC 0056 — record a non-blocking quality annotation (rating / correction
     * / label / flag) on a run/event/node. Returns the persisted `Annotation`.
     * Throws on non-2xx (`501` when the host doesn't advertise
     * `capabilities.feedback.supported`).
     */
    createAnnotation: (
      runId: string,
      body: CreateAnnotationRequest,
      opts: MutationOptions = {},
    ): Promise<Annotation> =>
      this.#request<Annotation>({
        method: 'POST',
        path: `/v1/runs/${encodeURIComponent(runId)}/annotations`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * RFC 0056 — list a run's annotations (tenant-scoped). Returns `null` when
     * the host doesn't advertise `capabilities.feedback` (404/501), so callers
     * can branch on capability discovery without try/catch.
     */
    listAnnotations: async (runId: string): Promise<readonly Annotation[] | null> => {
      try {
        const res = await this.#request<{ annotations: Annotation[] }>({
          method: 'GET',
          path: `/v1/runs/${encodeURIComponent(runId)}/annotations`,
        });
        return res.annotations;
      } catch (err) {
        if (err instanceof Error && /\b(404|501)\b/.test(err.message)) return null;
        throw err;
      }
    },

    /**
     * RFC 0040 §C — fetch the run's immediate parent in the cross-host
     * composition chain. Returns `parent: null` for top-level runs;
     * `parent.wellKnownUrl` is set when the parent is on a different
     * host, so callers walk the chain one hop at a time.
     *
     * Returns `null` when the host doesn't advertise
     * `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported: true`
     * (the endpoint returns 404 in that case per
     * `spec/v1/multi-agent-execution.md` §"GET /v1/runs/{runId}/ancestry").
     */
    ancestry: async (runId: string): Promise<RunAncestryResponse | null> => {
      try {
        return await this.#request<RunAncestryResponse>({
          method: 'GET',
          path: `/v1/runs/${encodeURIComponent(runId)}/ancestry`,
        });
      } catch (err) {
        if (err instanceof Error && /\b404\b/.test(err.message)) return null;
        throw err;
      }
    },

    /**
     * RFC 0054 — deterministic, replay-aware structured diff of two runs
     * (typically a run and its `:fork`). Requires `runs:read` on BOTH
     * `runId` and `against`. Returns `null` when the host doesn't
     * implement the endpoint (404 per `spec/v1/rest-endpoints.md`
     * §`GET /v1/runs/{runId}:diff`). `divergedAtSeq` is null + `eventDiffs`
     * empty when the two logs are identical.
     */
    diff: async (runId: string, against: string): Promise<RunDiffResponse | null> => {
      try {
        return await this.#request<RunDiffResponse>({
          method: 'GET',
          path: `/v1/runs/${encodeURIComponent(runId)}:diff?against=${encodeURIComponent(against)}`,
        });
      } catch (err) {
        if (err instanceof Error && /\b404\b/.test(err.message)) return null;
        throw err;
      }
    },

    pollEvents: (
      runId: string,
      params: { lastSequence?: number; timeoutSeconds?: number } = {},
    ): Promise<PollEventsResponse> => {
      const search = new URLSearchParams();
      if (params.lastSequence !== undefined) {
        search.set('lastSequence', String(params.lastSequence));
      }
      if (params.timeoutSeconds !== undefined) {
        search.set('timeout', String(params.timeoutSeconds));
      }
      const qs = search.toString();
      return this.#request<PollEventsResponse>({
        method: 'GET',
        path: `/v1/runs/${encodeURIComponent(runId)}/events/poll${qs ? `?${qs}` : ''}`,
      });
    },

    /**
     * Async-iterable SSE consumer. The connection auto-closes when the
     * server closes the stream (terminal run event); break out of the
     * loop or call `signal.abort()` to terminate early.
     */
    events: (runId: string, opts: EventsStreamOptions = {}): AsyncGenerator<RunEventDoc, void, void> =>
      streamEvents({ baseUrl: this.#baseUrl, apiKey: this.#apiKey }, runId, opts),
  };

  // ── Manifest-agent inventory (RFC 0072 §A) ───────────────────────────
  // Read-only. Gated on `capabilities.agents.manifestRuntime`; both methods
  // return `null` when the host doesn't advertise it (the endpoints 404).
  // Dispatch is not here: a manifest agent runs as a `runs.create` whose
  // workflow node pins it via `WorkflowNode.agent` (RFC 0072 §B).
  readonly agents = {
    list: async (): Promise<AgentInventoryResponse | null> => {
      try {
        return await this.#request<AgentInventoryResponse>({ method: 'GET', path: '/v1/agents' });
      } catch (err) {
        if (err instanceof Error && /\b404\b/.test(err.message)) return null;
        throw err;
      }
    },

    get: async (agentId: string): Promise<AgentInventoryEntry | null> => {
      try {
        return await this.#request<AgentInventoryEntry>({
          method: 'GET',
          path: `/v1/agents/${encodeURIComponent(agentId)}`,
        });
      } catch (err) {
        if (err instanceof Error && /\b404\b/.test(err.message)) return null;
        throw err;
      }
    },
  };

  // ── User-authored agents (sample-extension; non-normative) ───────────
  // Backs the workflow-engine sample app's Agents tab. Pack-installed
  // agents come through the `.agents` inventory above (RFC 0072 §A).
  // These methods wrap the `POST/DELETE /v1/host/sample/agents` +
  // `GET/POST /v1/host/sample/registry/agent-packs` host extensions.
  // Returns `null` on 404 (capability absent — matches the `.agents`
  // surface pattern); throws on other failures.
  readonly userAgents = {
    create: async (body: CreateUserAgentRequest, opts: MutationOptions = {}): Promise<UserAgentRecord> => {
      return await this.#request<UserAgentRecord>({
        method: 'POST',
        path: '/v1/host/sample/agents',
        body,
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      });
    },

    delete: async (agentId: string): Promise<boolean> => {
      try {
        await this.#request<void>({
          method: 'DELETE',
          path: `/v1/host/sample/agents/${encodeURIComponent(agentId)}`,
        });
        return true;
      } catch (err) {
        if (err instanceof Error && /\b404\b/.test(err.message)) return false;
        throw err;
      }
    },

    listAvailablePacks: async (): Promise<AgentPackRegistryResponse | null> => {
      try {
        return await this.#request<AgentPackRegistryResponse>({
          method: 'GET',
          path: '/v1/host/sample/registry/agent-packs',
        });
      } catch (err) {
        if (err instanceof Error && /\b404\b/.test(err.message)) return null;
        throw err;
      }
    },

    installPack: async (
      body: InstallAgentPackRequest,
    ): Promise<InstallAgentPackResponse> => {
      return await this.#request<InstallAgentPackResponse>({
        method: 'POST',
        path: '/v1/host/sample/registry/agent-packs/install',
        body,
      });
    },
  };

  // ── HITL interrupts (run-scoped + signed-token) ──────────────────────
  readonly interrupts = {
    resolveByRun: (
      runId: string,
      nodeId: string,
      body: ResolveInterruptRequest,
      opts: MutationOptions = {},
    ): Promise<ResolveInterruptResponse> =>
      this.#request<ResolveInterruptResponse>({
        method: 'POST',
        path: `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(nodeId)}`,
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * Inspect an interrupt via signed token — useful for showing the
     * interrupt's `kind`, `data`, and `resumeSchema` to a downstream
     * UI before the user resolves. Token is the auth, no API key
     * required (signed-token endpoints intentionally bypass bearer
     * auth so external systems can resolve without openwop credentials).
     */
    inspectByToken: (token: string): Promise<InterruptByTokenInspection> =>
      this.#request<InterruptByTokenInspection>(
        {
          method: 'GET',
          path: `/v1/interrupts/${encodeURIComponent(token)}`,
        },
        false, // unauthenticated (token IS the auth)
      ),

    /**
     * Resolve an interrupt via signed token — used by external
     * systems (calendar webhooks, payment confirmations) that the
     * engine handed a callback URL at suspension time.
     */
    resolveByToken: (
      token: string,
      body: ResolveInterruptRequest,
      opts: MutationOptions = {},
    ): Promise<ResolveInterruptByTokenResponse> =>
      this.#request<ResolveInterruptByTokenResponse>(
        {
          method: 'POST',
          path: `/v1/interrupts/${encodeURIComponent(token)}`,
          body,
          headers: this.#mutationHeaders(opts),
        },
        false, // unauthenticated (token IS the auth)
      ),
  };

  // ── Webhook subscriptions (per spec/v1/webhooks.md) ─────────────────────
  readonly webhooks = {
    /**
     * Register a webhook subscription. Server signs deliveries with
     * HMAC-SHA256 over `${timestamp}.${rawBody}` using the
     * registration-time secret per `spec/v1/webhooks.md` §"Signature
     * recipe". The secret is returned ONCE in the response — store it
     * server-side for verification; the host cannot recover it.
     */
    register: (
      body: RegisterWebhookRequest,
      opts: MutationOptions = {},
    ): Promise<RegisterWebhookResponse> =>
      this.#request<RegisterWebhookResponse>({
        method: 'POST',
        path: '/v1/webhooks',
        body,
        headers: this.#mutationHeaders(opts),
      }),

    /**
     * Unregister a webhook subscription. Returns void on success;
     * throws `WopError` with `subscription_not_found` on unknown
     * subscriptionId.
     */
    unregister: async (subscriptionId: string): Promise<void> => {
      await this.#request<unknown>({
        method: 'DELETE',
        path: `/v1/webhooks/${encodeURIComponent(subscriptionId)}`,
      });
    },
  };

  // ── Prompt library (RFC 0028; gated on capabilities.prompts.*) ──
  //
  // Read endpoints (list, get, render) gate on
  // `capabilities.prompts.endpointsSupported: true`. Mutating endpoints
  // (create, update, delete) additionally require
  // `capabilities.prompts.mutableLibrary: true`. Hosts that don't advertise
  // the relevant capability return `501 capability_not_provided`; the SDK
  // surfaces that as a `WopError`. Clients SHOULD pre-flight via
  // `getCapabilities()` before calling.
  //
  // NOTE: `capabilities.prompts.supported: true` (without
  // `endpointsSupported: true`) ONLY gates node-execution PromptRef
  // resolution per RFC 0027 Phase A; it does NOT imply these endpoints are
  // available. See spec/v1/prompts.md §"Capability advertisement" for the
  // two-axis gating split.
  readonly prompts = {
    /**
     * List prompt templates available to the caller per RFC 0028 §A
     * (operationId `listPromptTemplates`). Supports kind / tag / modelClass
     * / source filters + opaque cursor pagination.
     */
    list: (req: ListPromptsRequest = {}): Promise<ListPromptsResponse> => {
      const search = new URLSearchParams();
      if (req.kind) search.set('kind', req.kind);
      if (req.tag) search.set('tag', req.tag);
      if (req.modelClass) search.set('modelClass', req.modelClass);
      if (req.source) search.set('source', req.source);
      if (req.cursor) search.set('cursor', req.cursor);
      if (req.limit !== undefined) search.set('limit', String(req.limit));
      const query = search.toString();
      return this.#request<ListPromptsResponse>({
        method: 'GET',
        path: `/v1/prompts${query ? `?${query}` : ''}`,
      });
    },

    /**
     * Fetch a single PromptTemplate by id per RFC 0028 §A
     * (operationId `getPromptTemplate`). Optionally pin a SemVer
     * `version`; supply `libraryId` to disambiguate when multiple installed
     * packs ship the same templateId.
     */
    get: (req: GetPromptRequest): Promise<PromptTemplate> => {
      const search = new URLSearchParams();
      if (req.version) search.set('version', req.version);
      if (req.libraryId) search.set('libraryId', req.libraryId);
      const query = search.toString();
      return this.#request<PromptTemplate>({
        method: 'GET',
        path: `/v1/prompts/${encodeURIComponent(req.templateId)}${query ? `?${query}` : ''}`,
      });
    },

    /**
     * Render a PromptTemplate with supplied variable bindings per RFC 0028
     * §A (operationId `renderPromptTemplate`). Returns composed body +
     * sha256 hash + per-variable hashes. The deterministic-hash invariant
     * (RFC 0028 §A) requires the `hash` to match what a matching
     * `prompt.composed` event would carry at dispatch time. Does NOT
     * dispatch an LLM call. Secret-source variable values MUST be supplied
     * as `[REDACTED:<credentialRef>]` markers per
     * SECURITY/threat-model-secret-leakage.md §SR-1.
     */
    render: (req: RenderPromptRequest): Promise<RenderPromptResponse> => {
      return this.#request<RenderPromptResponse>({
        method: 'POST',
        path: '/v1/prompts:render',
        body: req,
      });
    },

    /**
     * Create a new user-source PromptTemplate per RFC 0028 §A
     * (operationId `createPromptTemplate`). Mutating endpoint —
     * requires `capabilities.prompts.mutableLibrary: true`. Supports
     * `Idempotency-Key` per the standard `MutationOptions` pattern.
     */
    create: (template: PromptTemplate, opts: MutationOptions = {}): Promise<void> => {
      return this.#request<void>({
        method: 'POST',
        path: '/v1/prompts',
        body: template,
        headers: this.#mutationHeaders(opts),
      });
    },

    /**
     * Replace an existing user-source PromptTemplate per RFC 0028 §A
     * (operationId `updatePromptTemplate`). Submitted SemVer MUST be
     * strictly greater than stored. Mutating endpoint — requires
     * `capabilities.prompts.mutableLibrary: true`. Pack-sourced and
     * host-built-in templates are read-only (host returns 403).
     */
    update: (
      templateId: string,
      template: PromptTemplate,
      opts: MutationOptions = {},
    ): Promise<PromptTemplate> => {
      return this.#request<PromptTemplate>({
        method: 'PUT',
        path: `/v1/prompts/${encodeURIComponent(templateId)}`,
        body: template,
        headers: this.#mutationHeaders(opts),
      });
    },

    /**
     * Delete a user-source PromptTemplate per RFC 0028 §A
     * (operationId `deletePromptTemplate`). Mutating endpoint —
     * requires `capabilities.prompts.mutableLibrary: true`. Pack-sourced
     * and host-built-in templates are read-only (host returns 403).
     */
    delete: (templateId: string): Promise<void> => {
      return this.#request<void>({
        method: 'DELETE',
        path: `/v1/prompts/${encodeURIComponent(templateId)}`,
      });
    },
  };

  // ── Audit-log integrity (gated on openwop-audit-log-integrity profile) ──
  readonly audit = {
    /**
     * Verify the audit-log hash chain over `[fromSeq, toSeq]` per
     * `auth-profiles.md` §`openwop-audit-log-integrity` §4. Requires
     * the `audit:read` scope on the API key. Returns chain-validity
     * verdict + signed checkpoints + any detected anomalies.
     *
     * Hosts that do NOT advertise the profile return `404` and throw
     * a `WopError`. Clients SHOULD pre-flight via
     * `client.getCapabilities()` (or directly inspect
     * `capabilities.auth.profiles[]`) before calling.
     */
    verify: (fromSeq: number, toSeq: number): Promise<AuditVerifyResult> => {
      const search = new URLSearchParams();
      search.set('fromSeq', String(fromSeq));
      search.set('toSeq', String(toSeq));
      return this.#request<AuditVerifyResult>({
        method: 'GET',
        path: `/v1/audit/verify?${search.toString()}`,
      });
    },
  };

  // ── Agent workspace files (RFC 0059; gated on capabilities.workspace) ──
  readonly workspace = {
    /**
     * RFC 0059 — list workspace file metadata (no bodies) for the caller's
     * `{tenant, workspace}`. Optional `prefix` filters the flat `path`
     * namespace. Returns `null` when the host doesn't advertise
     * `capabilities.workspace.supported` (501), so callers can branch on
     * capability discovery without try/catch.
     */
    listFiles: async (opts: { prefix?: string } = {}): Promise<readonly WorkspaceFile[] | null> => {
      const search = new URLSearchParams();
      if (opts.prefix !== undefined) search.set('prefix', opts.prefix);
      const qs = search.toString();
      try {
        const res = await this.#request<{ files: WorkspaceFile[] }>({
          method: 'GET',
          path: `/v1/host/workspace/files${qs ? `?${qs}` : ''}`,
        });
        return res.files;
      } catch (err) {
        if (err instanceof Error && /\b501\b/.test(err.message)) return null;
        throw err;
      }
    },

    /**
     * RFC 0059 — read one workspace file. Pass `version` for a historical
     * snapshot when `capabilities.workspace.versioned`. Returns `null` when
     * the file is absent (404) or the host doesn't advertise the capability
     * (501).
     */
    getFile: async (path: string, opts: { version?: number } = {}): Promise<WorkspaceFile | null> => {
      const search = new URLSearchParams();
      if (opts.version !== undefined) search.set('version', String(opts.version));
      const qs = search.toString();
      try {
        return await this.#request<WorkspaceFile>({
          method: 'GET',
          path: `/v1/host/workspace/files/${encodeURIComponent(path)}${qs ? `?${qs}` : ''}`,
        });
      } catch (err) {
        if (err instanceof Error && /\b(404|501)\b/.test(err.message)) return null;
        throw err;
      }
    },

    /**
     * RFC 0059 — atomic create/replace of a workspace file. Pass `ifMatch`
     * (the file's current `etag`) for optimistic concurrency; a stale token
     * throws a `WopError` with status `409` (`workspace_conflict`). Content
     * beyond `capabilities.workspace.maxFileBytes` throws `413`
     * (`workspace_too_large`). Returns the persisted `WorkspaceFile`.
     */
    putFile: (
      path: string,
      body: PutWorkspaceFileRequest,
      opts: MutationOptions & { ifMatch?: string } = {},
    ): Promise<WorkspaceFile> => {
      const headers = this.#mutationHeaders(opts);
      if (opts.ifMatch !== undefined) headers['If-Match'] = opts.ifMatch;
      return this.#request<WorkspaceFile>({
        method: 'PUT',
        path: `/v1/host/workspace/files/${encodeURIComponent(path)}`,
        body,
        headers,
      });
    },

    /**
     * RFC 0059 — delete a workspace file. Returns `true` on success (`204`),
     * `false` when the file is absent (404) or the host doesn't advertise the
     * capability (501).
     */
    deleteFile: async (path: string, opts: MutationOptions = {}): Promise<boolean> => {
      try {
        await this.#request<void>({
          method: 'DELETE',
          path: `/v1/host/workspace/files/${encodeURIComponent(path)}`,
          headers: this.#mutationHeaders(opts),
        });
        return true;
      } catch (err) {
        if (err instanceof Error && /\b(404|501)\b/.test(err.message)) return false;
        throw err;
      }
    },
  };

  // ── Internals ────────────────────────────────────────────────────────
  #mutationHeaders(opts: MutationOptions): Record<string, string> {
    const h: Record<string, string> = {};
    if (opts.idempotencyKey) h['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.dedup) h['X-Dedup'] = opts.dedup;
    return h;
  }

  async #request<T>(opts: RawRequestOptions, authenticated = true): Promise<T> {
    const url = `${this.#baseUrl}${opts.path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      headers.Authorization = `Bearer ${this.#apiKey}`;
    }
    if (this.#acceptLanguage) {
      headers['Accept-Language'] = this.#acceptLanguage;
    }

    const init: RequestInit = { method: opts.method, headers };
    if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) {
      init.signal = opts.signal;
    }

    const res = await this.#fetch(url, init);
    const text = await res.text();
    // Capture traceparent for error reporting per observability.md
    // §Trace context propagation. Header name is case-insensitive per
    // RFC 9110; fetch normalizes to lowercase but be defensive.
    const traceparent =
      res.headers.get('traceparent') ?? res.headers.get('Traceparent') ?? undefined;

    if (!res.ok) {
      let env: ErrorEnvelope | undefined;
      try {
        const parsed = text.length > 0 ? JSON.parse(text) : undefined;
        if (parsed && typeof parsed === 'object' && 'error' in parsed && 'message' in parsed) {
          env = parsed as ErrorEnvelope;
        }
      } catch {
        // not JSON; leave envelope undefined
      }
      throw new WopError(res.status, text, env, traceparent);
    }

    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WopError(
        res.status,
        text,
        {
          error: 'invalid_json',
          message: 'Server returned non-JSON body for a 2xx response',
        },
        traceparent,
      );
    }
  }
}
