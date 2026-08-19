/**
 * Polling helpers for run-state assertions.
 *
 * The conformance suite uses `GET /v1/runs/{runId}` polling rather than
 * SSE because SSE termination semantics vary across implementations.
 * Polling is the lowest-common-denominator wire; SSE-specific scenarios
 * live in stream-modes.test.ts.
 *
 * Bound long polls with OPENWOP_LIFECYCLE_TIMEOUT_MS env var (default 10s) —
 * but note what that knob can and cannot reach. It supplies the DEFAULT only,
 * so it has no effect on the ~110 call sites that pass an explicit `timeoutMs`
 * (59 of them passing the same `10_000` the default already was). An operator
 * measuring a host on a cold or contended endpoint would set the documented
 * variable, observe no change in those scenarios, and record a failure that
 * measured the environment rather than the host.
 *
 * `OPENWOP_POLL_TIMEOUT_SCALE` (default `1`) closes that: it multiplies EVERY
 * poll bound, explicit or default. Scaling rather than flooring is deliberate —
 * a floor would flatten the deliberately-short bounds (`100`, `1000`) that some
 * negative assertions depend on, while a scale preserves every call site's
 * intent relative to the others. At the default it is a no-op, so no existing
 * measurement moves.
 *
 * Neither knob is a way to make a hanging host pass: the assertion is that a
 * terminal state is REACHED, and a host that never reaches one fails at any
 * bound. What they buy is the ability to say whether a timeout measured the
 * host or the harness.
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

/**
 * Multiplier applied to every poll bound (see the module docstring). Invalid,
 * non-positive, or non-finite values fall back to `1` rather than silently
 * producing a zero or negative deadline — a mis-set knob must not turn every
 * poll into an instant failure that looks like a host defect.
 */
function pollTimeoutScale(): number {
  const raw = process.env.OPENWOP_POLL_TIMEOUT_SCALE;
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Apply the scale to a bound, rounding up so a scale of 1 is exactly a no-op. */
export function scaledTimeoutMs(timeoutMs: number): number {
  const scale = pollTimeoutScale();
  return scale === 1 ? timeoutMs : Math.ceil(timeoutMs * scale);
}

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
  const timeoutMs = scaledTimeoutMs(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
