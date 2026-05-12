/**
 * Agent events smoke (Phase I.2).
 *
 * Verifies capabilities.md §`agents` advertisement contract +
 * agent-events.ts helper behavior:
 *
 *   1. Discovery advertises capabilities.agents.supported: true with
 *      the full Phase 1-6 shape (profile, modelClasses,
 *      orchestratorPattern, memoryBackends, orchestrator, dispatch,
 *      reasoning).
 *   2. buildAgentReasonedPayload — "off" suppresses (returns null).
 *   3. buildAgentReasonedPayload — "summary" truncates to tokenLimit
 *      and reports tokensUsed.
 *   4. buildAgentReasonedPayload — "full" emits verbatim.
 *   5. resolveReasoningVerbosity — RunOptions overrides host default.
 *   6. resolveReasoningVerbosity — invalid value falls back to host
 *      default.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-agents-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.ts';
import type { Querier, QueryResult } from '../src/db.js';
import {
  buildAgentReasonedPayload,
  resolveReasoningVerbosity,
} from '../src/agent-events.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Discovery advertises agents capability.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    const discoBody = (await disco.json()) as {
      capabilities?: {
        agents?: {
          supported?: boolean;
          profile?: string;
          modelClasses?: string[];
          orchestratorPattern?: string;
          memoryBackends?: string[];
          orchestrator?: boolean;
          dispatch?: boolean;
          reasoning?: { verbosity?: string; tokenLimit?: number };
        };
      };
    };
    const cap = discoBody.capabilities?.agents;
    assert.equal(cap?.supported, true);
    assert.equal(cap?.profile, 'wop-agents-full');
    assert.deepEqual(cap?.modelClasses, ['reasoning', 'tool-using', 'chat']);
    assert.equal(cap?.orchestratorPattern, 'delegate.smart');
    assert.deepEqual(cap?.memoryBackends, ['long-term']);
    assert.equal(cap?.orchestrator, true);
    assert.equal(cap?.dispatch, true);
    assert.equal(cap?.reasoning?.verbosity, 'summary');
    assert.equal(cap?.reasoning?.tokenLimit, 512);

    // 2. "off" verbosity suppresses payload.
    const offPayload = buildAgentReasonedPayload(
      { agentId: 'agent-1' },
      'This is the reasoning trace.',
      { verbosity: 'off' },
    );
    assert.equal(offPayload, null, '"off" MUST return null (caller suppresses emission)');

    // 3. "summary" truncates to tokenLimit.
    const longTrace = 'x'.repeat(10_000); // ~2500 tokens at 4-bytes-per
    const summaryPayload = buildAgentReasonedPayload(
      { agentId: 'agent-1' },
      longTrace,
      { verbosity: 'summary', tokenLimit: 100 },
    );
    assert.ok(summaryPayload);
    assert.ok(summaryPayload.reasoning.length < longTrace.length,
      '"summary" MUST truncate when over tokenLimit');
    assert.ok(summaryPayload.reasoning.endsWith('…'),
      'truncated reasoning MUST end with ellipsis marker');
    assert.equal(summaryPayload.tokensUsed, 100);

    // 4. "full" emits verbatim.
    const shortTrace = 'Brief trace.';
    const fullPayload = buildAgentReasonedPayload(
      { agentId: 'agent-1' },
      shortTrace,
      { verbosity: 'full' },
    );
    assert.ok(fullPayload);
    assert.equal(fullPayload.reasoning, shortTrace);
    assert.equal(fullPayload.tokensUsed, Math.ceil(shortTrace.length / 4));

    // 5. resolveReasoningVerbosity — run override wins.
    const fromRun = resolveReasoningVerbosity({ reasoningVerbosity: 'full' }, 'summary');
    assert.equal(fromRun, 'full');
    const fromHost = resolveReasoningVerbosity({}, 'off');
    assert.equal(fromHost, 'off');
    const fromFallback = resolveReasoningVerbosity(null);
    assert.equal(fromFallback, 'summary');

    // 6. Invalid override → host default.
    const invalid = resolveReasoningVerbosity({ reasoningVerbosity: 'nope' }, 'summary');
    assert.equal(invalid, 'summary');

    void port; void baseUrl;
    // eslint-disable-next-line no-console
    console.log('ok agent-events — I.2 verified (6 paths + Phase 1-6 capability shape)');
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
