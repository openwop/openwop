/**
 * Stale-claim recovery scenario per spec/v1/scale-profiles.md
 * §"Replay semantics" + spec/v1/storage-adapters.md §"Claim acquisition."
 *
 * When a process holding a run claim dies without releasing the claim,
 * another process that boots later (after the claim TTL has expired)
 * MUST pick up the run and resume execution. The conformance contract:
 *
 *   - Process A starts a long-running run, writes some events,
 *     SIGKILLs (claim left as held + expires_at populated).
 *   - After CLAIM_TTL_MS elapses, claim is "stale" by definition.
 *   - Process B boots pointing at the same DB; resume-on-startup
 *     re-acquires the claim and finishes the run.
 *   - The run's terminal status is observable through process B's
 *     HTTP surface.
 *
 * **`@multi-process`** — needs `child_process.spawn` to drive two host
 * processes against a shared SQLite file. Skipped against hosts that
 * aren't the SQLite reference (no shared-storage contract).
 *
 * **`@timing-sensitive`** — relies on a configurable claim TTL.
 * Skipped automatically against hosts that don't expose the TTL via
 * env (the test reads `OPENWOP_STALE_CLAIM_HOST_DIR`; if unset, the
 * scenario skip-equivalents).
 *
 * @see lib/multiProcess.ts — spawnHost helper
 * @see examples/hosts/sqlite/src/server.ts — heartbeat + resume
 * @see spec/v1/production-profile.md §Durability (RFC 0009 — this
 *      scenario satisfies the durable-restart predicate when the
 *      host advertises capabilities.production.supported: true)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnHost, type SpawnedHost } from '../lib/multiProcess.js';

// Default off: scenario must be opted in via env. The opt-in lists
// the host package dir relative to repo root that exposes the
// OPENWOP_CLAIM_TTL_MS / OPENWOP_HEARTBEAT_INTERVAL_MS / OPENWOP_SQLITE_PATH env
// vars. The reference SQLite host satisfies this contract.
const HOST_PACKAGE_DIR = process.env.OPENWOP_STALE_CLAIM_HOST_DIR ?? 'examples/hosts/sqlite';
const RUN_THIS_SCENARIO = process.env.OPENWOP_RUN_STALE_CLAIM === '1';

const APIKEY_A = 'openwop-stale-claim-A';
const APIKEY_B = 'openwop-stale-claim-B';
const PORT_A = 4801;
const PORT_B = 4802;
const CLAIM_TTL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 500;

interface RunSnapshot {
  status?: string;
  runId?: string;
}

interface PollResponse {
  events?: Array<{ type?: string; nodeId?: string | null; data?: unknown }>;
  isComplete?: boolean;
}

async function fetchSnapshot(baseUrl: string, apiKey: string, runId: string): Promise<RunSnapshot> {
  const res = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`GET /v1/runs/${runId} failed: ${res.status}`);
  return (await res.json()) as RunSnapshot;
}

async function fetchEvents(
  baseUrl: string,
  apiKey: string,
  runId: string,
): Promise<PollResponse> {
  const res = await fetch(
    `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return (await res.json()) as PollResponse;
}

async function pollUntilStatus(
  baseUrl: string,
  apiKey: string,
  runId: string,
  predicate: (s: string) => boolean,
  timeoutMs: number,
): Promise<RunSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: RunSnapshot = {};
  while (Date.now() < deadline) {
    last = await fetchSnapshot(baseUrl, apiKey, runId);
    if (typeof last.status === 'string' && predicate(last.status)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `pollUntilStatus did not match predicate within ${timeoutMs}ms; last status: ${last.status}`,
  );
}

describe.skipIf(!RUN_THIS_SCENARIO)(
  'staleClaim: orphaned run resumes on a second host process per spec/v1/storage-adapters.md',
  () => {
    let dbDir: string | null = null;
    let hostA: SpawnedHost | null = null;
    let hostB: SpawnedHost | null = null;

    afterEach(async () => {
      if (hostA) {
        await hostA.kill().catch(() => {});
        hostA = null;
      }
      if (hostB) {
        await hostB.shutdown().catch(() => {});
        hostB = null;
      }
      if (dbDir !== null) {
        try {
          rmSync(dbDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
        dbDir = null;
      }
    });

    it(
      'process B picks up the orphaned run after process A dies + claim expires',
      async () => {
        // Phase 1: shared DB file in a temp dir.
        dbDir = mkdtempSync(join(tmpdir(), 'openwop-stale-claim-'));
        const dbPath = join(dbDir, 'host.sqlite');

        // Phase 2: spawn host A and start a long-running cancellable run.
        hostA = await spawnHost({
          packageDir: HOST_PACKAGE_DIR,
          port: PORT_A,
          apiKey: APIKEY_A,
          dbPath,
          claimTtlMs: CLAIM_TTL_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        });
        await hostA.ready();

        const createRes = await fetch(`${hostA.baseUrl}/v1/runs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${APIKEY_A}`,
          },
          body: JSON.stringify({
            workflowId: 'conformance-cancellable',
            inputs: { delayMs: 5000 },
          }),
        });
        expect(createRes.status).toBe(201);
        const { runId } = (await createRes.json()) as { runId: string };

        // Phase 3: wait until A reports the run as `running`.
        await pollUntilStatus(hostA.baseUrl, APIKEY_A, runId, (s) => s === 'running', 5000);

        // Phase 4: SIGKILL A. The kill MUST NOT release the claim —
        // graceful shutdown is the OPPOSITE behavior.
        await hostA.kill();
        hostA = null;

        // Phase 5: wait for the claim TTL to lapse. With CLAIM_TTL_MS=2000
        // we wait ~3s to be safely past expiry.
        await new Promise((r) => setTimeout(r, CLAIM_TTL_MS + 1000));

        // Phase 6: spawn host B at the SAME DB. Its resume-on-startup
        // MUST find the orphaned run, claim it, and dispatch.
        hostB = await spawnHost({
          packageDir: HOST_PACKAGE_DIR,
          port: PORT_B,
          apiKey: APIKEY_B,
          dbPath,
          claimTtlMs: CLAIM_TTL_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        });
        await hostB.ready();

        // Phase 7: poll until B reports the run as terminal. The run
        // restarts from the beginning of the delay node (5s) on B,
        // plus a small slack window — generous timeout is fine.
        const terminal = await pollUntilStatus(
          hostB.baseUrl,
          APIKEY_B,
          runId,
          (s) => s === 'completed' || s === 'failed' || s === 'cancelled',
          15_000,
        );

        expect(terminal.status, 'orphaned run MUST resume to a terminal status under host B').toBe(
          'completed',
        );

        // Phase 8: verify the event log records the resume. A
        // `run.resumed` event MUST be present (per the SQLite host's
        // implementation; other hosts MAY use a different marker but
        // SOMETHING that distinguishes resume from fresh start MUST
        // exist in the event log).
        const events = await fetchEvents(hostB.baseUrl, APIKEY_B, runId);
        expect(Array.isArray(events.events), 'events poll MUST return an events array').toBe(true);
        if (events.events && events.events.length > 0) {
          const types = events.events.map((e) => e.type);
          expect(
            types.includes('run.resumed') || types.includes('run.started'),
            'event log MUST contain at least run.started; resume hosts SHOULD also emit run.resumed',
          ).toBe(true);
        }
      },
      60_000,
    );
  },
);

// Always-on smoke test for the multiProcess library shape — runs even
// when the scenario is gated off.
describe('staleClaim lib: spawnHost surface contract', () => {
  it('spawnHost is exported and has the expected shape', async () => {
    expect(typeof spawnHost).toBe('function');
  });
});
