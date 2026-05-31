/**
 * Host-extension durability helper (read-through, sample-grade-hardened).
 *
 * Backs the host-extension stores (Kanban boards/cards, agent roster,
 * org-chart, RFC 0083 trigger bridge) with the generic `Storage` kv table —
 * but, unlike the previous boot-hydrate + in-memory write-back cache, this is
 * a READ-THROUGH, PER-ENTITY, SYNCHRONOUSLY-WRITTEN store:
 *
 *  - READ-THROUGH: every read hits storage, so a write made on one process is
 *    visible to every other process immediately (no boot-time snapshot that
 *    drifts). This is what makes a multi-instance deployment correct — the
 *    earlier cache forced a single instance.
 *  - PER-ENTITY: each entity is one row keyed `hostext:<name>:<id>`, so two
 *    concurrent writes to *different* entities never clobber each other (the
 *    prior whole-collection blob lost one of any two concurrent writes), and a
 *    mutation rewrites one row, not the whole collection.
 *  - SYNCHRONOUS: a write `await`s its `kvSet`/`kvDelete` before the service
 *    returns, closing the fire-and-forget data-loss window.
 *
 * Remaining sample-grade trade-offs (a production host would do better):
 *  - `list()` is a prefix SCAN of the whole collection (all tenants), filtered
 *    in the service layer — fine at demo scale, indexed by the kv primary key,
 *    but a production store keys/queries per (tenant, entity).
 *  - No optimistic-concurrency token: two writes to the SAME entity are
 *    last-writer-wins (acceptable for the demo; a production store adds an
 *    `If-Match`/version guard).
 *  - The Kanban SSE board-change fan-out (`subscribeBoardChanges`) is still
 *    in-process: data is consistent across instances, but a live push only
 *    reaches clients on the instance that handled the mutation. A production
 *    host backs that with a pub/sub bus (e.g. Postgres LISTEN/NOTIFY).
 */

import type { Storage } from '../storage/storage.js';

let storageRef: Storage | null = null;

/** Wire the durability layer to the host's storage. Called once at boot. */
export function initHostExtPersistence(storage: Storage): void {
  storageRef = storage;
}

/** Test-only: drop the storage ref. */
export function __resetHostExtPersistence(): void {
  storageRef = null;
}

function requireStorage(): Storage {
  if (!storageRef) {
    throw new Error('host-ext persistence not initialized — call initHostExtPersistence() at boot');
  }
  return storageRef;
}

/**
 * A read-through, per-entity durable collection. `name` may contain `:` to
 * namespace sub-collections (e.g. `kanban:board`). `idOf` extracts an entity's
 * stable id (the row key suffix).
 */
export class DurableCollection<T> {
  constructor(
    private readonly name: string,
    private readonly idOf: (item: T) => string,
  ) {}

  private key(id: string): string {
    return `hostext:${this.name}:${id}`;
  }

  private prefix(): string {
    return `hostext:${this.name}:`;
  }

  /** Read one entity by id (read-through). */
  async get(id: string): Promise<T | null> {
    const raw = await requireStorage().kvGet(this.key(id));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Read every entity in the collection (prefix scan, read-through). */
  async list(): Promise<T[]> {
    const rows = await requireStorage().kvList(this.prefix());
    const out: T[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.value) as T);
      } catch {
        /* skip a corrupt row rather than fail the whole list */
      }
    }
    return out;
  }

  /** Upsert one entity (synchronous — awaits the write). */
  async put(item: T): Promise<void> {
    await requireStorage().kvSet(this.key(this.idOf(item)), JSON.stringify(item));
  }

  /** Delete one entity by id. Returns true if it existed. */
  async delete(id: string): Promise<boolean> {
    return requireStorage().kvDelete(this.key(id));
  }

  /** Test-only: remove every entity in this collection. */
  async __clear(): Promise<void> {
    const storage = requireStorage();
    const rows = await storage.kvList(this.prefix());
    for (const row of rows) await storage.kvDelete(row.key);
  }
}
