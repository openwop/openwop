/**
 * RFC 0052 — scheduling & time-based triggers (host-side service).
 *
 * Two cleanly separated concerns live here:
 *
 *  1. The DETERMINISTIC TICK SEAM (`singleTick` / `missedWindow` / `currentTick`)
 *     — an in-memory, synchronous clock that backs the
 *     `POST /v1/host/sample/scheduling/tick` conformance seam. It honors the
 *     two RFC 0052 §B invariants:
 *       - §B.2 fire-once-per-tick: one scheduler wake-up fires a job exactly
 *         once; no duplicate concurrent runs.
 *       - §B.4 missed-tick policy: after the scheduler was down for N ticks,
 *         recovery applies fire-once-on-recovery (collapse the backlog to ONE
 *         run), never a flood of N backlogged runs.
 *     This stays in-memory on purpose: it is a per-process test clock the
 *     conformance harness drives within one process; durability is irrelevant.
 *
 *  2. The DURABLE JOB STORE (`registerJob` / `listJobs` / `getJob` /
 *     `deleteJob` / `setJobEnabled` / `markJobFired` / `listJobsByRoster`) —
 *     the CRUD surface behind `/v1/host/sample/scheduler/jobs`. Backed by the
 *     read-through per-entity `DurableCollection` (host/hostExtPersistence.ts)
 *     so jobs survive a restart AND a job created on one Cloud Run instance is
 *     visible on every other (the app scales to max=10). Jobs carry optional
 *     roster/agent attribution + a metadata block so a schedule can be scoped
 *     to a named agent (PRD §13) and a schedule-fired run can show its source.
 *
 * Schedules beyond the advertised `maxFutureHorizon` are rejected at
 * registration with `schedule_horizon_exceeded` (per `rest-endpoints.md`).
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 * @see spec/v1/host-capabilities.md §host.scheduling
 */

import { DurableCollection } from './hostExtPersistence.js';
import { computeNextFire } from './cronSchedule.js';

/** Largest future horizon the host honors — mirrors the advertised
 *  `capabilities.scheduling.maxFutureHorizon: 'P30D'`. */
export const MAX_FUTURE_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export interface ScheduledJob {
  jobId: string;
  /** Owning tenant (RFC 0074 carry-forward) — the CRUD surface is tenant-scoped. */
  tenantId: string;
  /** Cron expression or interval label (sample does not parse it fully —
   *  the tick evaluator drives wake-ups directly). */
  cronExpr: string;
  /** Monotonic tick index this job last fired at; null until first fire. */
  lastFiredTick: number | null;
  /** workflowId a tick fires (informational for the CRUD surface). */
  workflowId?: string;
  /** Optional RFCS/0086 roster member that owns this schedule (attribution +
   *  the agent-scoped "Schedules" tab filter). */
  rosterId?: string;
  /** The manifest agent the owning roster member instantiates (attribution). */
  agentId?: string;
  /** Whether the schedule is active. A disabled schedule keeps its row but its
   *  triggers are inert (mirrors the roster `enabled` posture). */
  enabled: boolean;
  /** Free-form attribution carried onto a schedule-fired run's metadata. */
  metadata?: Record<string, unknown>;
  /** runId of the most recent run this schedule fired. */
  lastRunId?: string;
  /** ISO-8601 wall-clock time of the most recent fire (set in markJobFired).
   *  Distinct from `lastFiredTick` (the deterministic tick index); this is the
   *  human-facing "last run …" timestamp. */
  lastRunAt?: string;
  /** IANA timezone the cadence is expressed in. The background daemon
   *  (scheduleDaemon.ts) evaluates the cadence against this zone when computing
   *  `nextFireAt`; the deterministic tick seam still ignores it. */
  timezone?: string;
  /** Epoch-ms wall-clock time the background daemon should next fire this job,
   *  computed from `cronExpr` (+ `timezone`). Undefined when the cron expression
   *  doesn't parse (the daemon skips such jobs) or the schedule is one-shot/spent.
   *  Advanced past each fire in `markJobFired` (collapsing any missed backlog to
   *  the next future slot — RFC 0052 §B.4). */
  nextFireAt?: number;
  /** ISO-8601 registration timestamp (informational). */
  createdAt?: string;
}

