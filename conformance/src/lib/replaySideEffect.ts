/**
 * Shared helpers for the RFC 0140 replay side-effect-suppression scenario.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via
 * `../lib/replaySideEffect.js`.
 *
 * `replay.md` §"Side-effect suppression in replay" turns on a fact the run
 * event log CANNOT express: whether an external effect actually left the host.
 * An event-log assertion cannot tell "the node was suppressed" apart from "the
 * node fired and was recorded identically" — and that second case is exactly
 * the failure the section exists to prevent. So the behavioral legs drive a
 * documented host-sample seam:
 *
 *   GET /v1/host/sample/replay/effect-count?runId=<runId>
 *     → 2xx { runId: string, effectCount: integer }
 *
 * `effectCount` is monotonic non-decreasing per runId and counts effects
 * ATTEMPTED at the host's effect seam — a fired-then-failed outbound call still
 * counts, because the observable escape already happened. Per
 * `host-sample-test-seams.md` §20 the counter MUST sit at the same seam as the
 * rule-5(b) default-deny guard; a counter somewhere else measures a different
 * thing than the guard protects.
 *
 * 404/405 means the host hasn't wired the seam → soft-skip (hard-fail under
 * OPENWOP_REQUIRE_BEHAVIOR=true, via behaviorGatePresent).
 */
import { driver } from './driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Reads the root-level `replay` capability block.
 *
 * Root-first per `capabilities.md` §"Document-root layout (normative — RFC
 * 0073)"; the deprecated `capabilities` wrapper is checked second and retires
 * with the migration window at v2.0. Same lookup order as `artifactTypes.ts`.
 */
export async function readReplayCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return null;
  const doc = res.json as DiscoveryDoc | undefined;
  const caps = doc?.capabilities && typeof doc.capabilities === 'object'
    ? (doc.capabilities as Record<string, unknown>)
    : undefined;
  const cap = doc?.['replay'] ?? caps?.['replay'];
  return cap && typeof cap === 'object' ? (cap as Record<string, unknown>) : null;
}

/**
 * True iff the host declares the RFC 0140 mechanism.
 *
 * Deliberately strict equality on `'recorded-outcome'`: `none` (and absent,
 * which defaults to it) means the host declares NO mechanism — which is NOT
 * permission to re-fire (caveat 1 binds unconditionally), only that the
 * guarantee is unprobeable here, so the behavioral legs have nothing to drive.
 */
export function sideEffectSuppressionDeclared(cap: Record<string, unknown> | null): boolean {
  return cap?.['sideEffectSuppression'] === 'recorded-outcome';
}

/** Advertised fork modes; `[]` when the host makes no replay claim. */
export function replayModes(cap: Record<string, unknown> | null): readonly string[] {
  if (cap?.['supported'] !== true) return [];
  const modes = cap['modes'];
  if (!Array.isArray(modes)) return [];
  return modes.filter((m): m is string => typeof m === 'string');
}

/** Reads the host's effect counter for a run, or null (soft-skip) when the seam is absent. */
export async function readEffectCount(runId: string): Promise<number | null> {
  const res = await driver.get(
    `/v1/host/sample/replay/effect-count?runId=${encodeURIComponent(runId)}`,
  );
  if (res.status === 404 || res.status === 405) return null;
  if (res.status < 200 || res.status >= 300) return null;
  const count = (res.json as { effectCount?: unknown } | undefined)?.effectCount;
  return typeof count === 'number' ? count : null;
}

/** A `node.failed` entry lifted out of a run's event log. */
export interface NodeFailure {
  nodeId: string | undefined;
  code: string | undefined;
}

/**
 * Collects `node.failed` error codes from a run's event log via the normative
 * poll endpoint. Tolerates both `payload` and `data` envelopes, matching the
 * shape tolerance in `replay-fork-arbitrary.test.ts`.
 */
export async function readNodeFailures(runId: string): Promise<NodeFailure[]> {
  const res = await driver.get(
    `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
  );
  if (res.status !== 200) return [];
  const events = (res.json as { events?: unknown } | undefined)?.events;
  if (!Array.isArray(events)) return [];
  const out: NodeFailure[] = [];
  for (const e of events) {
    const ev = e as { type?: unknown; payload?: unknown; data?: unknown };
    if (ev.type !== 'node.failed') continue;
    const body = (ev.payload ?? ev.data ?? {}) as {
      nodeId?: unknown;
      error?: { code?: unknown };
    };
    out.push({
      nodeId: typeof body.nodeId === 'string' ? body.nodeId : undefined,
      code: typeof body.error?.code === 'string' ? body.error.code : undefined,
    });
  }
  return out;
}
