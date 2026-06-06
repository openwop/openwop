/**
 * Workforce host-extension service (EP0 §1).
 *
 * Persists the `Workforce` entity in the generic host-ext kv store (the same
 * `DurableCollection` backing roster/kanban/org-chart) — so NO per-backend
 * schema change is needed. Also owns demo seeding:
 *
 *  - `seedWorkforceEntities()` — cheap (one row per workforce). Idempotent.
 *    Safe to run on the silent auto-seed path.
 *  - `seedWorkforceHistory()` — HEAVY (hundreds of runs + event logs). Gated to
 *    the EXPLICIT "Load demo data" action only (never the per-visit auto-seed),
 *    so a cookieless `anon:<sid>` visitor never triggers a 300-run write storm
 *    (architect CTI-1 / fan-out finding). Idempotent per tenant.
 *
 * VENDOR-NEUTRAL: no external-framework branding in names or content.
 */

import { createHash } from 'node:crypto';
import { DurableCollection } from './hostExtPersistence.js';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import { generateWorkforceHistory } from './workforceHistory.js';
import type { AutonomyLevel, Workforce, WorkforceStatus } from './workforce.js';
import workforceSeed from './seed-data/workforces.json';

const log = createLogger('workforce');
const WEEKS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const workforces = new DurableCollection<Workforce>('workforce', (w) => w.workforceId);

const seedDefs = workforceSeed as unknown as Workforce[];

export async function getWorkforce(workforceId: string): Promise<Workforce | null> {
  return workforces.get(workforceId);
}

export async function listWorkforces(): Promise<Workforce[]> {
  return workforces.list();
}

export async function putWorkforce(workforce: Workforce): Promise<void> {
  await workforces.put(workforce);
}

/** Update a workforce's cutover status (MG-6). Returns the updated entity, or
 *  null if it doesn't exist. The PRODUCTION gate (only promote once the agent
 *  has graduated to bounded-autonomous) is enforced at the route, which has the
 *  run history to evaluate graduation. */
export async function setWorkforceStatus(
  workforceId: string,
  status: WorkforceStatus,
): Promise<Workforce | null> {
  const wf = await workforces.get(workforceId);
  if (!wf) return null;
  const updated: Workforce = { ...wf, status };
  await workforces.put(updated);
  return updated;
}

/** Idempotent: create any seed Workforce that doesn't already exist. Cheap. */
export async function seedWorkforceEntities(): Promise<number> {
  let created = 0;
  for (const def of seedDefs) {
    if (!(await workforces.get(def.workforceId))) {
      await workforces.put(def);
      created++;
    }
  }
  return created;
}

/** The hero workflow a workforce's history runs against. */
function heroWorkflowId(w: Workforce): string {
  return w.workflowCatalog[w.workflowCatalog.length - 1] ?? w.workflowCatalog[0] ?? w.workforceId;
}

export interface WorkforceHistorySeedOptions {
  /** Total runs per workforce. Default 300. */
  runCount?: number;
  /** Wall-clock now in ms — read at the HOST boundary (not in the generator,
   *  which stays pure). The seeded window ends near `nowMs`. */
  nowMs: number;
}

/**
 * Generate + persist multi-week history for every seed workforce, into the
 * given tenant. Idempotent: skips a workforce that already has runs in the
 * tenant. HEAVY — call only from the explicit seed path.
 */