// ── 1. Deterministic tick seam (in-memory, synchronous) ──

/** The conformance tick clock's per-job fire bookkeeping. SEPARATE from the
 *  durable CRUD store — this is the process-local test clock only. */
const tickClockJobs = new Map<string, { lastFiredTick: number | null }>();
/** Monotonic scheduler wake-up counter (the "clock" the seam advances). */
let tickIndex = 0;

/** Default job the seam drives when no explicit job is registered. */
const DEMO_JOB_ID = 'demo-cron';

export interface TickResult {
  runsFired: number;
}

function ensureClockJob(jobId: string): { lastFiredTick: number | null } {
  let job = tickClockJobs.get(jobId);
  if (!job) {
    job = { lastFiredTick: null };
    tickClockJobs.set(jobId, job);
  }
  return job;
}

/** The current monotonic tick index (read-only). */
export function currentTick(): number {
  return tickIndex;
}

/**
 * Advance the clock by one tick and fire the job. §B.2: a job fires at most
 * once per tick — calling again at the same tick yields 0.
 */
export function singleTick(jobId: string = DEMO_JOB_ID): TickResult {
  tickIndex += 1;
  const job = ensureClockJob(jobId);
  if (job.lastFiredTick === tickIndex) return { runsFired: 0 };
  job.lastFiredTick = tickIndex;
  return { runsFired: 1 };
}

/**
 * Recover from a window where the scheduler was down for `missedTicks`
 * ticks. §B.4: advance the clock past the missed window and apply
 * fire-once-on-recovery — exactly ONE run, never `missedTicks`.
 */
export function missedWindow(missedTicks: number, jobId: string = DEMO_JOB_ID): TickResult {
  const skipped = Number.isFinite(missedTicks) && missedTicks > 0 ? Math.floor(missedTicks) : 1;
  tickIndex += skipped;
  const job = ensureClockJob(jobId);
  job.lastFiredTick = tickIndex;
  return { runsFired: 1 };
}

// ── 2. Durable CRUD job store ──

const jobs = new DurableCollection<ScheduledJob>('scheduler:job', (j) => j.jobId);

export interface ScheduleHorizonError {
  code: 'schedule_horizon_exceeded';
  message: string;
}

/** Register (or replace) a scheduled job. Rejects schedules whose first
 *  fire is beyond `maxFutureHorizon` with `schedule_horizon_exceeded`. */
