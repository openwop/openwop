/**
 * Deterministic synthetic-history generator for a governed Workforce.
 *
 * EP0 keystone (see `plans/openwop-workforce-EP0-design.md` §2). Produces a
 * multi-week backlog of TERMINAL runs — with self-consistent, fixed-history
 * event logs — so the Workforce overview, telemetry dashboard, approval queue,
 * and replay all render real data on a fresh demo tenant.
 *
 * Determinism is a hard requirement, not a nicety (replay.md §"Determinism
 * guarantees"):
 *   1. NO ambient nondeterminism. Everything derives from `(seed, epochMs)`.
 *      No `Date.now()`, no `Math.random()`, no `crypto.randomUUID()`.
 *      Math.imul/>>> below are pure integer ops on the seeded state.
 *   2. IDs + timestamps are written INTO the events as fixed history. A later
 *      replay re-emits them from the log and MUST NOT regenerate them
 *      (replay.md L112, recorded-fact events). We therefore emit complete
 *      records, never a recipe re-run at read time.
 *   3. Identical inputs ⇒ byte-identical output across every deploy. The
 *      determinism test (`test/workforce-history.test.ts`) asserts this.
 *
 * This module is storage-agnostic: it returns records. The seed wiring (next
 * EP0 slice) persists them via existing `Storage.insertRun` / `appendEvent`
 * (which assigns `sequence` monotonically) / `insertAnnotation`.
 */

import type { AnnotationRecord, EventRecord, RunRecord, RunStatus } from '../types.js';

/** An event ready to hand to `Storage.appendEvent` (which assigns `sequence`). */
export type SeedEvent = Omit<EventRecord, 'sequence'>;

export interface GeneratedRun {
  record: RunRecord;
  events: SeedEvent[];
  annotations: AnnotationRecord[];
}

export interface WorkforceHistory {
  runs: GeneratedRun[];
  /** Summary the seed step can log; not persisted. */
  stats: {
    total: number;
    byOutcome: Record<RunOutcome, number>;
    openApprovals: number;
  };
}

export interface WorkforceHistoryOptions {
  workforceId: string;
  tenantId: string;
  /** Hero workflow id (e.g. `sample.agents.invoice-exception`). */
  workflowId: string;
  /** Deterministic seed string. */
  seed: string;
  /** Logical epoch in ms — the START of the seeded window. Passed in; the
   *  generator never reads the wall clock. */
  epochMs: number;
  /** Total runs to generate. Default 300. */
  runCount?: number;
  /** Number of weeks the window spans. Default 6. */
  weeks?: number;
}

export type RunOutcome =
  | 'clean' // completed, no human touch
  | 'escalated' // approval requested + granted, then completed
  | 'overridden' // approval requested + human overrode the agent
  | 'failed-recovered' // failed, then a forked replay completed
  | 'false-positive' // completed but flagged wrong by a human
  | 'open'; // non-terminal: awaiting human approval (head of timeline)

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- deterministic primitives ---------------------------------------------

/** FNV-1a 32-bit hash — pure, stable across platforms. */
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — seeded, deterministic, no global state. */
function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crockford-base32-ish deterministic id, ULID-shaped but seeded. */
function makeId(prefix: string, seed: string, ...parts: (string | number)[]): string {
  const h = hash32(`${seed}:${prefix}:${parts.join(':')}`);
  const h2 = hash32(`${prefix}:${parts.join(':')}:${seed}`);
  const body = (h.toString(36) + h2.toString(36)).padStart(13, '0').slice(0, 13);
  return `${prefix}_${body}`;
}

function isoAt(epochMs: number, offsetMs: number): string {
  return new Date(epochMs + offsetMs).toISOString();
}

// ---- scenario mix by autonomy phase ---------------------------------------

interface PhaseMix {
  autonomy: 'review' | 'guided' | 'auto';
  // cumulative-friendly weights; normalized internally
  clean: number;
  escalated: number;
  overridden: number;
  failedRecovered: number;
  falsePositive: number;
}

/** Three 2-week bands. Override / false-positive decline as the agent earns
 *  autonomy — this is what makes the graduation story a visible downward curve. */
const PHASES: readonly PhaseMix[] = [
  { autonomy: 'review', clean: 70, escalated: 18, overridden: 8, failedRecovered: 2, falsePositive: 2 },
  { autonomy: 'guided', clean: 82, escalated: 12, overridden: 4, failedRecovered: 1.5, falsePositive: 0.5 },
  { autonomy: 'auto', clean: 91, escalated: 6, overridden: 2, failedRecovered: 0.8, falsePositive: 0.2 },
];

