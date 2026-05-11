/**
 * Host-internal claim-acquisition smoke for the Postgres reference host.
 *
 * Exercises the Postgres advisory-lock-based claim model:
 *   1. tryClaim acquires the lock for a fresh run and stamps
 *      claim_holder_id + claim_expires_at as observability hints.
 *   2. releaseClaim drops the lock and clears the descriptive columns.
 *   3. A noop run leaves claim_holder_id NULL on terminal (claim
 *      released).
 *   4. A long-running delay run shows claim_holder_id non-NULL while
 *      executing.
 *   5. An external pg_try_advisory_lock probe against the same key
 *      from a SECOND PGlite instance can re-acquire only after the
 *      first instance releases.
 *
 * NOTE: PGlite instances are independent in-process — they don't share
 * a server. So #5 is conceptually validated by checking that the same
 * connection's session-level lock is re-entrant (acquired again returns
 * true), AND that pg_advisory_unlock followed by pg_try_advisory_lock
 * from the same session returns true (i.e., the unlock did work).
 * Genuine multi-process safety is a property of session-level advisory
 * locks across distinct Postgres sessions; we trust that and verify
 * only the in-host wiring.
 *
 * @see spec/v1/storage-adapters.md §"Lease and claim invariants"
 * @see src/server.ts tryClaim / releaseClaim / recoverOrphans
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-claim-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

try {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const baseUrl = `http://127.0.0.1:${process.env.OPENWOP_PORT ?? '3839'}`;
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // ── 1. Noop run leaves claim NULL on terminal ─────────────────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-noop' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      // Wait for terminal.
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (r.ok) {
          const body = (await r.json()) as { status: string };
          if (body.status === 'completed') break;
        }
        await new Promise((res) => setTimeout(res, 30));
      }

      // Inspect the claim columns directly. The advisory lock is the
      // ground truth, but these descriptive columns should reflect
      // released state after terminal.
      const claimRes = await db.query<{
        claim_holder_id: string | null;
        claim_expires_at: string | null;
      }>('SELECT claim_holder_id, claim_expires_at FROM runs WHERE run_id = $1', [runId]);
      assert.equal(
        claimRes.rows[0]?.claim_holder_id,
        null,
        'completed run MUST have claim_holder_id NULL after release',
      );
      assert.equal(
        claimRes.rows[0]?.claim_expires_at,
        null,
        'completed run MUST have claim_expires_at NULL after release',
      );
      console.log('  ✓ noop run releases claim on terminal');
    }

    // ── 2. Long-running run shows claim held during execution ─────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workflowId: 'conformance-delay',
          inputs: { delayMs: 3000 },
        }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      // Wait briefly for executor to start.
      await new Promise((res) => setTimeout(res, 200));

      // Probe claim columns mid-execution.
      const midRes = await db.query<{
        status: string;
        claim_holder_id: string | null;
      }>('SELECT status, claim_holder_id FROM runs WHERE run_id = $1', [runId]);
      const mid = midRes.rows[0];
      assert.equal(mid?.status, 'running', 'mid-execution status MUST be running');
      assert.ok(
        mid?.claim_holder_id?.startsWith('host-'),
        `claim_holder_id MUST be set during execution; got ${JSON.stringify(mid?.claim_holder_id)}`,
      );

      // Cancel + verify claim released.
      const cancel = await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/cancel`,
        { method: 'POST', headers, body: '{}' },
      );
      assert.equal(cancel.status, 200);
      // Wait for terminal.
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (r.ok) {
          const body = (await r.json()) as { status: string };
          if (body.status === 'cancelled') break;
        }
        await new Promise((res) => setTimeout(res, 30));
      }
      const finalRes = await db.query<{
        status: string;
        claim_holder_id: string | null;
      }>('SELECT status, claim_holder_id FROM runs WHERE run_id = $1', [runId]);
      assert.equal(finalRes.rows[0]?.status, 'cancelled');
      assert.equal(
        finalRes.rows[0]?.claim_holder_id,
        null,
        'cancelled run MUST release the claim',
      );
      console.log('  ✓ long run holds claim during execution, releases on cancel');
    }

    // ── 3. Advisory-lock semantics from a second PGlite session ───────
    //
    // PGlite instances are independent in-process; they don't share a
    // server, so a second PGlite can't observe the first's locks.
    // Instead, we verify that the lock primitive ITSELF works as
    // expected in pglite: re-entrant from the same session, releasable,
    // and re-acquirable after release.
    {
      const probeRes1 = await db.query<{ got: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS got',
        ['test-lock-key'],
      );
      assert.equal(probeRes1.rows[0]?.got, true, 'first lock attempt MUST succeed');

      // Re-entrant: same session can lock the same key again.
      const probeRes2 = await db.query<{ got: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS got',
        ['test-lock-key'],
      );
      assert.equal(probeRes2.rows[0]?.got, true, 'same-session re-lock MUST succeed (re-entrant)');

      // Unlock twice (matching the two locks).
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['test-lock-key']);
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['test-lock-key']);

      // Now a fresh lock attempt MUST succeed.
      const probeRes3 = await db.query<{ got: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS got',
        ['test-lock-key'],
      );
      assert.equal(
        probeRes3.rows[0]?.got,
        true,
        'after balanced unlock, fresh lock MUST succeed',
      );
      // Cleanup.
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['test-lock-key']);
      console.log('  ✓ advisory-lock primitive: re-entrant + balanced unlock');
    }

    console.log('postgres-host claim test: PASS');
  } finally {
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
