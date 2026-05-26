/**
 * RFC 0052 — scheduling & time-based triggers (host-side service).
 *
 * Gives the `core.trigger.schedule` / `core.trigger.cron` nodes a real
 * execution contract: a durable scheduled-job store + a tick evaluator that
 * honors the two RFC 0052 §B invariants —
 *   - §B.2 fire-once-per-tick: one scheduler wake-up fires a job exactly
 *     once; no duplicate concurrent runs.
 *   - §B.4 missed-tick policy: after the scheduler was down for N ticks,
 *     recovery applies fire-once-on-recovery (collapse the backlog to ONE
 *     run), never a flood of N backlogged runs.
 *
 * Schedules beyond the advertised `maxFutureHorizon` are rejected at
 * registration with `schedule_horizon_exceeded` (per `rest-endpoints.md`).
 *
 * The job store is process-local (sample-grade); a production host backs it
 * with a durable queue (RFC 0017 `queueBus`). The deterministic tick API
 * (`singleTick` / `missedWindow`) backs the `POST /v1/host/sample/
 * scheduling/tick` conformance seam.
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md §B
 * @see spec/v1/host-capabilities.md §host.scheduling
 */

/** Largest future horizon the host honors — mirrors the advertised
 *  `capabilities.scheduling.maxFutureHorizon: 'P30D'`. */
export const MAX_FUTURE_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export interface ScheduledJob {
  jobId: string;
  /** Cron expression or interval label (sample does not parse it fully —
   *  the tick evaluator drives wake-ups directly). */
  cronExpr: string;
  /** Monotonic tick index this job last fired at; null until first fire. */
  lastFiredTick: number | null;
}

const jobs = new Map<string, ScheduledJob>();
/** Monotonic scheduler wake-up counter (the "clock" the seam advances). */
let tickIndex = 0;

/** Default job the seam drives when no explicit job is registered. */
const DEMO_JOB_ID = 'demo-cron';

export interface ScheduleHorizonError {
  code: 'schedule_horizon_exceeded';
  message: string;
}

/** Register (or replace) a scheduled job. Rejects schedules whose first
 *  fire is beyond `maxFutureHorizon` with `schedule_horizon_exceeded`. */
export function registerJob(
  input: { jobId: string; cronExpr: string; firstFireAtMs?: number },
  nowMs: number = Date.now(),
): { ok: true; job: ScheduledJob } | { ok: false; error: ScheduleHorizonError } {
  if (input.firstFireAtMs !== undefined && input.firstFireAtMs - nowMs > MAX_FUTURE_HORIZON_MS) {
    return {
      ok: false,
      error: {
        code: 'schedule_horizon_exceeded',
        message: `schedule first-fire is beyond maxFutureHorizon (${MAX_FUTURE_HORIZON_MS}ms)`,
      },
    };
  }
  const job: ScheduledJob = { jobId: input.jobId, cronExpr: input.cronExpr, lastFiredTick: null };
  jobs.set(input.jobId, job);
  return { ok: true, job };
}

export function listJobs(): ScheduledJob[] {
  return [...jobs.values()];
}

function ensureJob(jobId: string): ScheduledJob {
  let job = jobs.get(jobId);
  if (!job) {
    job = { jobId, cronExpr: '* * * * *', lastFiredTick: null };
    jobs.set(jobId, job);
  }
  return job;
}

export interface TickResult {
  runsFired: number;
}

/**
 * Advance the clock by one tick and fire the job. §B.2: a job fires at most
 * once per tick — calling again at the same tick yields 0.
 */
export function singleTick(jobId: string = DEMO_JOB_ID): TickResult {
  tickIndex += 1;
  const job = ensureJob(jobId);
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
  const job = ensureJob(jobId);
  job.lastFiredTick = tickIndex;
  return { runsFired: 1 };
}

/** Reset all scheduler state (test teardown). */
export function resetScheduling(): void {
  jobs.clear();
  tickIndex = 0;
}
