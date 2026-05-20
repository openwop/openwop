/**
 * Conformance-only mock AI provider.
 *
 * Deterministic — every behavior is read from a pre-programmed in-memory
 * queue keyed by `(runId, nodeId)`. The conformance suite POSTs a
 * `MockProgram` (one `MockBehavior` per expected provider call) via the
 * test seam `POST /v1/host/sample/test/mock-ai/program` before starting
 * a run; `dispatchMock` consumes one entry per call.
 *
 * Used to drive the RFC 0032 envelope-reliability event family
 * (`envelope.retry.attempted` / `retry.exhausted` / `truncated` /
 * `refusal` / `recovery.applied` / `nlToFormat.engaged`) without any
 * real provider traffic. Production deployments MUST NOT route real
 * tenants through this — the provider is conformance-gated.
 *
 * @see aiProvidersHost.ts dispatchStructured()
 * @see RFC 0032 §B + RFC 0033 §B
 */

import type { DispatchRequest, DispatchResult } from './dispatch.js';

export interface MockBehavior {
  /** Provider-stop-reason string (raw — normalized downstream).
   *  - `end_turn` → stop (normal completion)
   *  - `max_tokens` / `length` → truncation
   *  - `stop_sequence` → stop
   *  - `safety` → refusal-class
   */
  stopReason?: 'end_turn' | 'max_tokens' | 'length' | 'stop_sequence' | 'safety';
  /** Text response. May be invalid JSON, markdown-fenced JSON, natural
   *  language, etc. — the dispatchStructured layer makes the
   *  retry-classification decision. */
  content?: string;
  /** Provider-side refusal text. When set, the result carries it and
   *  the structured-output layer routes as `envelope.refusal`. */
  refusalText?: string;
  /** Reported output token count. */
  outputTokens?: number;
  /** Reported input token count. */
  inputTokens?: number;
}

export type MockProgram = readonly MockBehavior[];

interface ProgramState {
  program: MockProgram;
  cursor: number;
  /** Records the maxTokens value the most recent call received — read
   *  by the conformance suite via `GET /v1/host/sample/test/mock-ai/
   *  last-dispatch-budget` to verify RFC 0033 §B truncation-budget
   *  multiplication landed. */
  lastReceivedMaxTokens: number | null;
}

const programs = new Map<string, ProgramState>();

/** Seed a program BEFORE a run starts. Keyed by `nodeId` so the
 *  conformance test can program without knowing the runId in advance.
 *  Conformance scenarios run with `--no-file-parallelism` so each
 *  fixture's unique nodeId is sufficient to avoid cross-test
 *  collisions. Each new program seed REPLACES the previous queue. */
export function programMock(nodeId: string, program: MockProgram): void {
  programs.set(nodeId, { program, cursor: 0, lastReceivedMaxTokens: null });
}

/** Wipe all programs. Called between conformance scenarios. */
export function resetMockPrograms(): void {
  programs.clear();
}

/** Return the most-recent `maxTokens` passed to a mock dispatch for
 *  `nodeId`. Returns `null` when no call has fired or the program
 *  isn't seeded. */
export function lastReceivedMaxTokens(nodeId: string): number | null {
  return programs.get(nodeId)?.lastReceivedMaxTokens ?? null;
}

/** Dispatch entry point. Returns a `DispatchResult`-shaped value built
 *  from the next program entry. When the program is exhausted, returns
 *  an empty-stop completion (so a misaligned test surfaces as "expected
 *  N calls, got N+1" rather than a hang). */
export async function dispatchMock(req: DispatchRequest & { nodeId?: string }): Promise<DispatchResult> {
  // The nodeId is not on the canonical DispatchRequest shape today —
  // `aiProvidersHost.ts` carries it on the AdapterScope and we extend
  // the dispatch request with it inline at the call site when the
  // provider is 'mock'. A real-provider adapter wouldn't see this.
  const nodeId = req.nodeId ?? '';
  const state = programs.get(nodeId);
  // Record the maxTokens for the §B truncation-budget assertion.
  if (state) {
    state.lastReceivedMaxTokens = req.maxTokens ?? null;
  }
  const behavior: MockBehavior =
    state !== undefined && state.cursor < state.program.length
      ? state.program[state.cursor++]!
      : {};

  return {
    provider: 'mock',
    model: req.model || 'mock-mini',
    completion: behavior.refusalText ?? behavior.content ?? '',
    usage: {
      inputTokens: behavior.inputTokens ?? 100,
      outputTokens: behavior.outputTokens ?? 50,
    },
    ...(behavior.stopReason ? { finishReason: behavior.stopReason } : {}),
    ...(behavior.refusalText ? { blockReason: 'refusal' } : {}),
  };
}