type ClosedOutcome = Exclude<RunOutcome, 'open'>;

/** Allocate EXACT outcome counts for `n` runs from a phase mix, so the
 *  aggregate curve is precisely the designed proportions (a clean, repeatable
 *  graduation story) rather than a noisy sample. Remainder lands in `clean`. */
function allocateOutcomes(n: number, mix: PhaseMix): ClosedOutcome[] {
  const total = mix.clean + mix.escalated + mix.overridden + mix.failedRecovered + mix.falsePositive;
  const ordered: [ClosedOutcome, number][] = [
    ['escalated', mix.escalated],
    ['overridden', mix.overridden],
    ['failed-recovered', mix.failedRecovered],
    ['false-positive', mix.falsePositive],
  ];
  const out: ClosedOutcome[] = [];
  for (const [name, w] of ordered) {
    const c = Math.round((n * w) / total);
    for (let k = 0; k < c; k++) out.push(name);
  }
  while (out.length < n) out.push('clean'); // remainder = clean
  return out.slice(0, n);
}

/** Deterministic in-place Fisher–Yates using a seeded PRNG. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

/** Precompute every run's outcome: exact per-phase counts, shuffled within the
 *  phase, with the final `openCount` runs forced OPEN (head of the queue). */
function planOutcomes(runCount: number, openCount: number, seed: string): { outcome: RunOutcome; phaseIdx: number }[] {
  const plan: { outcome: RunOutcome; phaseIdx: number }[] = new Array(runCount);
  const phaseSlices: number[][] = PHASES.map(() => []);
  for (let i = 0; i < runCount; i++) {
    const phaseIdx = Math.min(PHASES.length - 1, Math.floor((i / runCount) * PHASES.length));
    phaseSlices[phaseIdx]!.push(i);
  }
  phaseSlices.forEach((indices, phaseIdx) => {
    const bag = shuffle(allocateOutcomes(indices.length, PHASES[phaseIdx]!), mulberry32(hash32(`${seed}:plan:${phaseIdx}`)));
    indices.forEach((runIdx, k) => {
      plan[runIdx] = { outcome: bag[k]!, phaseIdx };
    });
  });
  // Force the tail OPEN (non-terminal approvals at the head of the timeline).
  for (let i = runCount - openCount; i < runCount; i++) {
    if (plan[i]) plan[i]!.outcome = 'open';
  }
  return plan;
}

// ---- the generator ---------------------------------------------------------

