#!/usr/bin/env node
/**
 * CF-10 — SSE longevity soak runner.
 *
 * Out-of-fast-CI exerciser for the SSE event stream. Holds a stream
 * open against a host for a configurable duration, counts events,
 * tracks reconnects + keep-alive heartbeats + timeout behavior, and
 * produces a single JSON line summarizing the outcome.
 *
 * Why this exists: `webhook-signed-delivery.test.ts` + `sse.test.ts`
 * (in each reference host's test/) cover the FAST path. They run in
 * a few seconds and can't catch issues that emerge over minutes-to-
 * hours: heartbeat starvation, browser/proxy idle-disconnect, server
 * graceful-restart event-resumption, TCP keep-alive interaction.
 * This soak runner is the documented opt-in path for those.
 *
 * Usage:
 *
 *   OPENWOP_BASE_URL=https://your-host.example.com \
 *   OPENWOP_API_KEY=hk_test_... \
 *   OPENWOP_SOAK_DURATION_SECONDS=600 \
 *   OPENWOP_SOAK_RUN_INTERVAL_SECONDS=30 \
 *   node conformance/soak/sse-longevity.mjs
 *
 * Output (single JSON line on stdout):
 *
 *   {
 *     "ok": true,
 *     "durationSeconds": 600,
 *     "runsCreated": 20,
 *     "totalEventsReceived": 80,
 *     "reconnects": 0,
 *     "heartbeatsObserved": 60,
 *     "longestQuietSeconds": 14,
 *     "minHeartbeatGapSeconds": 8,
 *     "maxHeartbeatGapSeconds": 12,
 *     "errors": []
 *   }
 *
 * Exit codes:
 *   0 — soak completed without unrecoverable errors
 *   1 — fatal connection / auth error (details in `errors`)
 *
 * NOT registered in `openwop:check`. CI-level invocation is
 * deployer's choice — see PRODUCTION-RUNBOOK.md §"Daily-check
 * list" for the recommended cadence.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.OPENWOP_BASE_URL?.replace(/\/$/, '');
const API_KEY = process.env.OPENWOP_API_KEY;
const DURATION = Number(process.env.OPENWOP_SOAK_DURATION_SECONDS ?? 300);
const RUN_INTERVAL = Number(process.env.OPENWOP_SOAK_RUN_INTERVAL_SECONDS ?? 30);
const FIXTURE = process.env.OPENWOP_SOAK_FIXTURE ?? 'conformance-noop';

if (!BASE || !API_KEY) {
  process.stderr.write(
    'OPENWOP_BASE_URL and OPENWOP_API_KEY are required.\n' +
      'Usage: OPENWOP_BASE_URL=https://host OPENWOP_API_KEY=hk ... node conformance/soak/sse-longevity.mjs\n',
  );
  process.exit(2);
}
if (!Number.isFinite(DURATION) || DURATION < 30) {
  process.stderr.write('OPENWOP_SOAK_DURATION_SECONDS must be >= 30.\n');
  process.exit(2);
}

const headers = { Authorization: `Bearer ${API_KEY}` };
const startMs = Date.now();
const deadlineMs = startMs + DURATION * 1000;

const errors = [];
let runsCreated = 0;
let totalEventsReceived = 0;
let reconnects = 0;
let heartbeatsObserved = 0;
let lastFrameAtMs = startMs;
let lastHeartbeatAtMs = null;
let longestQuietMs = 0;
let minHeartbeatGapMs = Infinity;
let maxHeartbeatGapMs = 0;

/**
 * Start a run + open an SSE stream against it. Resolves when the
 * stream closes naturally OR on first error. Errors get recorded
 * but do not halt the soak — we want to observe reconnect behavior.
 */
async function streamOneRun() {
  try {
    const createRes = await fetch(`${BASE}/v1/runs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: FIXTURE }),
    });
    if (!createRes.ok) {
      errors.push({
        at: new Date().toISOString(),
        kind: 'create_run_failed',
        status: createRes.status,
        body: await createRes.text(),
      });
      return;
    }
    runsCreated++;
    const { runId } = await createRes.json();

    const sseRes = await fetch(
      `${BASE}/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates`,
      { headers: { ...headers, Accept: 'text/event-stream' } },
    );
    if (!sseRes.ok || !sseRes.body) {
      errors.push({
        at: new Date().toISOString(),
        kind: 'sse_open_failed',
        runId,
        status: sseRes.status,
      });
      return;
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const now = Date.now();
      const quietMs = now - lastFrameAtMs;
      if (quietMs > longestQuietMs) longestQuietMs = quietMs;
      lastFrameAtMs = now;

      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.startsWith(':')) {
          heartbeatsObserved++;
          if (lastHeartbeatAtMs !== null) {
            const gap = now - lastHeartbeatAtMs;
            if (gap < minHeartbeatGapMs) minHeartbeatGapMs = gap;
            if (gap > maxHeartbeatGapMs) maxHeartbeatGapMs = gap;
          }
          lastHeartbeatAtMs = now;
        } else if (frame.length > 0) {
          totalEventsReceived++;
        }
      }
    }
  } catch (err) {
    errors.push({
      at: new Date().toISOString(),
      kind: 'sse_stream_error',
      message: err instanceof Error ? err.message : String(err),
    });
    reconnects++;
  }
}

async function main() {
  while (Date.now() < deadlineMs) {
    await streamOneRun();
    const remaining = deadlineMs - Date.now();
    if (remaining > RUN_INTERVAL * 1000) {
      await sleep(RUN_INTERVAL * 1000);
    } else if (remaining > 0) {
      await sleep(remaining);
    }
  }
  const fatal = errors.some((e) => e.kind === 'create_run_failed' && e.status === 401);
  const summary = {
    ok: !fatal,
    durationSeconds: Math.round((Date.now() - startMs) / 1000),
    runsCreated,
    totalEventsReceived,
    reconnects,
    heartbeatsObserved,
    longestQuietSeconds: Math.round(longestQuietMs / 1000),
    minHeartbeatGapSeconds: Number.isFinite(minHeartbeatGapMs)
      ? Math.round(minHeartbeatGapMs / 1000)
      : null,
    maxHeartbeatGapSeconds: maxHeartbeatGapMs > 0 ? Math.round(maxHeartbeatGapMs / 1000) : null,
    errors,
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
  process.exit(fatal ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
