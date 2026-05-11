/**
 * Host-internal webhooks smoke for the Postgres reference host.
 *
 * Exercises:
 *   1. POST /v1/webhooks rejects RFC1918 + .local + .internal URLs
 *      (SSRF guard).
 *   2. POST /v1/webhooks accepts a valid public-shaped URL (we use
 *      `127.0.0.1` with OPENWOP_WEBHOOK_ALLOW_PRIVATE=true bypass to
 *      exercise the delivery path).
 *   3. Run a noop workflow; assert the local receiver gets at least one
 *      signed delivery for `run.completed`.
 *   4. Signature MUST validate via signPayload (HMAC-SHA256 over
 *      `${timestamp}.${rawBody}`).
 *   5. Payload MUST NOT include the `data` field (redactForFanOut).
 *   6. DELETE /v1/webhooks/{id} returns 200 + cancels future delivery.
 *
 * @see spec/v1/webhooks.md
 * @see src/webhooks.ts
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-webhooks-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
// Allow the test receiver to bind on 127.0.0.1 — production hosts
// reject loopback via the SSRF guard.
process.env.OPENWOP_WEBHOOK_ALLOW_PRIVATE = 'true';

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

interface ReceivedDelivery {
  signature: string;
  timestamp: string;
  algorithm: string;
  subscriptionId: string;
  body: string;
  parsed: Record<string, unknown>;
}

function bootReceiver(port: number, deliveries: ReceivedDelivery[]): Promise<() => Promise<void>> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c.toString('utf8');
      });
      req.on('end', () => {
        const sig = req.headers['x-openwop-signature'];
        const ts = req.headers['x-openwop-signature-timestamp'];
        const alg = req.headers['x-openwop-signature-algorithm'];
        const subId = req.headers['x-openwop-subscription-id'];
        deliveries.push({
          signature: typeof sig === 'string' ? sig : '',
          timestamp: typeof ts === 'string' ? ts : '',
          algorithm: typeof alg === 'string' ? alg : '',
          subscriptionId: typeof subId === 'string' ? subId : '',
          body,
          parsed: JSON.parse(body) as Record<string, unknown>,
        });
        res.writeHead(204);
        res.end();
      });
    });
    server.listen(port, '127.0.0.1', () => {
      resolve(
        (): Promise<void> => new Promise((r) => server.close(() => r())),
      );
    });
  });
}

try {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  // Test receiver on a separate port.
  const receiverPort = 3850;
  const deliveries: ReceivedDelivery[] = [];
  const stopReceiver = await bootReceiver(receiverPort, deliveries);

  try {
    const baseUrl = `http://127.0.0.1:${process.env.OPENWOP_PORT ?? '3839'}`;
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // ── 1. SSRF guard rejects RFC1918 + .local ────────────────────────
    // Temporarily disable the bypass for this assertion.
    delete process.env.OPENWOP_WEBHOOK_ALLOW_PRIVATE;
    const bad1 = await fetch(`${baseUrl}/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://10.0.0.1/hook' }),
    });
    assert.equal(bad1.status, 400, 'SSRF guard MUST reject 10.0.0.0/8');
    const bad1Body = (await bad1.json()) as { error: string };
    assert.equal(bad1Body.error, 'webhook_url_rejected');

    const bad2 = await fetch(`${baseUrl}/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://service.local/hook' }),
    });
    assert.equal(bad2.status, 400, 'SSRF guard MUST reject .local hostnames');

    const bad3 = await fetch(`${baseUrl}/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'http://127.0.0.1:1234/hook' }),
    });
    assert.equal(bad3.status, 400, 'SSRF guard MUST reject 127.0.0.0/8');
    console.log('  ✓ SSRF guard rejects RFC1918 + .local + loopback');

    // Re-enable bypass for delivery test.
    process.env.OPENWOP_WEBHOOK_ALLOW_PRIVATE = 'true';

    // ── 2. Register a valid subscription ──────────────────────────────
    const register = await fetch(`${baseUrl}/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `http://127.0.0.1:${receiverPort}/hook`,
        eventTypes: [], // empty = all events
      }),
    });
    assert.equal(register.status, 201, 'register MUST return 201');
    const registerBody = (await register.json()) as {
      subscriptionId: string;
      secret: string;
    };
    const { subscriptionId, secret } = registerBody;
    assert.ok(subscriptionId.startsWith('wh-'));
    assert.ok(secret.length >= 32, 'secret MUST be at least 32 chars');
    console.log('  ✓ register returns 201 + subscription id + secret');

    // ── 3. Create a run to trigger fan-out ────────────────────────────
    const create = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(create.status, 201);
    const { runId } = (await create.json()) as { runId: string };

    // Wait for delivery — fan-out is fire-and-forget so we poll.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const hasCompleted = deliveries.some(
        (d) => (d.parsed.type as string) === 'run.completed' && (d.parsed.runId as string) === runId,
      );
      if (hasCompleted) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const completedDeliveries = deliveries.filter(
      (d) => (d.parsed.type as string) === 'run.completed' && (d.parsed.runId as string) === runId,
    );
    assert.ok(
      completedDeliveries.length >= 1,
      `webhook MUST receive run.completed delivery; got ${deliveries.length} total deliveries`,
    );
    console.log(`  ✓ webhook receives signed delivery (${deliveries.length} events for this run)`);

    // ── 4. Verify signature ───────────────────────────────────────────
    const sample = completedDeliveries[0]!;
    assert.equal(sample.algorithm, 'v1', 'signature algorithm MUST be v1');
    assert.equal(sample.subscriptionId, subscriptionId);
    const expectedSig = createHmac('sha256', secret)
      .update(`${sample.timestamp}.${sample.body}`, 'utf8')
      .digest('hex');
    assert.equal(sample.signature, expectedSig, 'HMAC-SHA256 signature MUST validate');
    console.log('  ✓ HMAC-SHA256 signature validates');

    // ── 5. Payload redaction — no `data` field ────────────────────────
    assert.ok(
      !('data' in sample.parsed),
      'payload MUST NOT include data field (redactForFanOut); got: ' +
        JSON.stringify(Object.keys(sample.parsed)),
    );
    // Required envelope fields MUST be present.
    assert.equal(typeof sample.parsed.type, 'string');
    assert.equal(typeof sample.parsed.runId, 'string');
    assert.ok('seq' in sample.parsed, 'seq MUST be present');
    assert.ok('timestamp' in sample.parsed, 'timestamp MUST be present');
    console.log('  ✓ payload omits `data` field (envelope-only redaction)');

    // ── 6. Unregister + verify subsequent runs don't deliver ──────────
    const unregister = await fetch(
      `${baseUrl}/v1/webhooks/${encodeURIComponent(subscriptionId)}`,
      { method: 'DELETE', headers },
    );
    assert.equal(unregister.status, 200);
    const deliveryCountBefore = deliveries.length;

    // Create another run — should NOT trigger any delivery.
    const create2 = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(create2.status, 201);
    const { runId: runId2 } = (await create2.json()) as { runId: string };
    // Wait briefly for any potential delivery.
    await new Promise((res) => setTimeout(res, 500));
    const deliveriesForRun2 = deliveries
      .slice(deliveryCountBefore)
      .filter((d) => (d.parsed.runId as string) === runId2);
    assert.equal(
      deliveriesForRun2.length,
      0,
      `unregistered subscription MUST NOT receive any deliveries; got ${deliveriesForRun2.length}`,
    );
    console.log('  ✓ unregister stops future delivery');

    // ── 7. 404 on duplicate unregister ────────────────────────────────
    const dup = await fetch(
      `${baseUrl}/v1/webhooks/${encodeURIComponent(subscriptionId)}`,
      { method: 'DELETE', headers },
    );
    assert.equal(dup.status, 404, 'unregister on unknown subscription MUST return 404');
    console.log('  ✓ duplicate unregister returns 404');

    console.log('postgres-host webhooks test: PASS');
  } finally {
    await stopReceiver();
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
