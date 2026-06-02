/**
 * `ctx.a2a` host surface — the A2A (Agent-to-Agent) client the
 * `core.openwop.a2a` pack delegates to (`spec/v1/a2a-integration.md`).
 *
 * The pack speaks no JSON-RPC directly; this surface owns transport. The
 * CLIENT methods (discoverAgent / sendMessage / sendAndStream / getTask /
 * listTasks / cancelTask / resubscribe / pushConfig.*) are a genuine A2A 0.3
 * JSON-RPC-over-HTTP client — point a node at any real A2A agent and it works.
 *
 * Wire-form note (`a2a-integration.md` §"Wire-shape spelling drift"): A2A 0.3
 * JSON-RPC uses lowercase-hyphen `TaskState` (`input-required`); the openwop
 * pack reasons over the UPPERCASE_UNDERSCORE form (`INPUT_REQUIRED`). This
 * surface normalizes inbound `status.state` to the UPPERCASE form so the pack's
 * multi-turn coordinator and reporters see the documented vocabulary.
 *
 * The SERVER-side methods (publishAgentCard / emitStatus / emitArtifact /
 * pushSend) are for a workflow exposed AS an A2A agent. The sample host is not
 * a live A2A server, so they are honest demo stubs — they accept the call so
 * the node runs, but a production A2A host would push to the connected client's
 * stream instead. The notes on `host.a2a` advertise this.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../observability/logger.js';
import type { BundleScope } from './inMemorySurfaces.js';

const log = createLogger('host.a2a');

const AGENT_CARD_PATHS = ['/.well-known/agent-card.json', '/.well-known/agent.json'];
const RPC_TIMEOUT_MS = 20_000;
const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED']);

type Json = Record<string, unknown>;

/** Normalize a wire `status.state` (`input-required`) to the pack's documented
 *  UPPERCASE_UNDERSCORE form (`INPUT_REQUIRED`). Handles a bare Task, a
 *  `tasks/list` envelope (`{ tasks: Task[] }`), and leaves non-Task results
 *  (e.g. a Message) untouched. */
function normalizeResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Json;
  // `tasks/list` envelope — normalize each task in the array.
  if (Array.isArray(r.tasks)) {
    return { ...r, tasks: r.tasks.map(normalizeResult) };
  }
  const status = r.status;
  if (status && typeof status === 'object' && typeof (status as Json).state === 'string') {
    const state = ((status as Json).state as string).toUpperCase().replace(/-/g, '_');
    return { ...r, status: { ...(status as Json), state } };
  }
  return result;
}

function isTerminal(task: unknown): boolean {
  const s = (task as Json | null)?.status as Json | undefined;
  return typeof s?.state === 'string' && TERMINAL_STATES.has(s.state as string);
}

/** Single A2A JSON-RPC call. Throws a host-shaped error on transport / RPC error. */
async function rpc(endpoint: string, method: string, params: Json): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (err) {
    throw Object.assign(new Error(`A2A ${method} transport error: ${err instanceof Error ? err.message : String(err)}`), { code: 'a2a_transport_error' });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`A2A ${method} returned HTTP ${res.status}`), { code: 'a2a_transport_error' });
  }
  const body = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string } };
  if (body.error) {
    throw Object.assign(new Error(`A2A ${method} error: ${body.error.message ?? 'unknown'}`), { code: 'a2a_remote_error', details: body.error });
  }
  return normalizeResult(body.result);
}

/** A2A streaming call (`message/stream` / `tasks/resubscribe`): POST JSON-RPC,
 *  read the SSE response, normalize + forward each event, return the terminal
 *  task (or the last event seen). */
async function rpcStream(
  endpoint: string,
  method: string,
  params: Json,
  onEvent: (event: unknown) => Promise<void> | void,
): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw Object.assign(new Error(`A2A ${method} stream returned HTTP ${res.status}`), { code: 'a2a_transport_error' });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let terminal: unknown = null;
  let last: unknown = null;

  const handleData = async (data: string): Promise<void> => {
    let parsed: { result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      return; // ignore non-JSON keepalive frames
    }
    if (parsed.error) throw Object.assign(new Error(`A2A ${method} stream error: ${parsed.error.message ?? 'unknown'}`), { code: 'a2a_remote_error' });
    const event = normalizeResult(parsed.result);
    last = event;
    await onEvent(event);
    if (isTerminal(event)) terminal = event;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    // SSE frames are separated by a blank line; each frame's `data:` lines join.
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (data) await handleData(data);
    }
  }
  return terminal ?? last;
}

/** Resolve an agent's preferred JSON-RPC endpoint. The nodes pass the agent's
 *  base/RPC URL directly; we POST JSON-RPC there (the common A2A 0.3 shape). */
function rpcEndpoint(baseUrl: string): string {
  return baseUrl;
}

