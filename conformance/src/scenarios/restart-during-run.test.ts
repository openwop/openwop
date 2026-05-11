/**
 * Restart-during-run scenario per spec/v1/scale-profiles.md
 * §"Replay semantics" + spec/v1/storage-adapters.md §"Claim acquisition."
 *
 * Distinct from `staleClaim.test.ts` (which exercises *cross-process*
 * claim transfer where two host processes share a DB):
 *
 *   - **staleClaim:** process A starts a run → SIGKILL → process B
 *     (different PID, different port, same DB) takes over after TTL.
 *     Models multi-host scale-out.
 *   - **restart-during-run** (this file): process A starts a run →
 *     SIGKILL → process A' (same port, same DB, fresh PID) takes
 *     over after TTL. Models the single-host crash + supervisor-
 *     restart pattern that most production deployments rely on.
 *
 * Both reduce to the same primitive — resume-on-startup picks up an
 * orphaned claim — but the contract this scenario asserts is that the
 * SECOND boot at the SAME port works, which is the more common
 * production failure mode (a node-level supervisor like systemd, k8s,
 * pm2 restarts the host process on crash).
 *
 * **`@multi-process`** — spawns child host processes via
 * `child_process.spawn`. Opt-in via `OPENWOP_RUN_RESTART_DURING_RUN=1`.
 *
 * **`@timing-sensitive`** — relies on a short claim TTL.
 *
 * @see lib/multiProcess.ts — spawnHost helper
 * @see examples/hosts/sqlite/src/server.ts — resume-on-startup
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnHost, type SpawnedHost } from '../lib/multiProcess.js';

const HOST_PACKAGE_DIR =
  process.env.OPENWOP_RESTART_DURING_RUN_HOST_DIR ?? 'examples/hosts/sqlite';
const RUN_THIS_SCENARIO = process.env.OPENWOP_RUN_RESTART_DURING_RUN === '1';

const APIKEY = 'openwop-restart-during-run';
const PORT = 4803;
const CLAIM_TTL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 500;

interface RunSnapshot {
  status?: string;
  runId?: string;
  endedAt?: string | null;
}

async function fetchSnapshot(
  baseUrl: string,
  apiKey: string,
  runId: string,
): Promise<RunSnapshot> {
  const res = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`GET /v1/runs/${runId} failed: ${res.status}`);
  return (await res.json()) as RunSnapshot;
}

let workdir: string | null = null;
const activeHosts: SpawnedHost[] = [];

afterEach(async () => {
  for (const h of activeHosts.splice(0)) {
    await h.shutdown().catch(() => h.kill().catch(() => undefined));
  }
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
    workdir = null;
  }
});

describe.skipIf(!RUN_THIS_SCENARIO)(
  'restart-during-run: SIGKILL + same-port restart resumes orphaned run',
  () => {
    it(
      'mid-run SIGKILL on the host process; restart at the same port + DB resumes to terminal',
      async () => {
        workdir = mkdtempSync(join(tmpdir(), 'openwop-restart-during-run-'));
        const dbPath = join(workdir, 'openwop-host.sqlite');

        // ── Boot host A (the one we'll kill).
        const hostA = await spawnHost({
          packageDir: HOST_PACKAGE_DIR,
          port: PORT,
          apiKey: APIKEY,
          dbPath,
          claimTtlMs: CLAIM_TTL_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        });
        activeHosts.push(hostA);
        await hostA.ready();

        // Start a long-running run (uses conformance-cancellable so we
        // have time between create and kill).
        const create = await fetch(`${hostA.baseUrl}/v1/runs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${APIKEY}`,
          },
          body: JSON.stringify({
            workflowId: 'conformance-cancellable',
            inputs: { delaySeconds: 8 },
          }),
        });
        expect(create.status).toBe(201);
        const runId = (await create.json() as { runId: string }).runId;
        expect(runId).toMatch(/^run-/);

        // Wait a beat so host A writes `run.started` and at least one
        // node.started before we kill it.
        await new Promise((r) => setTimeout(r, 300));

        // SIGKILL host A. Claim remains held in the DB until TTL
        // expires.
        await hostA.kill();
        activeHosts.length = 0; // hostA is dead; don't try to shut down again

        // Wait for the claim to go stale.
        await new Promise((r) => setTimeout(r, CLAIM_TTL_MS + 500));

        // ── Boot the replacement at the SAME port + SAME DB. This is
        // the supervisor-restart pattern.
        const hostA2 = await spawnHost({
          packageDir: HOST_PACKAGE_DIR,
          port: PORT,
          apiKey: APIKEY,
          dbPath,
          claimTtlMs: CLAIM_TTL_MS,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        });
        activeHosts.push(hostA2);
        await hostA2.ready();

        // Poll until terminal. A successful restart-recovery means
        // resume-on-startup re-acquired the claim and the executor
        // completed the run.
        const deadline = Date.now() + 30_000;
        let terminal: RunSnapshot | null = null;
        while (Date.now() < deadline) {
          const snap = await fetchSnapshot(hostA2.baseUrl, APIKEY, runId);
          if (
            snap.status === 'completed' ||
            snap.status === 'failed' ||
            snap.status === 'cancelled'
          ) {
            terminal = snap;
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }

        expect(
          terminal,
          'run MUST reach terminal status on the restarted host within 30s',
        ).not.toBeNull();
        expect(
          terminal?.status,
          'restart-recovery MUST drive the run to a non-pending terminal status',
        ).toMatch(/^(completed|failed|cancelled)$/);
        // For the cancellable fixture, completed is the expected
        // outcome — the workflow just exits the delay node and finishes.
        expect(terminal?.status).toBe('completed');
        expect(typeof terminal?.endedAt).toBe('string');
      },
      45_000,
    );
  },
);
