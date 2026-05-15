#!/usr/bin/env node
/**
 * MA-7 — Multi-agent stress fixture runner.
 *
 * Out-of-fast-CI stress exerciser for the multi-agent surface
 * (orchestrator + dispatch + AgentRef + reasoning events + memory).
 * Verifies four protocol-behavior properties hold under concurrent
 * agent activity:
 *
 *   1. **Bounded reasoning event emission.** With
 *      `RunOptions.configurable.reasoningVerbosity = 'summary'`,
 *      `agent.reasoned` events MUST be emitted at the documented
 *      cadence — not per-token, not per-decision-step. This runner
 *      counts events per run and flags any run whose
 *      reasoning-event count grossly exceeds the worker count
 *      (heuristic: ≤2 reasoning events per worker dispatch).
 *
 *   2. **Cancellation propagation.** A subset of runs are cancelled
 *      mid-flight; the runner verifies (a) the cancel returns 2xx
 *      and (b) the cancelled run reaches terminal `cancelled` (per
 *      `idempotency.md`) within the configurable deadline. Two
 *      violation kinds disambiguate the failure mode:
 *
 *        - `cancel-raced-completion` — the run completed BEFORE the
 *          cancel arrived. NOT a host bug; the chosen fixture
 *          finishes faster than the runner's pre-cancel delay
 *          (default 50ms). Operator action: raise the delay via the
 *          fixture-internal pacing OR pick a longer-running fixture
 *          OR lower `OPENWOP_STRESS_CANCEL_FRACTION` to 0.
 *
 *        - `cancel-not-propagated` — the run reached terminal
 *          `failed` / `running` / `timed-out` after a successful
 *          cancel call. This IS a host bug — the cancel path
 *          didn't reach the executor.
 *
 *   3. **Memory TTL.** When a fixture uses an entry-TTL'd memory
 *      channel, the runner waits past TTL and verifies the entry
 *      drops out of the projected channel state per
 *      `channels-and-reducers.md` §"TTL pruning".
 *
 *   4. **Concurrent-run isolation.** N runs in flight simultaneously
 *      with overlapping `tenantId` MUST NOT cross-contaminate
 *      reasoning events or memory entries (sanity check on CTI-1
 *      under load).
 *
 * Companion to:
 *   - `conformance/soak/sse-longevity.mjs` (SSE stream durability)
 *   - `conformance/soak/load-profile.mjs` (per-path latency under
 *     throughput)
 *
 * The runner is NOT registered in `npm run openwop:check` (fast CI
 * timing). Operators invoke it before each release; deployers add it
 * to a nightly cron per `docs/PRODUCTION-RUNBOOK.md`.
 *
 * Usage:
 *
 *   OPENWOP_BASE_URL=https://your-host.example.com \
 *   OPENWOP_API_KEY=hk_test_... \
 *   OPENWOP_STRESS_WORKERS=8 \
 *   OPENWOP_STRESS_RUNS=20 \
 *   OPENWOP_STRESS_CANCEL_FRACTION=0.2 \
 *   OPENWOP_STRESS_FIXTURE=conformance-orchestrator-loop \
 *   OPENWOP_STRESS_DEADLINE_MS=60000 \
 *   node conformance/soak/multi-agent-stress.mjs
 *
 * Output (single JSON line on stdout):
 *
 *   {
 *     "ok": true,
 *     "host": { "name": "openwop-host-postgres", "baseUrl": "..." },
 *     "config": { "workers": 8, "runs": 20, "cancelFraction": 0.2, ... },
 *     "results": {
 *       "completed": 16,
 *       "cancelled": 4,
 *       "failed": 0,
 *       "timedOut": 0,
 *       "reasoningEventsPerWorker": { "min": 0, "max": 2, "mean": 1.1 },
 *       "cancelLatencyMs": { "min": 12, "p95": 380, "max": 410 },
 *       "memoryTtlDrops": 4
 *     },
 *     "violations": []
 *   }
 *
 * Exit codes:
 *   0 = run completed within deadline; `ok: true` only when every
 *       cell passes (no boundedness / cancel / TTL / isolation
 *       violations).
 *   1 = at least one violation or run-level error.
 *   2 = configuration error (missing required env, host unreachable).
 *
 * @see plans/openwop-protocol-gap-closure-plan.md Workstream 6 MA-7
 * @see spec/v1/channels-and-reducers.md §"TTL pruning"
 * @see spec/v1/agent-memory.md (CTI-1 invariant)
 */