export function generateWorkforceHistory(opts: WorkforceHistoryOptions): WorkforceHistory {
  const { workforceId, tenantId, workflowId, seed, epochMs } = opts;
  const runCount = opts.runCount ?? 300;
  const weeks = opts.weeks ?? 6;
  const windowMs = weeks * 7 * DAY_MS;
  const stride = Math.floor(windowMs / Math.max(runCount, 1));
  // Last few runs are left OPEN (awaiting approval) so the inbox isn't empty.
  const openCount = Math.min(8, Math.floor(runCount * 0.02) + 5);
  const plan = planOutcomes(runCount, openCount, seed);

  const runs: GeneratedRun[] = [];
  const byOutcome: Record<RunOutcome, number> = {
    clean: 0, escalated: 0, overridden: 0, 'failed-recovered': 0, 'false-positive': 0, open: 0,
  };

  for (let i = 0; i < runCount; i++) {
    const rng = mulberry32(hash32(`${seed}:run:${i}`));
    const startMs = i * stride;
    const phaseIdx = plan[i]!.phaseIdx;
    const phase = PHASES[phaseIdx]!;
    const outcome: RunOutcome = plan[i]!.outcome;
    byOutcome[outcome]++;

    const runId = makeId('run', seed, i);
    // Trace correlation (GA-2): a per-run correlationId, plus a batchId shared
    // by all runs started the same day — so a cross-run trace search ("show me
    // everything in this batch") returns a real multi-run set.
    const correlationId = makeId('corr', seed, i);
    const batchId = makeId('batch', seed, Math.floor(startMs / DAY_MS));
    const events: SeedEvent[] = [];
    const annotations: AnnotationRecord[] = [];
    let cursor = 0; // ms offset within the run
    let seq = 0;
    let costUsd = 0; // accumulated provider cost — stashed in metadata so the
    //                  /metrics endpoint aggregates from runs alone (no N+1).
    const ev = (type: string, payload: unknown, nodeId?: string): void => {
      cursor += 1000 + Math.floor(rng() * 4000);
      events.push({
        eventId: makeId('evt', seed, i, seq++),
        runId,
        type,
        ...(nodeId ? { nodeId } : {}),
        payload,
        timestamp: isoAt(epochMs, startMs + cursor),
        causationId: correlationId, // links every event of a run to its trace
      });
    };

    ev('run.started', { workflowId, workforceId, inputDigest: makeId('inp', seed, i), correlationId, batchId });

    // extract + match always run and complete (auto-safe nodes)
    for (const node of ['invoice-extract', 'invoice-match'] as const) {
      ev('node.started', { nodeId: node }, node);
      const inTok = 400 + Math.floor(rng() * 1600);
      const outTok = 80 + Math.floor(rng() * 600);
      // cost drifts DOWN across the window (cheaper models / fewer retries as it matures)
      const rate = 0.0000025 * (1 - 0.35 * (i / runCount));
      const cost = Number(((inTok + outTok) * rate).toFixed(6));
      costUsd += cost;
      ev('provider.usage', {
        provider: 'anthropic',
        model: 'mock-ai',
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: inTok + outTok,
        costEstimateUsd: cost,
      }, node);
      ev('node.completed', { nodeId: node }, node);
    }

    const postNode = 'invoice-post';
    let status: RunStatus;

    switch (outcome) {
      case 'clean': {
        ev('node.started', { nodeId: postNode }, postNode);
        ev('node.completed', { nodeId: postNode }, postNode);
        ev('run.completed', { outcome: 'cleared' });
        status = 'completed';
        break;
      }
      case 'escalated': {
        ev('node.suspended', { nodeId: postNode, reason: 'over-threshold' }, postNode);
        ev('approval.requested', { nodeId: postNode, prompt: 'Approve invoice posting over $5,000?' }, postNode);
        ev('approval.granted', { nodeId: postNode, principal: 'reviewer:demo', decision: 'approve' }, postNode);
        ev('node.completed', { nodeId: postNode }, postNode);
        ev('run.completed', { outcome: 'cleared', escalated: true });
        status = 'completed';
        break;
      }
      case 'overridden': {
        ev('node.suspended', { nodeId: postNode, reason: 'over-threshold' }, postNode);
        ev('approval.requested', { nodeId: postNode, prompt: 'Approve invoice posting over $5,000?' }, postNode);
        ev('approval.overridden', { nodeId: postNode, principal: 'reviewer:demo', decision: 'reject', reason: 'vendor not on master list' }, postNode);
        ev('run.completed', { outcome: 'held', overridden: true });
        status = 'completed';
        break;
      }
      case 'failed-recovered': {
        ev('node.started', { nodeId: postNode }, postNode);
        ev('node.failed', { nodeId: postNode, error: { code: 'erp_timeout', message: 'ERP post timed out' } }, postNode);
        ev('run.failed', { outcome: 'failed', recoverable: true });
        status = 'failed';
        break;
      }
      case 'false-positive': {
        ev('node.started', { nodeId: postNode }, postNode);
        ev('node.completed', { nodeId: postNode }, postNode);
        ev('run.completed', { outcome: 'cleared' });
        status = 'completed';
        annotations.push({
          annotationId: makeId('ann', seed, i),
          runId,
          tenantId,
          payload: { kind: 'flag', target: 'run', reason: 'false-positive', principal: 'reviewer:demo' },
          createdAt: isoAt(epochMs, startMs + cursor + 60000),
        });
        break;
      }
      case 'open': {
        ev('node.suspended', { nodeId: postNode, reason: 'over-threshold' }, postNode);
        ev('approval.requested', { nodeId: postNode, prompt: 'Approve invoice posting over $5,000?' }, postNode);
        status = 'waiting-approval';
        break;
      }
    }

    const createdAt = isoAt(epochMs, startMs);
    const lastTs = events[events.length - 1]!.timestamp;
    const record: RunRecord = {
      runId,
      workflowId,
      tenantId,
      status,
      inputs: { invoiceRef: makeId('inv', seed, i) },
      metadata: {
        workforceId,
        outcome,
        autonomyPhase: phase.autonomy,
        costUsd: Number(costUsd.toFixed(6)),
        cycleMs: cursor,
        correlationId,
        batchId,
      },
      configurable: {},
      createdAt,
      updatedAt: lastTs,
      ...(status === 'completed' || status === 'failed' ? { completedAt: lastTs } : {}),
      ...(status === 'failed' ? { error: { code: 'erp_timeout', message: 'ERP post timed out' } } : {}),
    };

    runs.push({ record, events, annotations });
  }

  return {
    runs,
    stats: { total: runs.length, byOutcome, openApprovals: byOutcome.open },
  };
}
