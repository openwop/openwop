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
  type Capabilities,
  type CancelRunRequest,
  type CancelRunResponse,
  type CreateRunRequest,
  type CreateRunResponse,
  type ErrorEnvelope,
  type ForkRunRequest,
  type ForkRunResponse,
  type InterruptByTokenInspection,
  type PollEventsResponse,
  type ResolveInterruptByTokenResponse,
  type ResolveInterruptRequest,
  type ResolveInterruptResponse,
  type RunEventDoc,
  type RunSnapshot,
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
