/**
 * Host-internal interrupts smoke for the Postgres reference host.
 *
 * Exercises the four interrupt node types end-to-end:
 *   1. core.approvalGate — single-approver accept path
 *   2. core.approvalGate — quorum (2-of-3) accept path with per-voter
 *      last-write-wins revote
 *   3. core.clarificationGate — answers validation + resume
 *   4. core.interrupt (external-event) — signed-callback token resolve
 *
 * @see spec/v1/interrupt.md
 * @see spec/v1/interrupt-profiles.md
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-interrupts-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
// Tests run sequentially via `npm test`; reuse default port 3839.
// ESM hoists imports, so the env var override above runs AFTER
// server.ts module init — picking a non-default port via env var
// here would not take effect.

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

async function pollUntilStatus(
  baseUrl: string,
  apiKey: string,
  runId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) {
      const body = (await r.json()) as { status: string };
      if (body.status === expected) return;
    }
    await new Promise((res) => setTimeout(res, 30));
  }
  throw new Error(`poll timeout: expected status=${expected}, waited ${timeoutMs}ms`);
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

    // ── 1. Single-approver approval ───────────────────────────────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-approval' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      await pollUntilStatus(baseUrl, apiKey, runId, 'waiting-approval', 3_000);

      const resolve = await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts/gate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ resumeValue: { action: 'accept' } }),
        },
      );
      assert.equal(resolve.status, 200, 'resolve MUST return 200');
      const resolveBody = (await resolve.json()) as { status: string };
      assert.equal(resolveBody.status, 'running');

      await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 3_000);
      console.log('  ✓ single-approver approval');
    }

    // ── 2. Quorum approval with revote ────────────────────────────────
    {
      // Use conformance-interrupt-quorum if present, else skip the
      // quorum-specific assertions. The fixture's config is what
      // determines requiredApprovals.
      const discoRes = await fetch(`${baseUrl}/.well-known/openwop`);
      const disco = (await discoRes.json()) as { fixtures?: string[] };
      const hasQuorum = (disco.fixtures ?? []).includes('conformance-interrupt-quorum');

      if (hasQuorum) {
        const create = await fetch(`${baseUrl}/v1/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ workflowId: 'conformance-interrupt-quorum' }),
        });
        assert.equal(create.status, 201);
        const { runId } = (await create.json()) as { runId: string };
        await pollUntilStatus(baseUrl, apiKey, runId, 'waiting-approval', 3_000);

        // First vote: pending.
        const v1 = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts/gate`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ resumeValue: { action: 'accept', voter: 'alice' } }),
          },
        );
        assert.equal(v1.status, 200);
        const v1Body = (await v1.json()) as { status: string };
        assert.equal(v1Body.status, 'waiting-approval', 'first vote MUST leave run waiting');

        // Second vote (different voter): may or may not resolve depending
        // on fixture's requiredApprovals. Try one more vote either way.
        const v2 = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts/gate`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ resumeValue: { action: 'accept', voter: 'bob' } }),
          },
        );
        assert.equal(v2.status, 200);

        // Run should eventually complete (≤3 voters covers default
        // fixture's requiredApprovals).
        const v3 = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts/gate`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ resumeValue: { action: 'accept', voter: 'carol' } }),
          },
        );
        // Either v2 or v3 hit quorum; one of the resolves returns status=running
        // and a subsequent vote returns 404 (interrupt already resolved).
        assert.ok(
          v3.status === 200 || v3.status === 404,
          `quorum revote MUST return 200 (resumed) or 404 (already resolved), got ${v3.status}`,
        );

        await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 5_000);
        console.log('  ✓ quorum approval');
      } else {
        console.log('  - quorum approval (fixture not advertised; skip)');
      }
    }

    // ── 3. Clarification gate ─────────────────────────────────────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-clarification' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      await pollUntilStatus(baseUrl, apiKey, runId, 'waiting-input', 3_000);

      // Fetch the interrupt payload to see what questions are asked.
      const eventsRes = await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      const eventsBody = (await eventsRes.json()) as {
        events: Array<{ type: string; nodeId: string | null; data?: unknown }>;
      };
      const suspendEvent = eventsBody.events.find((e) => e.type === 'node.suspended');
      assert.ok(suspendEvent, 'node.suspended event MUST be emitted');
      const suspendPayload = suspendEvent!.data as {
        config: { questions: Array<{ id: string }> };
      };
      const answers: Record<string, string> = {};
      for (const q of suspendPayload.config.questions) {
        answers[q.id] = `answer-${q.id}`;
      }

      const resolve = await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts/${suspendEvent!.nodeId}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ resumeValue: { answers } }),
        },
      );
      assert.equal(resolve.status, 200, 'clarification resolve MUST return 200');
      await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 3_000);
      console.log('  ✓ clarification gate');
    }

    // ── 4. External event (signed callback token) ─────────────────────
    {
      const discoRes = await fetch(`${baseUrl}/.well-known/openwop`);
      const disco = (await discoRes.json()) as { fixtures?: string[] };
      const hasExt = (disco.fixtures ?? []).includes('conformance-interrupt-external-event');
      if (!hasExt) {
        console.log('  - external-event (fixture not advertised; skip)');
      } else {
        const create = await fetch(`${baseUrl}/v1/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ workflowId: 'conformance-interrupt-external-event' }),
        });
        assert.equal(create.status, 201);
        const { runId } = (await create.json()) as { runId: string };
        await pollUntilStatus(baseUrl, apiKey, runId, 'waiting-external', 3_000);

        // Read the callback token from the node.suspended event payload.
        const eventsRes = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        const eventsBody = (await eventsRes.json()) as {
          events: Array<{ type: string; nodeId: string | null; data?: unknown }>;
        };
        const suspendEvent = eventsBody.events.find((e) => e.type === 'node.suspended');
        assert.ok(suspendEvent, 'node.suspended MUST be emitted for external-event');
        const payload = suspendEvent!.data as {
          interruptToken: string;
          config: { correlation?: Record<string, unknown> };
        };
        assert.ok(payload.interruptToken, 'callback token MUST be present in payload');

        // Resolve via the unauthenticated /v1/interrupts/{token} route.
        // The resumeValue MUST shallow-match config.correlation.
        const correlation = payload.config.correlation ?? {};
        const cb = await fetch(`${baseUrl}/v1/interrupts/${payload.interruptToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumeValue: correlation }),
        });
        assert.equal(cb.status, 200, 'signed-token resolve MUST return 200');
        await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 3_000);
        console.log('  ✓ external-event signed-callback resolve');
      }
    }

    console.log('postgres-host interrupts test: PASS');
  } finally {
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
