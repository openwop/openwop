/**
 * Thin Querier interface satisfied by both `pg.Client` and `PGlite`.
 *
 * The Postgres host accepts any Querier so the same wire-layer code
 * can run against:
 *   - a real Postgres for production deployers (via `pg.Client` /
 *     `pg.Pool`).
 *   - in-process `PGlite` (Postgres-compiled-to-WASM) for the
 *     test/smoke harness — no Docker, no installed psql required.
 *
 * The interface is the minimum surface our host actually uses:
 *   - `query(sql, params)` → `{rows: T[]}`
 *
 * Transactions are issued as explicit `BEGIN` / `COMMIT` / `ROLLBACK`
 * via the same query path (works for both backends since they're
 * vanilla Postgres syntax).
 */

export interface QueryResult<T = Record<string, unknown>> {
  readonly rows: T[];
  readonly rowCount?: number;
}

export interface Querier {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<T>>;
}

/**
 * In-process serialization for transactions. The reference host caches
 * a single `pg.Client` (or PGlite) instance at module scope; concurrent
 * `withTransaction` callers would otherwise interleave `BEGIN`/`COMMIT`
 * statements on that single connection, causing both bodies to land
 * inside the first caller's transaction (Postgres emits a warning, not
 * an error, for "transaction already in progress").
 *
 * The lock below makes `withTransaction` calls FIFO-serialize. This is
 * a reference-impl pragmatic fix:
 *   - PGlite (the test harness) already serializes queries through its
 *     own async queue; the lock is a belt-and-suspenders no-op there.
 *   - Real production Postgres deployers SHOULD switch to a connection-
 *     POOL design (one client per transaction, checked out from the
 *     pool); the lock is what stops the broken in-process design from
 *     looking like it works under load until it doesn't.
 *
 * @see review C1: shared-connection transaction interleaving
 */
let txTail: Promise<void> = Promise.resolve();

export async function withTransaction<T>(
  querier: Querier,
  fn: () => Promise<T>,
): Promise<T> {
  // Append to the lock's tail; new callers wait for prior ones.
  let release: () => void;
  const ticket = new Promise<void>((r) => {
    release = r;
  });
  const wait = txTail;
  txTail = ticket;
  await wait;

  try {
    await querier.query('BEGIN');
    try {
      const result = await fn();
      await querier.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await querier.query('ROLLBACK');
      } catch {
        // Best effort; surface original error.
      }
      throw err;
    }
  } finally {
    release!();
  }
}
