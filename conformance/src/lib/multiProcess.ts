/**
 * Multi-process host orchestrator for the staleClaim conformance
 * scenario.
 *
 * Spawns a host child process directly via `child_process.spawn` so
 * the test has a real PID to SIGKILL. Using `npm start` + killing the
 * npm wrapper does NOT reach the actual host process — that pattern
 * leaves the host running.
 *
 * The harness is small and zero-deps. It assumes the SQLite reference
 * host's `tsx src/server.ts` entrypoint accepts:
 *
 *   - OPENWOP_PORT
 *   - OPENWOP_API_KEY
 *   - OPENWOP_SQLITE_PATH
 *   - OPENWOP_CLAIM_TTL_MS
 *   - OPENWOP_HEARTBEAT_INTERVAL_MS
 *
 * Other host implementations adapt the spawn command.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SpawnedHostConfig {
  /** Repo-root-relative path to the host's package directory. */
  readonly packageDir: string;
  /** Bind port. */
  readonly port: number;
  /** Bearer token. */
  readonly apiKey: string;
  /** Absolute path to the SQLite DB file (shared across processes). */
  readonly dbPath: string;
  /** Claim TTL in ms. Tests use a short value (e.g., 2000). */
  readonly claimTtlMs: number;
  /** Heartbeat renewal interval in ms. Tests use ≤ claimTtlMs/2. */
  readonly heartbeatIntervalMs: number;
}

export interface SpawnedHost {
  readonly process: ChildProcess;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Resolves once `/.well-known/openwop` returns 200. */
  ready(): Promise<void>;
  /** Force-kill (SIGKILL) — does NOT trigger the host's graceful shutdown handler. */
  kill(): Promise<void>;
  /** Graceful kill (SIGTERM) — triggers the host's shutdown handler (releases claims). */
  shutdown(): Promise<void>;
}

/**
 * Find the repo root by walking up from this file until we see the
 * spec corpus marker.
 */
function findRepoRoot(): string {
  let probe = new URL('.', import.meta.url).pathname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(probe, 'spec', 'v1'))) return probe;
    probe = join(probe, '..');
  }
  throw new Error('Could not locate repo root from conformance/src/lib/multiProcess.ts');
}

export async function spawnHost(config: SpawnedHostConfig): Promise<SpawnedHost> {
  const repoRoot = findRepoRoot();
  const cwd = join(repoRoot, config.packageDir);

  const env = {
    ...process.env,
    OPENWOP_HOST: '127.0.0.1',
    OPENWOP_PORT: String(config.port),
    OPENWOP_API_KEY: config.apiKey,
    OPENWOP_SQLITE_PATH: config.dbPath,
    OPENWOP_CLAIM_TTL_MS: String(config.claimTtlMs),
    OPENWOP_HEARTBEAT_INTERVAL_MS: String(config.heartbeatIntervalMs),
  };

  // Spawn `npx tsx src/server.ts` directly (not `npm start`) so we get
  // the tsx PID, not the npm wrapper PID. SIGKILL on the npm wrapper
  // does NOT propagate to the tsx child — confirmed by smoke testing
  // when this lib was authored.
  const proc = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${config.port}`;
  const host: SpawnedHost = {
    process: proc,
    baseUrl,
    apiKey: config.apiKey,
    async ready(): Promise<void> {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (proc.exitCode !== null) {
          throw new Error(`Host exited before ready (code ${proc.exitCode})`);
        }
        try {
          const res = await fetch(`${baseUrl}/.well-known/openwop`);
          if (res.ok) return;
        } catch {
          // not yet listening
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`Host at ${baseUrl} did not become ready within 10s`);
    },
    async kill(): Promise<void> {
      if (proc.pid !== undefined && proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.once('exit', () => resolve());
        // Backstop in case the exit event already fired.
        setTimeout(() => resolve(), 1000);
      });
    },
    async shutdown(): Promise<void> {
      if (proc.pid !== undefined && proc.exitCode === null) {
        proc.kill('SIGTERM');
      }
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.once('exit', () => resolve());
        setTimeout(() => resolve(), 5000);
      });
    },
  };

  return host;
}
