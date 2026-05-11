/**
 * Polling helpers for run-state assertions.
 *
 * The conformance suite uses `GET /v1/runs/{runId}` polling rather than
 * SSE because SSE termination semantics vary across implementations.
 * Polling is the lowest-common-denominator wire; SSE-specific scenarios
 * live in stream-modes.test.ts.
 *
 * Bound long polls with OPENWOP_LIFECYCLE_TIMEOUT_MS env var (default 10s).
 */

import { driver } from './driver.js';

export interface RunSnapshot {
  readonly runId: string;
  readonly status: string;
  readonly workflowId?: string;
  readonly currentNodeId?: string;
  readonly nodeStates?: Record<string, unknown>;
  readonly variables?: Record<string, unknown>;
  readonly error?: { code?: string; message?: string };
  readonly metrics?: {
    readonly openwopCost?: {
      readonly usd?: number;
      readonly tokens?: { readonly input?: number; readonly output?: number };
      readonly model?: string;
      readonly provider?: string;
      readonly duration_ms?: number;
    };
  };
}

const POLL_INTERVAL_MS = 250;
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENWOP_LIFECYCLE_TIMEOUT_MS ?? 10_000);

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export async function getRun(runId: string): Promise<RunSnapshot> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
  if (res.status !== 200) {
    throw new Error(`GET /v1/runs/${runId} returned ${res.status}: ${res.text.slice(0, 200)}`);
  }
  return res.json as RunSnapshot;
}

export async function pollUntil(
  runId: string,
  predicate: (snap: RunSnapshot) => boolean,
  opts: { timeoutMs?: number; label?: string } = {},
): Promise<RunSnapshot> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let last: RunSnapshot | null = null;
  while (Date.now() < deadline) {
    try {
      last = await getRun(runId);
      if (predicate(last)) return last;
    } catch {
      // 404 right after POST is plausible while the run is being committed —
      // swallow and retry. Other errors will retry too; they'll surface via
      // the timeout message if persistent.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const label = opts.label ?? 'predicate';
  throw new Error(
    `Run ${runId} did not satisfy ${label} within ${timeoutMs}ms (last status: ${last?.status ?? 'unknown'})`,
  );
}

export function pollUntilTerminal(runId: string, opts: { timeoutMs?: number } = {}): Promise<RunSnapshot> {
  return pollUntil(runId, (s) => TERMINAL.has(s.status), { ...opts, label: 'terminal status' });
}

export function pollUntilStatus(
  runId: string,
  expected: string,
  opts: { timeoutMs?: number } = {},
): Promise<RunSnapshot> {
  return pollUntil(runId, (s) => s.status === expected, { ...opts, label: `status === ${expected}` });
}