export async function registerJob(
  input: {
    jobId: string;
    tenantId: string;
    cronExpr: string;
    firstFireAtMs?: number;
    workflowId?: string;
    rosterId?: string;
    agentId?: string;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
    timezone?: string;
  },
  nowMs: number = Date.now(),
): Promise<{ ok: true; job: ScheduledJob } | { ok: false; error: ScheduleHorizonError }> {
  if (input.firstFireAtMs !== undefined && input.firstFireAtMs - nowMs > MAX_FUTURE_HORIZON_MS) {
    return {
      ok: false,
      error: {
        code: 'schedule_horizon_exceeded',
        message: `schedule first-fire is beyond maxFutureHorizon (${MAX_FUTURE_HORIZON_MS}ms)`,
      },
    };
  }
  const nextFireAt = computeNextFire(input.cronExpr, nowMs, input.timezone);
  const job: ScheduledJob = {
    jobId: input.jobId,
    tenantId: input.tenantId,
    cronExpr: input.cronExpr,
    lastFiredTick: null,
    enabled: input.enabled ?? true,
    ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
    ...(input.rosterId !== undefined ? { rosterId: input.rosterId } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(nextFireAt !== null ? { nextFireAt } : {}),
    createdAt: new Date(nowMs).toISOString(),
  };
  await jobs.put(job);
  return { ok: true, job };
}

/** List a tenant's jobs (or every job when `tenantId` is omitted). */
export async function listJobs(tenantId?: string): Promise<ScheduledJob[]> {
  const all = await jobs.list();
  const scoped = tenantId === undefined ? all : all.filter((j) => j.tenantId === tenantId);
  return scoped.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/** List a single roster member's jobs within a tenant (agent "Schedules" tab). */
export async function listJobsByRoster(tenantId: string, rosterId: string): Promise<ScheduledJob[]> {
  return (await listJobs(tenantId)).filter((j) => j.rosterId === rosterId);
}

/** Fetch a single job by id, or null when none is registered. */
export async function getJob(jobId: string): Promise<ScheduledJob | null> {
  return jobs.get(jobId);
}

/** Remove a job. Returns true when a job was actually deleted. */
export async function deleteJob(jobId: string): Promise<boolean> {
  return jobs.delete(jobId);
}

/** Enable/disable a job. Returns the updated job, or null when not found. */
export async function setJobEnabled(jobId: string, enabled: boolean): Promise<ScheduledJob | null> {
  return updateJob(jobId, { enabled });
}

/** Patch an editable subset of a job (cadence, bound workflow, attribution
 *  label, timezone, enabled). Lets the UI edit a schedule in place instead of
 *  delete-and-recreate. Only provided fields change. Returns the updated job,
 *  or null when not found. */
export async function updateJob(
  jobId: string,
  patch: {
    enabled?: boolean;
    cronExpr?: string;
    workflowId?: string;
    metadata?: Record<string, unknown>;
    timezone?: string;
  },
): Promise<ScheduledJob | null> {
  const job = await jobs.get(jobId);
  if (!job) return null;
  if (patch.enabled !== undefined) job.enabled = patch.enabled;
  if (patch.cronExpr !== undefined) job.cronExpr = patch.cronExpr;
  if (patch.workflowId !== undefined) job.workflowId = patch.workflowId;
  if (patch.metadata !== undefined) job.metadata = patch.metadata;
  if (patch.timezone !== undefined) job.timezone = patch.timezone;
  // Recompute the daemon's next-fire when the cadence or timezone changed.
  if (patch.cronExpr !== undefined || patch.timezone !== undefined) {
    const next = computeNextFire(job.cronExpr, Date.now(), job.timezone);
    if (next !== null) job.nextFireAt = next;
    else delete job.nextFireAt;
  }
  await jobs.put(job);
  return job;
}

/** Record that a job fired (durable bookkeeping for the CRUD surface). */
export async function markJobFired(
  jobId: string,
  tick: number,
  runId?: string,
  firedAtMs: number = Date.now(),
): Promise<void> {
  const job = await jobs.get(jobId);
  if (!job) return;
  job.lastFiredTick = tick;
  job.lastRunAt = new Date(firedAtMs).toISOString();
  if (runId !== undefined) job.lastRunId = runId;
  // Advance the daemon's next-fire strictly past this fire. computeNextFire
  // searches forward from `firedAtMs`, so a backlog accrued while the daemon was
  // down collapses to the next future slot — fire-once-on-recovery (§B.4).
  const next = computeNextFire(job.cronExpr, firedAtMs, job.timezone);
  if (next !== null) job.nextFireAt = next;
  else delete job.nextFireAt;
  await jobs.put(job);
}

/** Record only the most-recent run on a job (lastRunId + lastRunAt), without
 *  touching nextFireAt. The daemon advances nextFireAt BEFORE dispatch (so a
 *  crash can't wedge the schedule), then calls this once the run id is known. */
export async function recordJobRun(jobId: string, runId: string, firedAtMs: number = Date.now()): Promise<void> {
  const job = await jobs.get(jobId);
  if (!job) return;
  job.lastRunId = runId;
  job.lastRunAt = new Date(firedAtMs).toISOString();
  await jobs.put(job);
}

/** Reset all scheduler state (test teardown). Resets the in-memory tick clock
 *  synchronously, then awaits the durable job store clear so a caller that
 *  awaits gets full isolation (e.g. a future count-based assertion). Callers
 *  that don't await still get a correct tick-seam reset. */
export async function resetScheduling(): Promise<void> {
  tickClockJobs.clear();
  tickIndex = 0;
  await jobs.__clear();
}