export interface A2aSurface {
  discoverAgent(baseUrl: string, opts?: { extended?: boolean }): Promise<unknown>;
  sendMessage(args: { baseUrl: string; message: unknown; taskId?: string | null; contextId?: string | null }): Promise<unknown>;
  sendAndStream(
    args: { baseUrl: string; message: unknown; taskId?: string | null; contextId?: string | null },
    onEvent: (event: unknown) => Promise<void> | void,
  ): Promise<unknown>;
  getTask(args: { baseUrl: string; taskId: string }): Promise<unknown>;
  listTasks(args: { baseUrl: string; filter?: unknown; cursor?: string | null; limit?: number | null }): Promise<unknown>;
  cancelTask(args: { baseUrl: string; taskId: string }): Promise<unknown>;
  resubscribe(args: { baseUrl: string; taskId: string }, onEvent: (event: unknown) => Promise<void> | void): Promise<unknown>;
  pushConfig: {
    create(args: PushConfigArgs): Promise<unknown>;
    get(args: PushConfigArgs): Promise<unknown>;
    list(args: PushConfigArgs): Promise<unknown>;
    delete(args: PushConfigArgs): Promise<unknown>;
  };
  // Server-side (workflow IS an A2A agent) — honest demo stubs on the sample host.
  publishAgentCard(args: { card: unknown; signed?: boolean }): Promise<void>;
  emitStatus(event: unknown): Promise<void>;
  emitArtifact(event: unknown): Promise<void>;
  pushSend(args: { configId: string; event: unknown }): Promise<unknown>;
}

interface PushConfigArgs {
  baseUrl: string;
  taskId: string;
  configId?: string | null;
  pushNotificationConfig?: unknown;
}

// Per-tenant store for the server-side stubs (published agent card). Keyed by
// tenant so a multi-tenant demo doesn't cross streams.
const _publishedCards = new Map<string, unknown>();

export function createA2aSurface(scope: BundleScope): A2aSurface {
  const tenantKey = `${scope.tenantId}::${scope.scopeId ?? ''}`;

  return {
    async discoverAgent(baseUrl, opts) {
      let card: unknown = null;
      let lastErr: unknown = null;
      for (const path of AGENT_CARD_PATHS) {
        try {
          const res = await fetch(new URL(path, baseUrl).toString(), {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
          });
          if (res.ok) { card = await res.json(); break; }
          lastErr = new Error(`HTTP ${res.status}`);
        } catch (err) {
          lastErr = err;
        }
      }
      if (!card) {
        throw Object.assign(new Error(`A2A agent-card discovery failed for ${baseUrl}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`), { code: 'a2a_transport_error' });
      }
      // The authenticated extended card is an optional JSON-RPC follow-up.
      if (opts?.extended === true) {
        try {
          const extended = await rpc(rpcEndpoint(baseUrl), 'agent/getAuthenticatedExtendedCard', {});
          if (extended && typeof extended === 'object') card = extended;
        } catch (err) {
          log.warn('extended agent card fetch failed; returning base card', { baseUrl, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return card;
    },

    sendMessage: ({ baseUrl, message, taskId, contextId }) =>
      rpc(rpcEndpoint(baseUrl), 'message/send', {
        message,
        ...(taskId ? { taskId } : {}),
        ...(contextId ? { contextId } : {}),
      }),

    sendAndStream: ({ baseUrl, message, taskId, contextId }, onEvent) =>
      rpcStream(rpcEndpoint(baseUrl), 'message/stream', {
        message,
        ...(taskId ? { taskId } : {}),
        ...(contextId ? { contextId } : {}),
      }, onEvent),

    getTask: ({ baseUrl, taskId }) => rpc(rpcEndpoint(baseUrl), 'tasks/get', { id: taskId }),

    listTasks: ({ baseUrl, filter, cursor, limit }) =>
      rpc(rpcEndpoint(baseUrl), 'tasks/list', {
        ...(filter ? { filter } : {}),
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      }),

    cancelTask: ({ baseUrl, taskId }) => rpc(rpcEndpoint(baseUrl), 'tasks/cancel', { id: taskId }),

    resubscribe: ({ baseUrl, taskId }, onEvent) =>
      rpcStream(rpcEndpoint(baseUrl), 'tasks/resubscribe', { id: taskId }, onEvent),

    pushConfig: {
      create: ({ baseUrl, taskId, pushNotificationConfig }) =>
        rpc(rpcEndpoint(baseUrl), 'tasks/pushNotificationConfig/set', { taskId, pushNotificationConfig }),
      get: ({ baseUrl, taskId, configId }) =>
        rpc(rpcEndpoint(baseUrl), 'tasks/pushNotificationConfig/get', { taskId, ...(configId ? { pushNotificationConfigId: configId } : {}) }),
      list: ({ baseUrl, taskId }) =>
        rpc(rpcEndpoint(baseUrl), 'tasks/pushNotificationConfig/list', { taskId }),
      delete: ({ baseUrl, taskId, configId }) =>
        rpc(rpcEndpoint(baseUrl), 'tasks/pushNotificationConfig/delete', { taskId, ...(configId ? { pushNotificationConfigId: configId } : {}) }),
    },

    // ── Server-side demo stubs ───────────────────────────────────────
    async publishAgentCard({ card }) {
      _publishedCards.set(tenantKey, card);
      log.info('agent card published (demo: stored in-process, not served at a live A2A endpoint)', { tenant: scope.tenantId });
    },
    async emitStatus() {
      // A production A2A server pushes this onto the connected client's stream;
      // the sample host has no inbound A2A connection, so this is a no-op.
    },
    async emitArtifact() {
      // See emitStatus — no live A2A client stream on the sample host.
    },
    async pushSend({ configId }) {
      return { ok: true, configId, delivered: false, note: 'demo: sample host has no live push-notification channel' };
    },
  };
}
