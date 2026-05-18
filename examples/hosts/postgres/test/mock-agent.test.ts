/**
 * Conformance mock-agent smoke (RFC 0023).
 *
 * Verifies that `core.conformance.mock-agent` honors the RFC 0023 §B
 * emission contract against the canonical conformance fixtures:
 *
 *   1. `conformance-agent-reasoning` — host emits the full `agent.*`
 *      family (reasoned, toolCalled/toolReturned paired by `callId`,
 *      handoff, decided) on cue from config keys. Maps to
 *      `agentReasoningEvents.test.ts` in the conformance suite.
 *
 *   2. `conformance-agent-low-confidence` — host emits `agent.decided`
 *      with confidence below the default 0.7 escalation threshold, then
 *      follows with `node.suspended { reason: 'low-confidence', agentId,
 *      threshold, observed }` and transitions to `'waiting-approval'`
 *      per `spec/v1/interrupt.md` §`kind: "low-confidence"`. Maps to
 *      `agentConfidenceEscalation.test.ts` in the conformance suite.
 *
 * The host's `core.conformance.mock-agent` registration is gated by
 * RFC 0023 §B.1 (workflow-id prefix `conformance-*`); both fixtures
 * satisfy the gate. Production hosts SHOULD drop this typeId from
 * their registry; the reference host keeps it so the protocol-normative
 * scenarios have a host to target.
 *
 * @see RFCS/0023-conformance-agent-event-emitters.md
 * @see schemas/core-conformance-mock-agent-config.schema.json
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-mock-agent-'));
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

interface RunEvent {
  type: string;
  eventId?: string;
  causationId?: string;
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

async function pollEvents(
  baseUrl: string,
  runId: string,
  headers: Record<string, string>,
): Promise<RunEvent[]> {
  const r = await fetch(
    `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
    { headers },
  );
  assert.equal(r.status, 200);
  const body = (await r.json()) as { events: RunEvent[] };
  return body.events;
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

    // ── 0. Discovery advertises capabilities.conformance.mockAgent ────
    {
      const disco = await fetch(`${baseUrl}/.well-known/openwop`, { headers });
      assert.equal(disco.status, 200);
      const body = (await disco.json()) as {
        capabilities?: { conformance?: { mockAgent?: boolean } };
        fixtures?: string[];
      };
      assert.equal(
        body.capabilities?.conformance?.mockAgent,
        true,
        'RFC 0023 §B.2: host MUST advertise capabilities.conformance.mockAgent when registering the typeId',
      );
      assert.ok(
        Array.isArray(body.fixtures) &&
          body.fixtures.includes('conformance-agent-reasoning') &&
          body.fixtures.includes('conformance-agent-low-confidence'),
        'host MUST advertise both fixtures via capabilities.fixtures',
      );
    }

    // ── 1. conformance-agent-reasoning ─────────────────────────────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-agent-reasoning' }),
      });
      assert.equal(create.status, 201, 'POST /v1/runs MUST return 201');
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

      // RFC 0023 §B: at least one event from the closed set.
      const agentTypes = new Set([
        'agent.reasoned',
        'agent.toolCalled',
        'agent.toolReturned',
        'agent.handoff',
        'agent.decided',
      ]);
      const agentEvents = events.filter((e) => agentTypes.has(e.type));
      assert.ok(
        agentEvents.length >= 1,
        `expected ≥1 agent.* event from core.conformance.mock-agent; got ${JSON.stringify(events.map((e) => e.type))}`,
      );

      // Every agent.* payload identifies the agent per
      // run-event-payloads.schema.json: agent.handoff uses
      // fromAgentId/toAgentId; the other four use agentId.
      for (const ev of agentEvents) {
        const p = (ev.payload ?? {}) as Record<string, unknown>;
        if (ev.type === 'agent.handoff') {
          assert.equal(typeof p.fromAgentId, 'string', 'agent.handoff MUST carry fromAgentId');
          assert.equal(typeof p.toAgentId, 'string', 'agent.handoff MUST carry toAgentId');
        } else {
          assert.equal(typeof p.agentId, 'string', `${ev.type} MUST carry payload.agentId`);
          assert.ok((p.agentId as string).length >= 3, 'agentId MUST be ≥ 3 chars');
        }
      }

      // agent.toolReturned MUST pair with a prior agent.toolCalled —
      // two requirements per RFC 0002 §B: callId correlation AND
      // causationId === paired toolCalled.eventId. The Postgres host
      // threads the eventId through via makeEventId(runId, calledEv.seq).
      const called = agentEvents.filter((e) => e.type === 'agent.toolCalled');
      const returned = agentEvents.filter((e) => e.type === 'agent.toolReturned');
      assert.ok(called.length >= 1, 'fixture configures ≥1 mockToolCalls; expected ≥1 agent.toolCalled');
      assert.ok(returned.length >= 1, 'expected ≥1 paired agent.toolReturned');
      for (const ret of returned) {
        const callId = ret.payload?.callId as string | undefined;
        assert.equal(typeof callId, 'string');
        const match = called.find((c) => c.payload?.callId === callId);
        assert.ok(match, `agent.toolReturned.callId=${callId} MUST pair with a prior agent.toolCalled`);
        // Strict eventId chain — RFC 0002 §B normative MUST.
        assert.equal(
          typeof match!.eventId,
          'string',
          'paired agent.toolCalled MUST surface eventId on the /events projection',
        );
        assert.equal(
          ret.causationId,
          match!.eventId,
          `agent.toolReturned (callId=${callId}) MUST carry causationId === paired agent.toolCalled.eventId per RFC 0002 §B`,
        );
      }

      // The fixture's mockHandoff config triggers agent.handoff.
      const handoffs = agentEvents.filter((e) => e.type === 'agent.handoff');
      assert.ok(handoffs.length >= 1, 'fixture mockHandoff MUST produce agent.handoff');
      assert.equal(typeof handoffs[0]!.payload?.fromAgentId, 'string');
      assert.equal(typeof handoffs[0]!.payload?.toAgentId, 'string');

      // The fixture's mockDecision config triggers agent.decided.
      const decided = agentEvents.filter((e) => e.type === 'agent.decided');
      assert.ok(decided.length >= 1, 'fixture mockDecision MUST produce agent.decided');
      // High-confidence decision (1.0) — run reaches completed, not waiting-approval.
      const final = (await (await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}`,
        { headers },
      )).json()) as { status: string };
      assert.equal(final.status, 'completed', 'high-confidence run MUST complete, not suspend');
    }

    // ── 2. conformance-agent-low-confidence (CP-1) ─────────────────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-agent-low-confidence' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      const final = await poll(
        async () => {
          const r = await fetch(
            `${baseUrl}/v1/runs/${encodeURIComponent(runId)}`,
            { headers },
          );
          if (!r.ok) return null;
          return (await r.json()) as { status: string };
        },
        (v) =>
          v.status === 'waiting-approval' ||
          v.status === 'completed' ||
          v.status === 'failed',
        { timeoutMs: 10_000 },
      );
      assert.equal(
        final.status,
        'waiting-approval',
        'CP-1: low-confidence agent.decided MUST drive run to waiting-approval',
      );

      const events = await pollEvents(baseUrl, runId, headers);

      const suspend = events.find(
        (e) => e.type === 'node.suspended' && e.payload?.reason === 'low-confidence',
      );
      assert.ok(
        suspend,
        'CP-1: host MUST emit node.suspended { reason: low-confidence } per interrupt.md',
      );
      const payload = suspend!.payload as Record<string, unknown>;
      assert.equal(typeof payload.agentId, 'string');
      assert.equal(typeof payload.threshold, 'number');
      assert.equal(typeof payload.observed, 'number');
      assert.ok(
        (payload.observed as number) < (payload.threshold as number),
        'observed MUST be < threshold per the CP-1 invariant',
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      'ok mock-agent — RFC 0023 §B emission contract verified against conformance-agent-reasoning + conformance-agent-low-confidence',
    );
  } finally {
    await close();
    rmSync(workdir, { recursive: true, force: true });
  }
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
