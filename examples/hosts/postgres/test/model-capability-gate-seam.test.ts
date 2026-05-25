/**
 * RFC 0031 §B gate-decision seam — `POST /v1/host/sample/test/
 * evaluate-model-capability-gate` on the Postgres reference host (PGlite).
 * Exercises the substitute / refuse / dispatch matrix the conformance
 * synthetic cases in `model-capability-{insufficient,substituted}.test.ts`
 * assert. The seam is a pure-function exerciser (no event log, no secrets).
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §D
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-gate-seam-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

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

interface GateResponse {
  outcome?: { route?: string; fallbackAttempted?: boolean; missingCapabilities?: string[] };
  event?: { type?: string; payload?: Record<string, unknown> };
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();
  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

    async function gate(input: unknown): Promise<{ status: number; body: GateResponse }> {
      const res = await fetch(`${baseUrl}/v1/host/sample/test/evaluate-model-capability-gate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      return { status: res.status, body: (await res.json()) as GateResponse };
    }

    // 1. unmet + no fallback → refuse, fallbackAttempted false + insufficient event.
    const r1 = await gate({
      module: { requiredModelCapabilities: ['structured-output', 'reasoning'] },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['unknown-vendor'],
      nodeId: 'editor-node',
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.outcome?.route, 'refuse');
    assert.equal(r1.body.outcome?.fallbackAttempted, false);
    assert.equal(r1.body.event?.type, 'model.capability.insufficient');
    assert.equal(r1.body.event?.payload?.nodeId, 'editor-node');

    // 2. unmet + fallback provider NOT in supportedProviders → refuse, fallbackAttempted true.
    const r2 = await gate({
      module: { requiredModelCapabilities: ['structured-output'], fallbackModel: { provider: 'unauthenticated-vendor', model: 'foo' } },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['anthropic', 'unknown-vendor'],
      nodeId: 'n',
    });
    assert.equal(r2.body.outcome?.route, 'refuse');
    assert.equal(r2.body.outcome?.fallbackAttempted, true);

    // 3. unmet + substitutionSupported false → refuse, fallbackAttempted false.
    const r3 = await gate({
      module: { requiredModelCapabilities: ['structured-output'], fallbackModel: { provider: 'anthropic', model: 'claude-opus-4-7' } },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: false,
      supportedProviders: ['anthropic', 'unknown-vendor'],
      nodeId: 'n',
    });
    assert.equal(r3.body.outcome?.route, 'refuse');
    assert.equal(r3.body.outcome?.fallbackAttempted, false);

    // 4. unmet active + fallback authenticatable + capable → substitute + substituted event.
    const r4 = await gate({
      module: { requiredModelCapabilities: ['structured-output'], fallbackModel: { provider: 'anthropic', model: 'claude-opus-4-7' } },
      activeProvider: 'unknown-vendor',
      activeModel: 'unknown-model',
      substitutionSupported: true,
      supportedProviders: ['anthropic', 'openai', 'unknown-vendor'],
      nodeId: 'writer-node',
    });
    assert.equal(r4.body.outcome?.route, 'substitute');
    assert.equal(r4.body.event?.type, 'model.capability.substituted');
    assert.equal(r4.body.event?.payload?.fallbackProvider, 'anthropic');

    // 5. all capabilities met by the active provider → dispatch, no event.
    const r5 = await gate({
      module: { requiredModelCapabilities: ['structured-output'] },
      activeProvider: 'anthropic',
      activeModel: 'claude-opus-4-7',
      substitutionSupported: true,
      supportedProviders: ['anthropic'],
      nodeId: 'n',
    });
    assert.equal(r5.body.outcome?.route, 'dispatch');
    assert.equal(r5.body.event, null);

    console.log('model-capability-gate-seam.test: PASS');
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
