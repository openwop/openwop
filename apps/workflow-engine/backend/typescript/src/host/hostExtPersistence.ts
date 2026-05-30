/**
 * Host-extension durability helper (sample-grade).
 *
 * Backs the in-memory host-extension stores (Kanban boards/cards, agent
 * roster, org-chart) with the generic `Storage.kvGet/kvSet` primitive so they
 * survive a restart on the file / Postgres backends (an in-memory `:memory:`
 * DSN naturally does not persist across process restarts — that is expected).
 *
 * Each service serializes its whole collection to one key and hydrates it on
 * boot. Writes are FIRE-AND-FORGET + coalesced per key (a sync mutation
 * schedules a single async write per tick) so the service APIs stay
 * synchronous; hydration on boot is awaited. This is sample-grade write-back
 * durability, not a transactional store.
 *
 * Sample-grade caveats (a production host would do better):
 *  - DATA-LOSS WINDOW: a mutation is acknowledged to the caller BEFORE its
 *    write-back flushes; a crash in that window loses it. A production store
 *    writes synchronously within the request.
 *  - COARSE GRANULARITY: a whole collection is one row keyed by `key`,
 *    rewritten on every mutation (write amplification) and holding all
 *    tenants' data in one blob. Reads filter by tenant in the service layer
 *    (no cross-tenant leak), but at scale a production store keys per
 *    entity/tenant.
 */

import type { Storage } from '../storage/storage.js';

let storageRef: Storage | null = null;
const pending = new Map<string, () => unknown>();
let flushScheduled = false;

/** Wire the durability layer to the host's storage. Called once at boot. */
export function initHostExtPersistence(storage: Storage): void {
  storageRef = storage;
}

/** Hydrate a collection persisted under `key` (empty array if absent). */
export async function loadCollection<T>(key: string): Promise<T[]> {
  if (!storageRef) return [];
  const raw = await storageRef.kvGet(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Schedule a write-back of `key`'s current state. `snapshot` is invoked at
 * flush time (so multiple mutations in a tick collapse to one write of the
 * latest state). No-op when persistence is not wired (e.g. unit tests that
 * don't call `initHostExtPersistence`).
 */
export function schedulePersist(key: string, snapshot: () => unknown): void {
  if (!storageRef) return;
  pending.set(key, snapshot);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(() => {
      void flush();
    });
  }
}

async function flush(): Promise<void> {
  flushScheduled = false;
  const storage = storageRef;
  if (!storage) {
    pending.clear();
    return;
  }
  const batch = [...pending.entries()];
  pending.clear();
  for (const [key, snapshot] of batch) {
    try {
      await storage.kvSet(key, JSON.stringify(snapshot()));
    } catch {
      /* best-effort write-back; a failed persist must not crash a mutation */
    }
  }
}

/** Flush any pending write-backs now (awaitable). Useful in tests + on a
 *  graceful shutdown. */
export async function flushHostExtPersistence(): Promise<void> {
  await flush();
}

/** Test-only: drop the storage ref + any pending writes. */
export function __resetHostExtPersistence(): void {
  storageRef = null;
  pending.clear();
  flushScheduled = false;
}
