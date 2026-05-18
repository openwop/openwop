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

export async function forkRun(runId: string, req: ForkRunRequest): Promise<ForkRunResponse> {
  return client.runs.fork(runId, req);
}

export async function pollEvents(runId: string, lastSequence = 0): Promise<PollEventsResponse> {
  return client.runs.pollEvents(runId, { lastSequence });
}

/** Returns the underlying SDK client for surfaces not yet wrapped here. */
export function getSdkClient(): OpenwopClient {
  return client;
}