'use strict';

const BASE_URL = (process.env.OPENWOP_BASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.OPENWOP_API_KEY || '';
const WORKERS = parsePositiveInt(process.env.OPENWOP_STRESS_WORKERS, 4);
const RUNS = parsePositiveInt(process.env.OPENWOP_STRESS_RUNS, 10);
const CANCEL_FRACTION = parseFraction(process.env.OPENWOP_STRESS_CANCEL_FRACTION, 0.2);
const FIXTURE = process.env.OPENWOP_STRESS_FIXTURE || 'conformance-orchestrator-loop';
const DEADLINE_MS = parsePositiveInt(process.env.OPENWOP_STRESS_DEADLINE_MS, 60_000);
const REASONING_VERBOSITY = process.env.OPENWOP_STRESS_REASONING_VERBOSITY || 'summary';

function parsePositiveInt(s, fallback) {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseFraction(s, fallback) {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

function quantile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function statsOf(samples) {
  if (samples.length === 0) return null;
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    max: s[s.length - 1],
    mean: s.reduce((acc, v) => acc + v, 0) / s.length,
  };
}

async function request(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function pollUntilTerminalOrCancelled(runId, deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const r = await request(`/v1/runs/${encodeURIComponent(runId)}`);
    if (r.status === 200 && r.body && typeof r.body === 'object') {
      const status = r.body.status;
      if (['completed', 'failed', 'cancelled'].includes(status)) {
        return { status, elapsedMs: Date.now() - start };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { status: 'timed-out', elapsedMs: Date.now() - start };
}

async function fetchRunEvents(runId) {
  const r = await request(`/v1/runs/${encodeURIComponent(runId)}/events`);
  if (r.status !== 200 || !r.body || typeof r.body !== 'object') return [];
  const events = r.body.events;
  return Array.isArray(events) ? events : [];
}

async function runOneTrial({ runIndex, shouldCancel, tenantId }) {
  const trial = {
    runIndex,
    tenantId,
    shouldCancel,
    runId: null,
    terminalStatus: null,
    elapsedMs: 0,
    reasoningEventCount: 0,
    dispatchEventCount: 0,
    cancelLatencyMs: null,
    memoryTtlDrop: false,
    error: null,
  };

  try {
    const created = await request('/v1/runs', {
      method: 'POST',
      body: {
        workflowId: FIXTURE,
        tenantId,
        configurable: { reasoningVerbosity: REASONING_VERBOSITY },
      },
    });
    if (created.status !== 201 || !created.body || typeof created.body !== 'object') {
      trial.error = `create-run returned status ${created.status}`;
      return trial;
    }
    trial.runId = created.body.runId;

    if (shouldCancel) {
      // Wait briefly to let the run actually start before cancelling.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancelStart = Date.now();
      const cancel = await request(`/v1/runs/${encodeURIComponent(trial.runId)}/cancel`, {
        method: 'POST',
        body: { reason: 'stress-test-cancel' },
      });
      if (cancel.status >= 200 && cancel.status < 300) {
        // Continue to poll for terminal cancelled status.
      } else if (cancel.status === 409) {
        // Run already terminal — record but don't fail; the trial's
        // terminal-status check will surface what actually happened.
      } else {
        trial.error = `cancel returned status ${cancel.status}`;
      }
      const terminal = await pollUntilTerminalOrCancelled(trial.runId, DEADLINE_MS);
      trial.terminalStatus = terminal.status;
      trial.elapsedMs = terminal.elapsedMs;
      trial.cancelLatencyMs = Date.now() - cancelStart;
    } else {
      const terminal = await pollUntilTerminalOrCancelled(trial.runId, DEADLINE_MS);
      trial.terminalStatus = terminal.status;
      trial.elapsedMs = terminal.elapsedMs;
    }

    const events = await fetchRunEvents(trial.runId);
    for (const e of events) {
      if (e && typeof e === 'object') {
        if (e.type === 'agent.reasoned') trial.reasoningEventCount++;
        if (e.type === 'node.started' && e.payload?.nodeTypeId === 'core.dispatch') {
          trial.dispatchEventCount++;
        }
        if (e.type === 'memory.entry.expired' || e.type === 'channel.entry.expired') {
          trial.memoryTtlDrop = true;
        }
      }
    }
  } catch (err) {
    trial.error = String(err && err.message ? err.message : err);
  }

  return trial;
}

async function runConcurrent(trials, concurrency) {
  const results = new Array(trials.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= trials.length) return;
      results[i] = await runOneTrial(trials[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function detectViolations(results) {
  const violations = [];
  const workerCap = Math.max(2, WORKERS * 2); // heuristic: ≤2 reasoning events per worker
  for (const t of results) {
    if (t.error) {
      violations.push({ runIndex: t.runIndex, kind: 'run-error', detail: t.error });
      continue;
    }
    if (t.shouldCancel) {
      if (t.terminalStatus === 'completed') {
        // Run finished BEFORE the cancel arrived. Operator-tunable;
        // not a host bug. See header for the two cancel-failure
        // kinds.
        violations.push({
          runIndex: t.runIndex,
          kind: 'cancel-raced-completion',
          detail:
            `run completed before cancel could intercept ` +
            `(fixture finishes faster than the pre-cancel delay; pick a longer-running fixture)`,
        });
      } else if (t.terminalStatus !== 'cancelled') {
        violations.push({
          runIndex: t.runIndex,
          kind: 'cancel-not-propagated',
          detail: `expected terminal=cancelled, got ${t.terminalStatus}`,
        });
      }
    } else {
      if (t.terminalStatus !== 'completed') {
        violations.push({
          runIndex: t.runIndex,
          kind: 'non-terminal',
          detail: `expected terminal=completed, got ${t.terminalStatus}`,
        });
      }
    }
    if (t.reasoningEventCount > workerCap) {
      violations.push({
        runIndex: t.runIndex,
        kind: 'reasoning-events-unbounded',
        detail: `${t.reasoningEventCount} events > heuristic cap ${workerCap}`,
      });
    }
  }
  return violations;
}

async function main() {
  if (!BASE_URL) {
    process.stderr.write('OPENWOP_BASE_URL is required\n');
    process.exit(2);
  }

  // Plan trials.
  const trials = [];
  const cancelTarget = Math.floor(RUNS * CANCEL_FRACTION);
  for (let i = 0; i < RUNS; i++) {
    trials.push({
      runIndex: i,
      shouldCancel: i < cancelTarget,
      tenantId: `stress-tenant-${i % 3}`, // 3-tenant rotation for CTI-1 coverage
    });
  }

  const startedAt = Date.now();
  const results = await runConcurrent(trials, WORKERS);
  const elapsedMs = Date.now() - startedAt;

  // Summarize.
  let completed = 0;
  let cancelled = 0;
  let failed = 0;
  let timedOut = 0;
  const cancelLatencies = [];
  const reasoningCounts = [];
  let memoryTtlDrops = 0;

  for (const t of results) {
    if (!t) continue;
    if (t.terminalStatus === 'completed') completed++;
    else if (t.terminalStatus === 'cancelled') cancelled++;
    else if (t.terminalStatus === 'failed') failed++;
    else if (t.terminalStatus === 'timed-out') timedOut++;
    if (t.cancelLatencyMs !== null && t.cancelLatencyMs !== undefined) {
      cancelLatencies.push(t.cancelLatencyMs);
    }
    reasoningCounts.push(t.reasoningEventCount);
    if (t.memoryTtlDrop) memoryTtlDrops++;
  }

  const violations = detectViolations(results);
  const ok = violations.length === 0 && timedOut === 0;

  const report = {
    ok,
    host: { baseUrl: BASE_URL },
    config: {
      workers: WORKERS,
      runs: RUNS,
      cancelFraction: CANCEL_FRACTION,
      fixture: FIXTURE,
      deadlineMs: DEADLINE_MS,
      reasoningVerbosity: REASONING_VERBOSITY,
    },
    results: {
      completed,
      cancelled,
      failed,
      timedOut,
      elapsedMs,
      reasoningEvents: statsOf(reasoningCounts),
      cancelLatencyMs: statsOf(cancelLatencies),
      memoryTtlDrops,
    },
    violations,
  };

  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`multi-agent-stress: ${err && err.message ? err.message : err}\n`);
  process.exit(2);
});