export async function seedWorkforceHistory(
  storage: Storage,
  tenantId: string,
  opts: WorkforceHistorySeedOptions,
): Promise<{ workforces: number; runs: number }> {
  const windowMs = WEEKS * 7 * DAY_MS;
  let seededWorkforces = 0;
  let seededRuns = 0;

  // One read of the tenant's runs to gate idempotency for all workforces.
  const existing = await storage.listRuns({ tenantId, limit: 5000 });
  const seenWorkforce = new Set(
    existing.map((r) => (r.metadata as { workforceId?: string } | undefined)?.workforceId).filter(Boolean),
  );

  for (const w of seedDefs) {
    if (seenWorkforce.has(w.workforceId)) continue;
    // Only INSTRUMENTED workforces (historyRunCount > 0) get history; the
    // others ship as stand-up templates (the gallery still lists them). The
    // per-call `opts.runCount` overrides the count for the instrumented ones
    // (used by tests); it does NOT promote a template into an instrumented one.
    const gate = w.historyRunCount ?? 0;
    if (gate <= 0) continue;
    const runCount = opts.runCount ?? gate;
    const history = generateWorkforceHistory({
      workforceId: w.workforceId,
      tenantId,
      workflowId: heroWorkflowId(w),
      // deterministic per (tenant, workforce); placement/ids vary by tenant.
      seed: `${tenantId}:${w.workforceId}`,
      // window ends ~now; the generator never reads the wall clock itself.
      epochMs: opts.nowMs - windowMs,
      runCount,
      weeks: WEEKS,
    });
    for (const gr of history.runs) {
      await storage.insertRun(gr.record);
      for (const ev of gr.events) await storage.appendEvent(ev);
      for (const ann of gr.annotations) await storage.insertAnnotation(ann);
    }
    seededWorkforces++;
    seededRuns += history.runs.length;
    log.info('workforce_history_seeded', {
      tenantId,
      workforceId: w.workforceId,
      runs: history.runs.length,
      open: history.stats.openApprovals,
    });
  }

  return { workforces: seededWorkforces, runs: seededRuns };
}

/** Test-only: drop the persisted workforce collection. */
export async function __clearWorkforces(): Promise<void> {
  await workforces.__clear();
}

// ---- telemetry aggregation (EP0 §3) ---------------------------------------

export interface WorkforceMetrics {
  workforceId: string;
  totalRuns: number;
  terminalRuns: number;
  openApprovals: number;
  cycleTimeP50Ms: number | null;
  costPerClearedUsd: number | null;
  escalationRate: number;
  overrideRate: number;
  falsePositiveRate: number;
  recoveryRate: number;
  policyViolations: number;
  weekly: { week: number; runs: number; overrideRate: number; avgCostUsd: number }[];
}

interface RunMeta {
  workforceId?: string;
  outcome?: string;
  costUsd?: number;
  cycleMs?: number;
  correlationId?: string;
  batchId?: string;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const APPROVAL_OUTCOMES = new Set(['escalated', 'overridden', 'open']);
const CLEARED_OUTCOMES = new Set(['clean', 'escalated', 'false-positive']);

/**
 * Aggregate the 8 telemetry metrics for one workforce purely from RunRecords
 * (cost + cycle time are stashed in `metadata` by the generator, so this is a
 * single `listRuns` read — no per-run event fan-out / N+1, per architect A-4).
 */
export function aggregateWorkforceMetrics(
  runs: readonly { metadata: Record<string, unknown>; status: string; createdAt: string }[],
  workforceId: string,
): WorkforceMetrics {
  const mine = runs.filter((r) => (r.metadata as RunMeta).workforceId === workforceId);
  const meta = (r: (typeof mine)[number]): RunMeta => r.metadata as RunMeta;

  const total = mine.length;
  const open = mine.filter((r) => r.status === 'waiting-approval').length;
  const terminal = mine.filter((r) => r.status === 'completed' || r.status === 'failed').length;

  const count = (pred: (o: string) => boolean): number =>
    mine.filter((r) => pred(meta(r).outcome ?? '')).length;

  const approvalRequested = count((o) => APPROVAL_OUTCOMES.has(o));
  const overridden = count((o) => o === 'overridden');
  const falsePositive = count((o) => o === 'false-positive');
  const failedRecovered = count((o) => o === 'failed-recovered');

  const cleared = mine.filter((r) => CLEARED_OUTCOMES.has(meta(r).outcome ?? ''));
  const clearedCost = cleared.reduce((s, r) => s + (meta(r).costUsd ?? 0), 0);
  const cycleSamples = mine
    .filter((r) => r.status === 'completed')
    .map((r) => meta(r).cycleMs ?? 0)
    .filter((n) => n > 0);

  // weekly buckets keyed off the earliest createdAt
  const times = mine.map((r) => Date.parse(r.createdAt)).filter((n) => !Number.isNaN(n));
  const t0 = times.length ? Math.min(...times) : 0;
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const byWeek = new Map<number, { runs: number; overridden: number; approval: number; cost: number }>();
  for (const r of mine) {
    const w = Math.floor((Date.parse(r.createdAt) - t0) / WEEK);
    const b = byWeek.get(w) ?? { runs: 0, overridden: 0, approval: 0, cost: 0 };
    const o = meta(r).outcome ?? '';
    b.runs++;
    if (APPROVAL_OUTCOMES.has(o)) b.approval++;
    if (o === 'overridden') b.overridden++;
    b.cost += meta(r).costUsd ?? 0;
    byWeek.set(w, b);
  }
  const weekly = [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, b]) => ({
      week,
      runs: b.runs,
      overrideRate: b.approval ? Number((b.overridden / b.approval).toFixed(4)) : 0,
      avgCostUsd: b.runs ? Number((b.cost / b.runs).toFixed(6)) : 0,
    }));

  return {
    workforceId,
    totalRuns: total,
    terminalRuns: terminal,
    openApprovals: open,
    cycleTimeP50Ms: median(cycleSamples),
    costPerClearedUsd: cleared.length ? Number((clearedCost / cleared.length).toFixed(6)) : null,
    escalationRate: total ? Number((approvalRequested / total).toFixed(4)) : 0,
    overrideRate: approvalRequested ? Number((overridden / approvalRequested).toFixed(4)) : 0,
    falsePositiveRate: total ? Number((falsePositive / total).toFixed(4)) : 0,
    recoveryRate: total ? Number((failedRecovered / total).toFixed(4)) : 0,
    policyViolations: overridden,
    weekly,
  };
}

