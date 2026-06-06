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

import { DurableCollection } from './hostExtPersistence.js';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import { generateWorkforceHistory } from './workforceHistory.js';
import type { Workforce } from './workforce.js';
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
  const runCount = opts.runCount ?? 300;
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
