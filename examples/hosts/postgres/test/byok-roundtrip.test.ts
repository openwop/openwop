/**
 * BYOK roundtrip smoke for the Postgres reference host (Phase H.1).
 *
 * Drives the `openwop-smoke-byok-roundtrip` fixture end-to-end against
 * the pglite-backed host. Verifies:
 *
 *   1. Discovery advertises `secrets.supported: true` + `aiProviders.byok`.
 *   2. The fixture is in `discovery.fixtures[]` (executable).
 *   3. Run reaches terminal `completed`.
 *   4. `variables['resolve-secret']` carries `{secretSha256, secretLength}`
 *      with the SHA-256 hex shape (64 lowercase hex chars).
 *   5. The event log contains a `node.completed` for `resolve-secret`.
 *   6. The event log DOES NOT carry the raw secret value (SR-1).
 *
 * Spec references:
 *   - spec/v1/auth.md §"Secret resolution"
 *   - spec/v1/run-options.md §"Credential references"
 *   - spec/v1/observability.md §"Redaction"
 *   - SECURITY/threat-model-secret-leakage.md §SR-1
 *
 * Mirrors examples/hosts/sqlite's BYOK behavior with pglite for the
 * Postgres host's storage layer.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-byok-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
// Use a known-canary value so we can compute the expected SHA-256
// independently of the host's resolver default.
process.env.OPENWOP_CANARY_SECRET_VALUE = 'phase-h1-canary-not-a-real-credential';

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function poll<T>(
  fn: () => Promise<T | null>,
  predicate: (v: T) => boolean,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  const interval = opts.intervalMs ?? 50;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v && predicate(v)) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`poll timeout after ${opts.timeoutMs}ms`);
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // 1. Discovery: capabilities.{secrets, aiProviders} advertised.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    assert.equal(disco.status, 200);
    const discoBody = (await disco.json()) as {
      fixtures?: string[];
      capabilities?: {
        secrets?: { supported?: boolean; scopes?: string[]; resolution?: string };
        aiProviders?: { supported?: string[]; byok?: string[] };
      };
    };
    assert.equal(discoBody.capabilities?.secrets?.supported, true,
      'capabilities.secrets.supported MUST be true');
    assert.ok(Array.isArray(discoBody.capabilities?.secrets?.scopes),
      'capabilities.secrets.scopes MUST be an array');
    assert.equal(discoBody.capabilities?.secrets?.resolution, 'host-managed',
      'capabilities.secrets.resolution MUST be "host-managed" in v1.x');
    assert.ok(Array.isArray(discoBody.capabilities?.aiProviders?.byok),
      'capabilities.aiProviders.byok MUST be an array');
    assert.ok((discoBody.capabilities?.aiProviders?.byok ?? []).length > 0,
      'capabilities.aiProviders.byok MUST be non-empty for a BYOK-ready host');

    // 2. Fixture advertised.
    assert.ok(
      (discoBody.fixtures ?? []).includes('openwop-smoke-byok-roundtrip'),
      'openwop-smoke-byok-roundtrip MUST be advertised after H.1',
    );

    // 3. Create + drive the BYOK run.
    const create = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'openwop-smoke-byok-roundtrip' }),
    });
    assert.equal(create.status, 201, 'POST /v1/runs MUST return 201');
    const createBody = (await create.json()) as { runId: string };
    const runId = createBody.runId;

    const terminal = await poll(
      async () => {
        const r = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(runId)}`,
          { headers },
        );
        if (!r.ok) return null;
        return (await r.json()) as { status: string; variables?: Record<string, unknown> };
      },
      (v) => v.status === 'completed' || v.status === 'failed' || v.status === 'cancelled',
      { timeoutMs: 10_000 },
    );
    assert.equal(terminal.status, 'completed', 'BYOK run MUST complete');

    // 4. variables['resolve-secret'] carries the hashed shape.
    const resolved = (terminal.variables ?? {})['resolve-secret'] as
      | { secretSha256?: unknown; secretLength?: unknown }
      | undefined;
    assert.ok(resolved, 'variables MUST contain a "resolve-secret" entry');
    assert.equal(typeof resolved!.secretSha256, 'string');
    assert.match(
      resolved!.secretSha256 as string,
      /^[0-9a-f]{64}$/,
      'secretSha256 MUST be 64 lowercase hex chars',
    );
    assert.equal(typeof resolved!.secretLength, 'number');
    assert.ok((resolved!.secretLength as number) > 0, 'secretLength MUST be > 0');

    // Cross-check: hash matches the env-injected canary.
    const expectedHash = createHash('sha256')
      .update('phase-h1-canary-not-a-real-credential', 'utf8')
      .digest('hex');
    assert.equal(
      resolved!.secretSha256,
      expectedHash,
      'secretSha256 MUST match the SHA-256 of the canary value',
    );

    // 5. node.completed event for resolve-secret.
    const eventsRes = await fetch(
      `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
      { headers },
    );
    assert.equal(eventsRes.status, 200);
    const eventsBody = (await eventsRes.json()) as {
      events: Array<{ type: string; nodeId?: string | null }>;
    };
    const completedForResolve = eventsBody.events.filter(
      (e) => e.type === 'node.completed' && e.nodeId === 'resolve-secret',
    );
    assert.equal(
      completedForResolve.length,
      1,
      'exactly one node.completed for "resolve-secret" MUST be emitted',
    );

    // 6. Event log does NOT contain the raw secret value (SR-1).
    const dump = JSON.stringify(eventsBody);
    assert.equal(
      dump.includes('phase-h1-canary-not-a-real-credential'),
      false,
      'event log MUST NOT contain the raw secret cleartext (SR-1)',
    );

    // eslint-disable-next-line no-console
    console.log('ok byok-roundtrip — H.1 verified');
  } finally {
    await close();
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