// ---- graduated autonomy + governance posture (EP1: WG-5 + GA-5) -----------

/** Tier order + the override-incidence ceiling that unlocks ENTRY to each
 *  higher tier. "Override incidence" here = overrides ÷ runs in the trailing
 *  window (the clean, monotone graduation signal — distinct from the headline
 *  conditional `overrideRate` = overrides ÷ approvals). Thresholds chosen
 *  consistent with the seeded curve (review ~8% → guided ~4% → auto ~2%). */
const TIER_ORDER: readonly AutonomyLevel[] = ['review', 'guided', 'auto'];
const UNLOCK_OVERRIDE_INCIDENCE: Record<Exclude<AutonomyLevel, 'review'>, number> = {
  guided: 0.1,
  auto: 0.05,
};

export interface PromotionMilestone {
  fromTier: AutonomyLevel | null;
  toTier: AutonomyLevel;
  atIso: string;
  runIndex: number;
  /** Override incidence over the prior tier's window (null for the initial tier). */
  overrideIncidenceBefore: number | null;
  /** The ceiling that unlocked this tier (null for the initial tier). */
  unlockThreshold: number | null;
}

export interface AutonomyGraduation {
  workforceId: string;
  currentTier: AutonomyLevel | null;
  milestones: PromotionMilestone[];
  nextTier: AutonomyLevel | null;
  nextThreshold: number | null;
  /** Override incidence over the most recent window. */
  recentOverrideIncidence: number;
  eligibleForNext: boolean;
}

function overrideIncidence(slice: readonly { metadata: Record<string, unknown> }[]): number {
  if (slice.length === 0) return 0;
  const overrides = slice.filter((r) => (r.metadata as RunMeta).outcome === 'overridden').length;
  return Number((overrides / slice.length).toFixed(4));
}

/**
 * Derive the evidence-based promotion timeline from a workforce's run history:
 * each autonomy-tier transition becomes a milestone stamped with the override
 * incidence that earned it. Turns the graduation curve into an auditable
 * "promoted because the evidence cleared the bar" contract (WG-5).
 */
