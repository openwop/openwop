/**
 * Cross-file isolation for the mock-AI program seam.
 *
 * `POST /v1/host/sample/test/mock-ai/program` is keyed by `nodeId` alone
 * (host-sample-test-seams.md §5), and a node id belongs to a fixture. When two
 * scenario files drive the same fixture, vitest runs them in parallel workers
 * by default and each can overwrite the other's program between seeding it and
 * reading the run: a flaky result that says nothing about the host.
 *
 * `holdMockNodes(...ids)` holds a lock per node id for the whole file, taken in
 * `beforeAll` and released in `afterAll`, so files sharing a node run one after
 * another. The lock is an atomic `mkdir` in the OS temp dir, keyed by the target
 * base URL and the node id, so it is shared by every worker process on the
 * machine and separate hosts never contend. Ids are taken in sorted order (no
 * deadlock between files holding overlapping sets); a lock older than
 * STALE_MS is presumed left by a killed run and is broken.
 */

import { beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POLL_MS = 200;
const WAIT_MS = 300_000;
const STALE_MS = 600_000;

function lockDir(nodeId: string): string {
  const key = createHash('sha256').update(`${process.env.OPENWOP_BASE_URL ?? ''}\u0000${nodeId}`).digest('hex').slice(0, 24);
  return join(tmpdir(), `openwop-mock-node-${key}`);
}

async function acquire(dir: string, nodeId: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid} ${nodeId} ${new Date().toISOString()}\n`);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(dir).mtimeMs > STALE_MS) { rmSync(dir, { recursive: true, force: true }); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error(`mock-node lock for ${nodeId} not acquired within ${WAIT_MS / 1000}s (${dir}) — another scenario file still holds it`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

/** Hold the mock-AI program slot for these node ids for the duration of the calling file. */
export function holdMockNodes(...nodeIds: string[]): void {
  const held: string[] = [];
  beforeAll(async () => {
    if (!process.env.OPENWOP_BASE_URL) return; // server-free run: nothing to isolate
    for (const id of [...new Set(nodeIds)].sort()) {
      const dir = lockDir(id);
      await acquire(dir, id);
      held.push(dir);
    }
  }, WAIT_MS + 10_000);
  afterAll(() => {
    for (const dir of held.splice(0).reverse()) rmSync(dir, { recursive: true, force: true });
  });
}
