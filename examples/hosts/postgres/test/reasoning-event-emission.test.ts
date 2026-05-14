/**
 * Reasoning-event emission smoke (Phase I.2 follow-up).
 *
 * Verifies that the Postgres reference host actually emits the
 * canonical agent.* events from `core.llm.chat` + `core.mcp.toolCall`
 * executors per `run-event-payloads.schema.json` §`agentReasoned` /
 * §`agentToolCalled` / §`agentToolReturned` / §`agentDecided`.
 *
 * Wired in commit B-12: `examples/hosts/postgres/src/server.ts`
 * core.llm.* block emits `agent.reasoned` (verbosity-gated) +
 * `agent.decided`; core.mcp.toolCall emits `agent.toolCalled` BEFORE
 * the call and `agent.toolReturned` AFTER (paired via shared callId).
 *
 * SR-1 / MCP-1: argument and result bodies NEVER appear on the event
 * payload — only SHA-256 digests + length + outcome flags.
 *
 * Uses two host-private fixtures loaded via OPENWOP_EXTRA_FIXTURES_DIR
 * (the test seam in `loadFixtures`) — these typeIds are
 * implementation-specific and not yet in the conformance fixture
 * catalog. A future RFC could promote them to protocol-normative,
 * at which point this smoke moves to the conformance suite.
 *
 * @see schemas/run-event-payloads.schema.json
 * @see examples/hosts/postgres/src/agent-events.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-reasoning-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
process.env.OPENWOP_EXTRA_FIXTURES_DIR = resolve(__dirname, 'fixtures-private');
// Point the host's MCP client at the conformance suite's synthetic
// fake server (configured below before `start()`).

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';
import { McpFakeServer } from '../../../../conformance/src/lib/mcp-fake-server.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

interface RunEvent {
  type: string;
  payload?: Record<string, unknown>;
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

async function pollEvents(baseUrl: string, runId: string, headers: Record<string, string>): Promise<RunEvent[]> {
  const r = await fetch(
    `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
    { headers },
  );
  assert.equal(r.status, 200);
  const body = (await r.json()) as { events: RunEvent[] };
  return body.events;
}

async function main(): Promise<void> {
  const fake = new McpFakeServer();
  await fake.start();
  process.env.OPENWOP_MCP_SERVER_PROBE = fake.endpoint();

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

    // ── 1. LLM reasoning fixture — asserts agent.reasoned + agent.decided ──
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'host-internal-llm-reasoning' }),
      });
      assert.equal(create.status, 201, 'POST /v1/runs MUST return 201 for llm reasoning fixture');
      const { runId } = (await create.json()) as { runId: string };

      await poll(
        async () => {
          const r = await fetch(
            `${baseUrl}/v1/runs/${encodeURIComponent(runId)}`,
            { headers },
          );
          if (!r.ok) return null;
          return (await r.json()) as { status: string };
        },
        (v) => v.status === 'completed' || v.status === 'failed',
        { timeoutMs: 10_000 },
      );

      const events = await pollEvents(baseUrl, runId, headers);

      const reasoned = events.filter((e) => e.type === 'agent.reasoned');
      const decided = events.filter((e) => e.type === 'agent.decided');

      assert.ok(reasoned.length >= 1,
        `expected ≥1 agent.reasoned event (got ${reasoned.length}): ${JSON.stringify(events.map((e) => e.type))}`);
      assert.ok(decided.length >= 1,
        `expected ≥1 agent.decided event (got ${decided.length})`);

      // Canonical payload shape: agentId required.
      for (const ev of reasoned) {
        assert.equal(typeof ev.payload?.agentId, 'string');
        assert.ok((ev.payload!.agentId as string).length >= 3,
          'agentId MUST be >= 3 chars per agentReasoned schema');
        assert.equal(typeof ev.payload!.reasoning, 'string');
        const verbosity = ev.payload!.verbosity as string;
        assert.ok(verbosity === 'summary' || verbosity === 'full',
          `expected verbosity in {summary, full}, got ${String(verbosity)}`);
      }

      for (const ev of decided) {
        assert.equal(typeof ev.payload?.agentId, 'string');
        assert.ok(ev.payload!.decision !== undefined);
        assert.equal(typeof ev.payload!.confidence, 'number');
        assert.ok(
          (ev.payload!.confidence as number) >= 0 && (ev.payload!.confidence as number) <= 1,
          'confidence MUST be in [0, 1] per agentDecided schema',
        );
      }

      // SR-1: cleartext credential / input never appears on agent.* events.
      const dump = JSON.stringify(events.filter((e) => e.type.startsWith('agent.')));
      assert.equal(dump.includes('"openai-secret"'), false);
    }

    // ── 2. MCP toolcall fixture — asserts agent.toolCalled + agent.toolReturned ──
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'host-internal-mcp-toolcall' }),
      });
      assert.equal(create.status, 201, 'POST /v1/runs MUST return 201 for mcp toolcall fixture');
      const { runId } = (await create.json()) as { runId: string };

      await poll(
        async () => {
          const r = await fetch(
            `${baseUrl}/v1/runs/${encodeURIComponent(runId)}`,
            { headers },
          );
          if (!r.ok) return null;
          return (await r.json()) as { status: string };
        },
        (v) => v.status === 'completed' || v.status === 'failed',
        { timeoutMs: 10_000 },
      );

      const events = await pollEvents(baseUrl, runId, headers);

      const called = events.filter((e) => e.type === 'agent.toolCalled');
      const returned = events.filter((e) => e.type === 'agent.toolReturned');

      assert.ok(called.length >= 1,
        `expected ≥1 agent.toolCalled (got ${called.length}): ${JSON.stringify(events.map((e) => e.type))}`);
      assert.ok(returned.length >= 1,
        `expected ≥1 agent.toolReturned (got ${returned.length})`);

      // Pair via shared callId.
      for (const ret of returned) {
        const callId = ret.payload?.callId as string;
        assert.equal(typeof callId, 'string');
        const match = called.find((c) => c.payload?.callId === callId);
        assert.ok(match,
          `agent.toolReturned.callId=${callId} MUST pair with a prior agent.toolCalled`);
      }

      // MCP-1 redaction: raw "smoke-probe" string MUST NOT appear on any agent.* event.
      const agentEventsDump = JSON.stringify(events.filter((e) => e.type.startsWith('agent.')));
      assert.equal(agentEventsDump.includes('smoke-probe'), false,
        'MCP-1: raw tool argument value MUST NOT appear on agent.* event payloads');

      // SHA-256 digest format (64 hex chars).
      for (const ev of called) {
        const sha = ev.payload?.argumentsSha256 as string | undefined;
        if (sha !== undefined) {
          assert.match(sha, /^[0-9a-f]{64}$/);
        }
      }
      for (const ev of returned) {
        const outcome = ev.payload?.outcome as { resultSha256?: string } | undefined;
        if (outcome?.resultSha256 !== undefined) {
          assert.match(outcome.resultSha256, /^[0-9a-f]{64}$/);
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log('ok reasoning-event-emission — agent.reasoned + agent.decided + agent.toolCalled + agent.toolReturned verified with SR-1 + MCP-1 redaction');
  } finally {
    await close();
    await fake.stop();
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