export function aggregateAutonomyGraduation(
  runs: readonly { metadata: Record<string, unknown>; createdAt: string }[],
  workforceId: string,
): AutonomyGraduation {
  const mine = runs
    .filter((r) => (r.metadata as RunMeta).workforceId === workforceId)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const milestones: PromotionMilestone[] = [];
  let phaseStart = 0;
  let prevTier: AutonomyLevel | null = null;

  mine.forEach((run, i) => {
    const tier = ((run.metadata as { autonomyPhase?: AutonomyLevel }).autonomyPhase) ?? null;
    if (tier && tier !== prevTier) {
      const before = prevTier === null ? null : overrideIncidence(mine.slice(phaseStart, i));
      const threshold = tier === 'review' ? null : UNLOCK_OVERRIDE_INCIDENCE[tier];
      milestones.push({
        fromTier: prevTier,
        toTier: tier,
        atIso: run.createdAt,
        runIndex: i,
        overrideIncidenceBefore: before,
        unlockThreshold: prevTier === null ? null : threshold,
      });
      phaseStart = i;
      prevTier = tier;
    }
  });

  const currentTier = prevTier;
  const curIdx = currentTier ? TIER_ORDER.indexOf(currentTier) : -1;
  const nextTier = curIdx >= 0 && curIdx < TIER_ORDER.length - 1 ? TIER_ORDER[curIdx + 1]! : null;
  const nextThreshold = nextTier && nextTier !== 'review' ? UNLOCK_OVERRIDE_INCIDENCE[nextTier] : null;
  // recent window = the current tier's runs (the live evidence).
  const recent = overrideIncidence(mine.slice(phaseStart));

  return {
    workforceId,
    currentTier,
    milestones,
    nextTier,
    nextThreshold,
    recentOverrideIncidence: recent,
    eligibleForNext: nextThreshold !== null && recent <= nextThreshold,
  };
}

export interface GovernanceEvent {
  runId: string;
  atIso: string;
  kind: 'override' | 'false-positive' | 'recovery';
  detail: string;
}

export interface GovernancePosture {
  workforceId: string;
  totalRuns: number;
  overrides: number;
  escalations: number;
  falsePositives: number;
  recoveries: number;
  policyViolations: number;
  recentEvents: GovernanceEvent[];
}

const GOVERNANCE_OUTCOME_KIND: Record<string, GovernanceEvent['kind']> = {
  overridden: 'override',
  'false-positive': 'false-positive',
  'failed-recovered': 'recovery',
};
const GOVERNANCE_DETAIL: Record<GovernanceEvent['kind'], string> = {
  override: 'Human overrode the agent (e.g. vendor not on master list).',
  'false-positive': 'Cleared run later flagged wrong by a reviewer.',
  recovery: 'Run failed and recovered via fork-replay.',
};

/**
 * Governance posture for the workforce — runtime-control counts + the most
 * recent notable events, so the demo shows GOVERN/ASSURE as live monitoring
 * rather than after-the-fact audit (GA-5). Derived from run metadata; single
 * read, no event fan-out.
 */
export function aggregateGovernancePosture(
  runs: readonly { runId: string; metadata: Record<string, unknown>; createdAt: string }[],
  workforceId: string,
  recentLimit = 8,
): GovernancePosture {
  const mine = runs.filter((r) => (r.metadata as RunMeta).workforceId === workforceId);
  const outcome = (r: (typeof mine)[number]): string => (r.metadata as RunMeta).outcome ?? '';
  const count = (pred: (o: string) => boolean): number => mine.filter((r) => pred(outcome(r))).length;

  const recentEvents = mine
    .filter((r) => GOVERNANCE_OUTCOME_KIND[outcome(r)] !== undefined)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, recentLimit)
    .map((r): GovernanceEvent => {
      const kind = GOVERNANCE_OUTCOME_KIND[outcome(r)]!;
      return { runId: r.runId, atIso: r.createdAt, kind, detail: GOVERNANCE_DETAIL[kind] };
    });

  return {
    workforceId,
    totalRuns: mine.length,
    overrides: count((o) => o === 'overridden'),
    escalations: count((o) => o === 'escalated' || o === 'overridden' || o === 'open'),
    falsePositives: count((o) => o === 'false-positive'),
    recoveries: count((o) => o === 'failed-recovered'),
    policyViolations: count((o) => o === 'overridden'),
    recentEvents,
  };
}

// ---- cross-run trace search (EP1: GA-2) -----------------------------------

export interface TraceMatch {
  runId: string;
  correlationId: string | null;
  batchId: string | null;
  outcome: string | null;
  status: string;
  startedAt: string;
}

export interface TraceSearchResult {
  query: string;
  matches: TraceMatch[];
  /** Runs scanned (the workforce's runs in the caller's tenant). */
  scanned: number;
  /** True when more matches existed than the returned cap (no silent truncation). */
  capped: boolean;
}

/**
 * Cross-run trace/audit search over a workforce's runs by correlationId,
 * batchId (a day's batch — the cross-run grouping), runId, outcome, or status.
 * Pure over run metadata (single listRuns read, no event fan-out). Returns at
 * most `limit` matches with an explicit `capped` flag rather than silently
 * truncating.
 */
