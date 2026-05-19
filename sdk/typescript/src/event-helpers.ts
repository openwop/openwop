/**
 * Typed helpers for the `agent.*` event family (RFC 0002 §B + RFC 0024).
 *
 * Two layers:
 *
 *   1. **Type guards** (`isAgentReasoned`, `isAgentReasoningDelta`, etc.)
 *      — discriminator-based predicates that narrow `RunEventDoc` to a
 *      `TypedRunEvent<TPayload>` inside the guarded branch. Use these
 *      when you're iterating events yourself (e.g., inside a
 *      `for await (const ev of streamEvents(...))` loop) and want
 *      compile-time-narrowed access to the payload.
 *
 *   2. **High-level subscription helper** (`subscribeToAgentReasoning`)
 *      — fan-outs the `streamEvents()` generator into typed callbacks
 *      (`onDelta`, `onClosed`). Composes with the existing
 *      `streamEvents` SSE consumer; cleanup via the returned
 *      `Unsubscribe` function aborts the underlying fetch.
 *
 * Forward-compat: `RunEventDoc.type` is intentionally `string`-typed
 * (not a closed union) per `COMPATIBILITY.md §2.1` — consumers MUST
 * tolerate unknown event types. The type guards here only narrow when
 * the discriminator AND the required payload fields are present; they
 * return `false` for malformed or unknown events.
 *
 * @see schemas/run-event-payloads.schema.json
 * @see RFCS/0002-agent-identity-and-reasoning-events.md
 * @see RFCS/0024-agent-reasoning-streaming.md
 */

import { streamEvents, type EventsStreamContext, type EventsStreamOptions } from './sse.js';
import type {
  AgentDecidedPayload,
  AgentHandoffPayload,
  AgentReasonedPayload,
  AgentReasoningDeltaPayload,
  AgentToolCalledPayload,
  AgentToolReturnedPayload,
  RunEventDoc,
  TypedRunEvent,
} from './types.js';

// ─── Type guards ────────────────────────────────────────────────────────

function hasStringField(
  payload: unknown,
  field: string,
): payload is Record<string, unknown> {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>)[field] === 'string'
  );
}

/** `agent.reasoned` (RFC 0002 §B). Narrows when `type` matches AND
 *  payload carries the required `agentId` + `reasoning` strings. */
export function isAgentReasoned(
  ev: RunEventDoc,
): ev is TypedRunEvent<AgentReasonedPayload> {
  return (
    ev.type === 'agent.reasoned' &&
    hasStringField(ev.payload, 'agentId') &&
    hasStringField(ev.payload, 'reasoning')
  );
}

/** `agent.reasoning.delta` (RFC 0024). Narrows when `type` matches AND
 *  payload carries the required `agentId` + `delta` strings + numeric
 *  `sequence`. */
export function isAgentReasoningDelta(
  ev: RunEventDoc,
): ev is TypedRunEvent<AgentReasoningDeltaPayload> {
  if (ev.type !== 'agent.reasoning.delta') return false;
  if (!hasStringField(ev.payload, 'agentId')) return false;
  if (!hasStringField(ev.payload, 'delta')) return false;
  const seq = (ev.payload as Record<string, unknown>).sequence;
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 0;
}

/** `agent.toolCalled` (RFC 0002 §B). */
export function isAgentToolCalled(
  ev: RunEventDoc,
): ev is TypedRunEvent<AgentToolCalledPayload> {
  return (
    ev.type === 'agent.toolCalled' &&
    hasStringField(ev.payload, 'agentId') &&
    hasStringField(ev.payload, 'toolName') &&
    hasStringField(ev.payload, 'callId')
  );
}

/** `agent.toolReturned` (RFC 0002 §B). Pairs with `agent.toolCalled`
 *  via `callId`; `outcome` and `error` are mutually exclusive but the
 *  guard doesn't enforce that (callers inspect after narrowing). */
export function isAgentToolReturned(
  ev: RunEventDoc,
): ev is TypedRunEvent<AgentToolReturnedPayload> {
  return (
    ev.type === 'agent.toolReturned' &&
    hasStringField(ev.payload, 'agentId') &&
    hasStringField(ev.payload, 'toolName') &&
    hasStringField(ev.payload, 'callId')
  );
}

/** `agent.handoff` (RFC 0002 §B). Note the distinct field names —
 *  `fromAgentId` / `toAgentId`, NOT a single `agentId`. */
export function isAgentHandoff(
  ev: RunEventDoc,
): ev is TypedRunEvent<AgentHandoffPayload> {
  return (
    ev.type === 'agent.handoff' &&
    hasStringField(ev.payload, 'fromAgentId') &&
    hasStringField(ev.payload, 'toAgentId')
  );
}

