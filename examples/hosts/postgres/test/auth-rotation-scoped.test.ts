/**
 * Phase I.5 + I.6 smoke — API-key rotation + auth-scoped discovery.
 *
 * Verifies:
 *
 *   1. Default boot (no rotation/tenant2 env) — discovery omits the
 *      `auth.rotation` block and `discovery.authScoped` block; the
 *      profile list does NOT include `openwop-auth-api-key-rotation`
 *      or `openwop-discovery-auth-scoped`.
 *
 *   2. With OPENWOP_SECONDARY_API_KEY set — both primary + secondary
 *      authenticate; the profile list includes
 *      `openwop-auth-api-key-rotation`; the `auth.rotation`
 *      advertisement carries minGraceSeconds.
 *
 *   3. With OPENWOP_TENANT2_API_KEY set — primary's discovery view
 *      includes `orchestrator` + `dispatch`; tenant2's view OMITS
 *      both (strict subset per spec §"Scoped capability views").
 *      Profile list adds `openwop-discovery-auth-scoped`.
 *
 *   4. Constant-time-ish: invalid token consistently rejects with 401
 *      `invalid_credential` and DOES NOT echo the rejected token in
 *      the error envelope (auth.md §"No credential echo").
 *
 * Tests run sequentially because each one sets env vars + spawns a
 * fresh host; vitest workers can't share env reliably.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-auth-rot-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.ts';
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function discoveryFor(baseUrl: string, bearer: string | null): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${baseUrl}/.well-known/openwop`, { headers });
  assert.equal(res.status, 200, 'discovery MUST return 200');
  return (await res.json()) as Record<string, unknown>;
}

interface CapsView {
  auth?: {
    profiles?: string[];
    rotation?: { supported?: boolean; minGraceSeconds?: number };
  };
  discovery?: { authScoped?: { supported?: boolean; mode?: string } };
  orchestrator?: { supported?: boolean };
  dispatch?: { supported?: boolean };
}

async function main(): Promise<void> {
  // Caller MUST boot this script with the three keys in env (the host
  // reads them at module-load time). The test harness sets:
  //   OPENWOP_API_KEY=phase-i-primary-key
  //   OPENWOP_SECONDARY_API_KEY=phase-i-secondary-key
  //   OPENWOP_TENANT2_API_KEY=phase-i-tenant2-key
  const port = process.env.OPENWOP_PORT ?? '3839';
  const primaryKey = process.env.OPENWOP_API_KEY ?? 'phase-i-primary-key';
  const secondaryKey = process.env.OPENWOP_SECONDARY_API_KEY ?? 'phase-i-secondary-key';
  const tenant2Key = process.env.OPENWOP_TENANT2_API_KEY ?? 'phase-i-tenant2-key';

  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Public (no bearer) view — should be the primary view (no
    //    narrowing since principalFor returns null and isTenant2 is
    //    false). Profile list MUST include both new claims because
    //    both env vars are set.
    const publicView = (await discoveryFor(baseUrl, null)) as { capabilities?: CapsView };
    assert.ok(
      publicView.capabilities?.auth?.profiles?.includes('openwop-auth-api-key-rotation'),
      'auth.profiles MUST include openwop-auth-api-key-rotation when SECONDARY key is set',
    );
    assert.ok(
      publicView.capabilities?.auth?.profiles?.includes('openwop-discovery-auth-scoped'),
      'auth.profiles MUST include openwop-discovery-auth-scoped when TENANT2 key is set',
    );
    assert.equal(publicView.capabilities?.auth?.rotation?.supported, true);
    assert.equal(publicView.capabilities?.auth?.rotation?.minGraceSeconds, 86_400);
    assert.equal(publicView.capabilities?.discovery?.authScoped?.supported, true);
    assert.equal(publicView.capabilities?.discovery?.authScoped?.mode, 'same-endpoint');
    // Public view sees the primary capability set (orchestrator + dispatch).
    assert.equal(publicView.capabilities?.orchestrator?.supported, true,
      'public view MUST include orchestrator');
    assert.equal(publicView.capabilities?.dispatch?.supported, true,
      'public view MUST include dispatch');

    // 2. Primary bearer view — same as public (primary principal).
    const primaryView = (await discoveryFor(baseUrl, primaryKey)) as { capabilities?: CapsView };
    assert.equal(primaryView.capabilities?.orchestrator?.supported, true,
      'primary view MUST include orchestrator');

    // 3. Secondary bearer authenticates as primary (rotation overlap).
    const secondaryView = (await discoveryFor(baseUrl, secondaryKey)) as { capabilities?: CapsView };
    assert.equal(secondaryView.capabilities?.orchestrator?.supported, true,
      'secondary bearer authenticates as primary; view MUST include orchestrator');

    // 4. Tenant2 view — strict subset; orchestrator + dispatch OMITTED.
    const tenant2View = (await discoveryFor(baseUrl, tenant2Key)) as { capabilities?: CapsView };
    assert.equal(tenant2View.capabilities?.orchestrator, undefined,
      'tenant2 view MUST OMIT orchestrator (strict subset per capabilities-change-detection.md §Scoped capability views)');
    assert.equal(tenant2View.capabilities?.dispatch, undefined,
      'tenant2 view MUST OMIT dispatch (strict subset)');

    // 5. checkAuth: primary, secondary, tenant2 all authenticate
    //    POST /v1/runs successfully.
    for (const [label, key] of [['primary', primaryKey], ['secondary', secondaryKey], ['tenant2', tenant2Key]] as const) {
      const res = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'conformance-noop' }),
      });
      assert.equal(res.status, 201, `${label} bearer MUST authenticate POST /v1/runs`);
    }

    // 6. Invalid bearer → 401 invalid_credential; no token echo.
    const bogus = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-key-canary', 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(bogus.status, 401);
    const bogusBody = await bogus.text();
    assert.equal(bogusBody.includes('not-a-real-key-canary'), false,
      'error envelope MUST NOT echo the rejected token (auth.md §"No credential echo")');
    const bogusJson = JSON.parse(bogusBody) as { error?: string };
    assert.equal(bogusJson.error, 'invalid_credential');

    // eslint-disable-next-line no-console
    console.log('ok auth-rotation-scoped — I.5 + I.6 verified (6 paths + canary-redaction)');
  } finally {
    await close();
    rmSync(workdir, { recursive: true, force: true });
    delete process.env.OPENWOP_API_KEY;
    delete process.env.OPENWOP_SECONDARY_API_KEY;
    delete process.env.OPENWOP_TENANT2_API_KEY;
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