export function searchWorkforceTrace(
  runs: readonly { runId: string; status: string; createdAt: string; metadata: Record<string, unknown> }[],
  workforceId: string,
  query: string,
  limit = 50,
): TraceSearchResult {
  const q = query.trim().toLowerCase();
  const mine = runs.filter((r) => (r.metadata as RunMeta).workforceId === workforceId);
  const hits = q
    ? mine.filter((r) => {
        const m = r.metadata as RunMeta;
        return [r.runId, m.correlationId, m.batchId, m.outcome, r.status].some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(q),
        );
      })
    : [];
  const matches: TraceMatch[] = hits.slice(0, limit).map((r) => {
    const m = r.metadata as RunMeta;
    return {
      runId: r.runId,
      correlationId: m.correlationId ?? null,
      batchId: m.batchId ?? null,
      outcome: m.outcome ?? null,
      status: r.status,
      startedAt: r.createdAt,
    };
  });
  return { query, matches, scanned: mine.length, capped: hits.length > matches.length };
}

// ---- shadow & prove comparison (EP1 MG-5 / EV-4 — RFC 0090 pilot) ----------
//
// Host-extension PILOT of RFC 0090's ShadowComparison shape (`shadow-run.md §D`).
// It does NOT implement the core wire surface (capabilities.shadow + the
// run-creation `shadow` field + baseline-leg execution) — that is the
// reference-host follow-up that flips RFC 0090 to Accepted. Here we surface the
// comparison over the workforce's existing runs, framing the human override as
// the baseline: the agent "agreed" with the baseline when its decision stood
// (clean / escalated→approved) and "diverged" when a human overrode it or it
// was later flagged a false positive. Content-free per RFC 0090 §Security:
// divergences carry DIGESTS, never raw output values.

export interface ShadowDivergence {
  key: string;
  agentDigest: string;
  baselineDigest: string;
}
export interface ShadowComparison {
  workforceId: string;
  status: 'agree' | 'diverge' | 'pending';
  baseline: { mode: 'external' | 'replay'; runId: string | null };
  agreementRate: number;
  overrideRate: number;
  divergenceCount: number;
  divergences: ShadowDivergence[];
}

function shadowDigest(s: string): string {
  return `sha256:${createHash('sha256').update(s).digest('hex').slice(0, 16)}`;
}

const SHADOW_AGREE = new Set(['clean', 'escalated']);
const SHADOW_DIVERGE = new Set(['overridden', 'false-positive']);

export function aggregateShadowComparison(
  runs: readonly { runId: string; status: string; metadata: Record<string, unknown> }[],
  workforceId: string,
  limit = 20,
): ShadowComparison {
  const mine = runs.filter((r) => (r.metadata as RunMeta).workforceId === workforceId);
  const outcome = (r: (typeof mine)[number]): string => (r.metadata as RunMeta).outcome ?? '';

  const agree = mine.filter((r) => SHADOW_AGREE.has(outcome(r)));
  const diverge = mine.filter((r) => SHADOW_DIVERGE.has(outcome(r)));
  const decided = agree.length + diverge.length;

  const approvalRequested = mine.filter((r) => APPROVAL_OUTCOMES.has(outcome(r))).length;
  const overridden = mine.filter((r) => outcome(r) === 'overridden').length;

  const divergences: ShadowDivergence[] = diverge.slice(0, limit).map((r) => ({
    key: r.runId,
    // digests differ — that IS the divergence; raw values never leave the host.
    agentDigest: shadowDigest(`agent:${outcome(r)}:${r.runId}`),
    baselineDigest: shadowDigest(`baseline:${outcome(r)}:${r.runId}`),
  }));

  return {
    workforceId,
    status: decided === 0 ? 'pending' : agree.length / decided >= 0.9 ? 'agree' : 'diverge',
    baseline: { mode: 'external', runId: null },
    agreementRate: decided ? Number((agree.length / decided).toFixed(4)) : 0,
    overrideRate: approvalRequested ? Number((overridden / approvalRequested).toFixed(4)) : 0,
    divergenceCount: diverge.length,
    divergences,
  };
}