/** `agent.decided` (RFC 0002 §B). `decision` is `unknown` per the
 *  schema (host-specific shape); guard only validates `agentId` +
 *  the presence of a `decision` key. */
export function isAgentDecided(
  ev: RunEventDoc,
): ev is TypedRunEvent<AgentDecidedPayload> {
  return (
    ev.type === 'agent.decided' &&
    hasStringField(ev.payload, 'agentId') &&
    ev.payload !== null &&
    typeof ev.payload === 'object' &&
    'decision' in (ev.payload as Record<string, unknown>)
  );
}

// ─── High-level subscription helper ─────────────────────────────────────

/** Returned by {@link subscribeToAgentReasoning}. Call to cancel the
 *  underlying SSE subscription. Idempotent — repeated calls are no-ops. */
export type Unsubscribe = () => void;

/** Per-callback signatures for {@link subscribeToAgentReasoning}. All
 *  callbacks are optional; the helper only invokes those provided.
 *  Callback exceptions are caught + reported via `onError` (when
 *  provided) so one bad handler doesn't tear down the stream. */
export interface AgentReasoningCallbacks {
  /** Fired for each `agent.reasoning.delta` event in arrival order
   *  (RFC 0024). `sequence` starts at 0 and increments by 1 per delta
   *  within a single reasoning block. */
  onDelta?: (payload: AgentReasoningDeltaPayload, ev: TypedRunEvent<AgentReasoningDeltaPayload>) => void | Promise<void>;
  /** Fired once per closed reasoning block with the full
   *  authoritative content. Consumers that only care about the final
   *  trace can subscribe just to this. */
  onClosed?: (payload: AgentReasonedPayload, ev: TypedRunEvent<AgentReasonedPayload>) => void | Promise<void>;
  /** Fired when the SSE stream ends cleanly (server closed or run
   *  reached terminal status). */
  onEnd?: () => void;
  /** Fired when the stream fails OR a callback throws. The helper
   *  catches handler exceptions so a thrown error in `onDelta` doesn't
   *  tear down the whole subscription; the original error is surfaced
   *  here. */
  onError?: (err: Error) => void;
}

/**
 * Subscribe to the reasoning event sub-stream for a single run.
 * Convenience wrapper over `streamEvents()` that dispatches the two
 * RFC 0024 event types into typed callbacks.
 *
 * Returns immediately; the SSE consumption runs as a detached async
 * task in the background. Call the returned `Unsubscribe` to cancel.
 *
 * @example
 * ```ts
 * const stop = subscribeToAgentReasoning(ctx, runId, {
 *   onDelta: ({ delta, sequence }) => process.stdout.write(delta),
 *   onClosed: ({ reasoning }) => console.log('\nfinal:', reasoning),
 * });
 * // ...later
 * stop();
 * ```
 */
export function subscribeToAgentReasoning(
  ctx: EventsStreamContext,
  runId: string,
  callbacks: AgentReasoningCallbacks,
  options: Omit<EventsStreamOptions, 'signal'> = {},
): Unsubscribe {
  const abort = new AbortController();
  let stopped = false;

  const stop: Unsubscribe = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
  };

  void (async () => {
    try {
      // streamModes default to 'updates' — agent.* events flow there
      // per `spec/v1/stream-modes.md`.
      const events = streamEvents(ctx, runId, {
        ...options,
        streamMode: options.streamMode ?? 'updates',
        signal: abort.signal,
      });

      for await (const ev of events) {
        if (stopped) break;
        try {
          if (isAgentReasoningDelta(ev)) {
            await callbacks.onDelta?.(ev.payload, ev);
          } else if (isAgentReasoned(ev)) {
            await callbacks.onClosed?.(ev.payload, ev);
          }
          // Other event types ignored — forward-compat per
          // COMPATIBILITY.md §2.1. Consumers that want them iterate
          // streamEvents() directly.
        } catch (handlerErr) {
          // Handler exceptions: surface via onError but DO NOT tear
          // down the stream. One bad handler shouldn't kill the rest.
          callbacks.onError?.(
            handlerErr instanceof Error
              ? handlerErr
              : new Error(String(handlerErr)),
          );
        }
      }
      if (!stopped) callbacks.onEnd?.();
    } catch (streamErr) {
      if (stopped) return; // intentional cancellation
      callbacks.onError?.(
        streamErr instanceof Error
          ? streamErr
          : new Error(String(streamErr)),
      );
    }
  })();

  return stop;
}
