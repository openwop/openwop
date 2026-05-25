/**
 * Thin run-lifecycle client. Wraps `OpenwopClient` from
 * `@openwop/openwop` for the surfaces the sample UI needs.
 *
 * If these wrappers prove broadly useful, promote them to a published
 * `@openwop/openwop-browser` package per the analysis plan §6.1.
 */

import { OpenwopClient } from '@openwop/openwop';
import type {
  Capabilities,
  CreateRunRequest,
  CreateRunResponse,
  ForkRunRequest,
  ForkRunResponse,
  MutationOptions,
  PollEventsResponse,
  RunSnapshot,
} from '@openwop/openwop';
import { authedHeaders, config } from './config.js';

// Pass an explicitly-bound `fetch` to work around an SDK bug — the
// client stores `opts.fetch ?? fetch` and later calls `this.#fetch(...)`,
// which strips the bound `this`. In Node that's harmless; browsers throw
// "Illegal invocation" because window.fetch refuses unbound calls.
// Filed-equivalent: @openwop/openwop v1.1.1 client.js:184. Safe to
// remove this workaround once the SDK lands `this.#fetch.call(globalThis, ...)`.
// In cookie auth mode we don't actually use the apiKey, but the SDK
// validates it as non-empty at construction. Pass a placeholder so
// `new OpenwopClient` succeeds, then strip the SDK-added
// `Authorization` header in the fetch wrapper before it hits the
// backend (the openwop.session cookie carries auth instead, rolling
// with `credentials: 'include'`).
const client = new OpenwopClient({
  baseUrl: config.baseUrl,
  apiKey: config.authMode === 'cookie' ? 'cookie-mode-placeholder' : config.apiKey,
  // Single fetch wrapper that handles all three auth modes
  // consistently with the rest of the SPA's clients:
  //   - Strip the SDK-injected Authorization (the placeholder)
  //   - Inject whatever authedHeaders() says we should send (cached
  //     Firebase ID token, or apiKey in bearer mode, or nothing in
  //     cookie mode)
  //   - In cookie or signed-in modes, attach credentials: 'include'
  //     so the session cookie travels for auth-fallback paths.
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.delete('Authorization');
    for (const [k, v] of Object.entries(authedHeaders())) {
      headers.set(k, v);
    }
    const cleanInit: RequestInit = { ...init, headers };
    if (config.authMode === 'cookie' || headers.has('authorization')) {
      cleanInit.credentials = 'include';
    }
    return globalThis.fetch(input, cleanInit);
  },
});

export interface RunListItem {
  runId: string;
  workflowId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
}

export async function getCapabilities(): Promise<Capabilities & Record<string, unknown>> {
  return (await client.discovery.capabilities()) as Capabilities & Record<string, unknown>;
}

/** Forwards an optional `MutationOptions` so callers can supply the
 *  `Idempotency-Key` (per spec/v1/idempotency.md Layer 1) and any other
 *  knob the SDK exposes on mutation requests (`dedup`, etc.). */
export async function createRun(
  req: CreateRunRequest,
  opts?: MutationOptions,
): Promise<CreateRunResponse> {
  return client.runs.create(req, opts);
}

export async function getRun(runId: string): Promise<RunSnapshot> {
  return client.runs.get(runId);
}

export async function cancelRun(runId: string, reason?: string): Promise<void> {
  await client.runs.cancel(runId, reason ? { reason } : {});
}

/** Permanently delete a run (host-extension `DELETE /v1/runs/{runId}`; not a
 *  v1 protocol surface). The SDK client has no delete method, so this is a
 *  raw fetch reusing the app's auth headers. 204 = deleted; 404 = already
 *  gone — both treated as success. */
export async function deleteRun(runId: string): Promise<void> {
  const res = await fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
    headers: { ...authedHeaders() },
    credentials: config.authMode === 'cookie' ? 'include' : 'same-origin',
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}

export async function forkRun(runId: string, req: ForkRunRequest): Promise<ForkRunResponse> {
  return client.runs.fork(runId, req);
}

/** Fetch the debug bundle for a run per `spec/v1/debug-bundle.md`.
 *  Routes through the published SDK's `client.runs.debugBundle()`
 *  (parity row SDK-4, closed 2026-05-15 — see `sdk/PARITY.md`).
 *  The SDK returns `null` when the host doesn't advertise
 *  `capabilities.debugBundle.supported: true`; we throw a typed error
 *  in that case so the calling button can surface a "not supported"
 *  message instead of saving a `null.json` file. */
export async function getDebugBundle(runId: string): Promise<Record<string, unknown>> {
  const bundle = await client.runs.debugBundle(runId);
  if (bundle === null) {
    throw new Error('Debug-bundle download is not supported by this host (capabilities.debugBundle.supported is not advertised).');
  }
  return bundle as unknown as Record<string, unknown>;
}

export async function pollEvents(runId: string, lastSequence = 0): Promise<PollEventsResponse> {
  return client.runs.pollEvents(runId, { lastSequence });
}

/**
 * List recent runs scoped to the authenticated tenant. The backend
 * derives the tenant from the bearer / cookie, so this client doesn't
 * need to pass a tenantId. Returns at most `limit` rows (default 50).
 */
export async function listMyRuns(opts: { status?: string; limit?: number } = {}): Promise<RunListItem[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit) params.set('limit', String(opts.limit));
  const query = params.toString();
  const url = `${config.baseUrl}/v1/runs${query ? `?${query}` : ''}`;
  const headers = authedHeaders({ accept: 'application/json' });
  const includeCreds = config.authMode === 'cookie' || Boolean(headers.authorization);
  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: includeCreds ? 'include' : 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`listMyRuns failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { runs: RunListItem[] };
  return body.runs;
}

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  expiresAt?: string;
}

/**
 * List the authenticated tenant's memory entries (RFC 0004 read-side, via
 * the host-extension `GET /v1/host/sample/memory`). Tenant is derived from
 * the bearer / cookie server-side (CTI-1). `memoryRef` defaults to the
 * demo's per-tenant namespace when omitted.
 */
export async function listMemory(
  opts: { memoryRef?: string; tag?: string; limit?: number } = {},
): Promise<{ memoryRef: string; entries: MemoryEntry[] }> {
  const params = new URLSearchParams();
  if (opts.memoryRef) params.set('memoryRef', opts.memoryRef);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.limit) params.set('limit', String(opts.limit));
  const query = params.toString();
  const url = `${config.baseUrl}/v1/host/sample/memory${query ? `?${query}` : ''}`;
  const headers = authedHeaders({ accept: 'application/json' });
  const includeCreds = config.authMode === 'cookie' || Boolean(headers.authorization);
  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: includeCreds ? 'include' : 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`listMemory failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { memoryRef: string; entries: MemoryEntry[] };
}

/** Returns the underlying SDK client for surfaces not yet wrapped here. */
export function getSdkClient(): OpenwopClient {
  return client;
}
