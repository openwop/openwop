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
 * Wrap a body in BEGIN / COMMIT (or ROLLBACK on throw). Works against
 * both pg and pglite. Note: this is single-connection — production
 * Postgres deployers using a connection POOL should grab a dedicated
 * client from the pool for the duration.
 */
export async function withTransaction<T>(
  querier: Querier,
  fn: () => Promise<T>,
): Promise<T> {
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
}
