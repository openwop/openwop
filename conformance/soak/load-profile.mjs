#!/usr/bin/env node
/**
 * OPS-2 — Load profile runner.
 *
 * Out-of-fast-CI throughput / latency exerciser across five canonical
 * paths an OpenWOP host serves. Companion to
 * `conformance/soak/sse-longevity.mjs` (which is long-stream-oriented);
 * this runner is short-burst throughput-oriented.
 *
 * Paths exercised (configurable via `OPENWOP_LOAD_PATHS=create,poll,sse,
 * interrupt,webhook`, default all five):
 *
 *   - `create`     — `POST /v1/runs` create-run throughput.
 *   - `poll`       — `GET /v1/runs/{id}/events/poll` polling latency.
 *   - `sse`        — first-event-arrived latency on SSE stream.
 *   - `interrupt`  — `POST /v1/interrupts/{token}` resolve latency
 *                    (skipped when no fixture produces an interrupt).
 *   - `webhook`    — `POST /v1/webhooks` register + first-delivery
 *                    latency to a local receiver.
 *
 * Each path emits a stats record with min / p50 / p95 / p99 / max
 * latency (milliseconds) over the requested sample count.
 *
 * Usage:
 *
 *   OPENWOP_BASE_URL=https://your-host.example.com \
 *   OPENWOP_API_KEY=hk_test_... \
 *   OPENWOP_LOAD_SAMPLES=100 \
 *   OPENWOP_LOAD_CONCURRENCY=4 \
 *   OPENWOP_LOAD_PATHS=create,poll \
 *   node conformance/soak/load-profile.mjs
 *
 * Output (single JSON line on stdout):
 *
 *   {
 *     "ok": true,
 *     "host": { "name": "...", "baseUrl": "https://..." },
 *     "samples": 100,
 *     "concurrency": 4,
 *     "paths": {
 *       "create": { "samples": 100, "errors": 0, "min": 12, "p50": 18,
 *                   "p95": 41, "p99": 73, "max": 110, "totalMs": 1840 },
 *       "poll":   { ... },
 *       ...
 *     },
 *     "errors": []
 *   }
 *
 * Exit codes:
 *   0 — load profile completed; per-path errors recorded inline
 *   1 — fatal auth / connection error
 *   2 — bad env / arg
 *
 * NOT registered in `openwop:check`. CI-level invocation is
 * deployer's choice — see `docs/PRODUCTION-RUNBOOK.md` §"What you
 * check daily" for the recommended cadence.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.OPENWOP_BASE_URL?.replace(/\/$/, '');
const API_KEY = process.env.OPENWOP_API_KEY;
const SAMPLES = Number(process.env.OPENWOP_LOAD_SAMPLES ?? 50);
const CONCURRENCY = Number(process.env.OPENWOP_LOAD_CONCURRENCY ?? 2);
const FIXTURE = process.env.OPENWOP_LOAD_FIXTURE ?? 'conformance-noop';
const PATHS = (process.env.OPENWOP_LOAD_PATHS ?? 'create,poll,sse')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!BASE || !API_KEY) {
  process.stderr.write(
    'OPENWOP_BASE_URL and OPENWOP_API_KEY are required.\n' +
      'Usage: OPENWOP_BASE_URL=https://host OPENWOP_API_KEY=hk ... node conformance/soak/load-profile.mjs\n',
  );
  process.exit(2);
}
if (!Number.isFinite(SAMPLES) || SAMPLES < 1) {
  process.stderr.write('OPENWOP_LOAD_SAMPLES must be >= 1.\n');
  process.exit(2);
}
if (!Number.isFinite(CONCURRENCY) || CONCURRENCY < 1) {
  process.stderr.write('OPENWOP_LOAD_CONCURRENCY must be >= 1.\n');
  process.exit(2);
}

const headers = { Authorization: `Bearer ${API_KEY}` };
const errors = [];

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

function statsFor(timings, pathErrors) {
  if (timings.length === 0) {
    return { samples: 0, errors: pathErrors, min: null, p50: null, p95: null, p99: null, max: null, totalMs: 0 };
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    samples: sorted.length,
    errors: pathErrors,
    min: sorted[0],
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    totalMs: Math.round(sum),
  };
}

async function runConcurrent(samples, concurrency, task) {
  const timings = [];
  let pathErrors = 0;
  const queue = Array.from({ length: samples }, (_, i) => i);
  async function worker() {
    while (queue.length > 0) {
      const idx = queue.shift();
      const start = Date.now();
      try {
        await task(idx);
        timings.push(Date.now() - start);
      } catch (err) {
        pathErrors++;
        errors.push({ at: new Date().toISOString(), kind: 'task_failed', message: String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return statsFor(timings, pathErrors);
}

// ─── Path: create ─────────────────────────────────────────────────────
async function pathCreate() {
  return runConcurrent(SAMPLES, CONCURRENCY, async () => {
    const res = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: FIXTURE }),
    });
    if (!res.ok) throw new Error(`create_run ${res.status}`);
    await res.json();
  });
}

// ─── Path: poll ───────────────────────────────────────────────────────
// Creates one run + polls until terminal; measures per-poll latency.
async function pathPoll() {
  // First create a long-lived run so polling has events to report.
  const createRes = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: FIXTURE }),
  });
  if (!createRes.ok) throw new Error(`create_run ${createRes.status}`);
  const { runId } = await createRes.json();

  return runConcurrent(SAMPLES, CONCURRENCY, async () => {
    const res = await fetch(
      `${BASE}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
      { headers },
    );
    if (!res.ok) throw new Error(`events_poll ${res.status}`);
    await res.json();
  });
}

// ─── Path: sse ────────────────────────────────────────────────────────
// First-event-arrival latency. SAMPLES streams sequentially.
async function pathSse() {
  const timings = [];
  let pathErrors = 0;
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const createRes = await fetch(`${BASE}/v1/runs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: FIXTURE }),
      });
      if (!createRes.ok) throw new Error(`create_run ${createRes.status}`);
      const { runId } = await createRes.json();

      const start = Date.now();
      const sseRes = await fetch(
        `${BASE}/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates`,
        { headers: { ...headers, Accept: 'text/event-stream' } },
      );
      if (!sseRes.ok || !sseRes.body) throw new Error(`sse_open ${sseRes.status}`);

      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let firstEventAt = null;
      while (firstEventAt === null) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Frame delimiter is `\n\n`; non-comment frames are events.
        const split = buffer.split('\n\n');
        for (const frame of split.slice(0, -1)) {
          if (!frame.startsWith(':') && frame.length > 0) {
            firstEventAt = Date.now();
            break;
          }
        }
      }
      try {
        await reader.cancel();
      } catch {
        // ignore cancel failures
      }
      if (firstEventAt === null) {
        pathErrors++;
      } else {
        timings.push(firstEventAt - start);
      }
    } catch (err) {
      pathErrors++;
      errors.push({ at: new Date().toISOString(), kind: 'sse_task_failed', message: String(err) });
    }
  }
  return statsFor(timings, pathErrors);
}

// ─── Path: interrupt + webhook (placeholders) ─────────────────────────
// Both require specific host shape; documented as unimplemented in this
// runner until a host-side seam stabilizes. Honest stub instead of fake
// data — operators see this and know to wire them later.
async function pathInterrupt() {
  return {
    samples: 0,
    errors: 0,
    min: null,
    p50: null,
    p95: null,
    p99: null,
    max: null,
    totalMs: 0,
    note: 'interrupt path requires a fixture that suspends; not yet exercised in this runner.',
  };
}

async function pathWebhook() {
  return {
    samples: 0,
    errors: 0,
    min: null,
    p50: null,
    p95: null,
    p99: null,
    max: null,
    totalMs: 0,
    note: 'webhook path requires a local receiver + SSRF-guard exemption; not yet exercised in this runner.',
  };
}

async function main() {
  const startMs = Date.now();
  const results = {};
  const handlers = {
    create: pathCreate,
    poll: pathPoll,
    sse: pathSse,
    interrupt: pathInterrupt,
    webhook: pathWebhook,
  };

  for (const path of PATHS) {
    const handler = handlers[path];
    if (!handler) {
      errors.push({ at: new Date().toISOString(), kind: 'unknown_path', path });
      continue;
    }
    try {
      results[path] = await handler();
    } catch (err) {
      errors.push({ at: new Date().toISOString(), kind: 'path_handler_threw', path, message: String(err) });
    }
  }

  const summary = {
    ok: errors.length === 0,
    host: { baseUrl: BASE },
    samples: SAMPLES,
    concurrency: CONCURRENCY,
    durationSeconds: Math.round((Date.now() - startMs) / 1000),
    paths: results,
    errors,
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
  process.exit(errors.length === 0 ? 0 : 1);
}

void sleep; // reserved for future inter-batch pacing
main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
