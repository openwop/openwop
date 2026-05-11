/**
 * End-to-end webhook signed-delivery scenario (webhooks.md).
 *
 * Boots a local HTTP receiver, registers it via
 * `POST /v1/webhooks`, drives a run, and verifies that:
 *   1. Delivery arrives at the receiver.
 *   2. `X-openwop-Signature-Algorithm: v1` header is present.
 *   3. `X-openwop-Signature` is a valid HMAC-SHA256 of
 *      `${timestamp}.${rawBody}` under the subscription secret.
 *   4. `X-openwop-Subscription-Id` matches the returned subscription id.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.webhooks.supported = true`.
 *
 * Operator contract: hosts that implement a SSRF guard on
 * `POST /v1/webhooks` (rejecting loopback / RFC1918 / link-local
 * destinations to protect deployer infrastructure) MUST allow the test
 * receiver. The SQLite reference host bypasses the guard when the
 * `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` env var is set at boot. Test-only
 * hosts SHOULD provide an equivalent opt-in. When the host rejects with
 * `400 webhook_url_rejected`, this scenario skips with a warning.
 *
 * @see spec/v1/webhooks.md §"Signature scheme"
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

interface DeliveredRequest {
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function startReceiver(): Promise<{ server: Server; url: string; received: DeliveredRequest[] }> {
  const received: DeliveredRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(',');
      }
      received.push({ headers, body });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('receiver address unavailable');
  return { server, url: `http://127.0.0.1:${addr.port}/`, received };
}

let activeServer: Server | null = null;
afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;
  }
});

async function isWebhookSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = (disco.json as { capabilities?: { webhooks?: { supported?: boolean } } }).capabilities;
  return caps?.webhooks?.supported === true;
}

describe('webhook-signed-delivery: end-to-end HMAC v1', () => {
  it('host POSTs run events to subscriber with valid X-openwop-Signature', async () => {
    if (!(await isWebhookSupported())) {
      // eslint-disable-next-line no-console
      console.warn('[webhook-signed-delivery] host does not advertise webhook support; skipping');
      return;
    }
    if (!isFixtureAdvertised('conformance-noop')) {
      // eslint-disable-next-line no-console
      console.warn('[webhook-signed-delivery] conformance-noop not advertised; skipping');
      return;
    }

    const receiver = await startReceiver();
    activeServer = receiver.server;

    // Register the webhook.
    const reg = await driver.post('/v1/webhooks', { url: receiver.url });

    // SSRF guard skip: if the host rejects loopback destinations,
    // honor the operator contract and skip rather than fail.
    if (reg.status === 400) {
      const body = reg.json as { error?: string };
      if (body.error === 'webhook_url_rejected') {
        // eslint-disable-next-line no-console
        console.warn(
          '[webhook-signed-delivery] host SSRF guard rejected the loopback receiver; ' +
            'set OPENWOP_WEBHOOK_ALLOW_PRIVATE=true on the host (or equivalent) to run',
        );
        return;
      }
    }

    expect(reg.status, driver.describe(
      'webhooks.md §"Register"',
      'POST /v1/webhooks MUST return 201 with subscriptionId + secret on success',
    )).toBe(201);
    const sub = reg.json as { subscriptionId: string; secret: string };
    expect(typeof sub.subscriptionId).toBe('string');
    expect(typeof sub.secret).toBe('string');
    expect(sub.secret.length).toBeGreaterThan(0);

    // Drive a run; the host MUST deliver events to the registered receiver.
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    // Allow a small grace period for fire-and-forget delivery to land.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(receiver.received.length, driver.describe(
      'webhooks.md §"Delivery"',
      'host MUST POST at least one event to a registered subscriber for a completed run',
    )).toBeGreaterThan(0);

    // Validate the FIRST delivery's signature contract. Other deliveries
    // share the same signing rules; checking one is sufficient.
    const first = receiver.received[0]!;
    expect(first.headers['x-openwop-signature-algorithm'], driver.describe(
      'webhooks.md §"Signature algorithm versioning"',
      'every delivery MUST set X-openwop-Signature-Algorithm: v1',
    )).toBe('v1');
    expect(first.headers['x-openwop-subscription-id']).toBe(sub.subscriptionId);

    const timestamp = first.headers['x-openwop-signature-timestamp'];
    expect(typeof timestamp).toBe('string');
    expect((timestamp ?? '').length).toBeGreaterThan(0);

    const signature = first.headers['x-openwop-signature'];
    const expected = createHmac('sha256', sub.secret)
      .update(`${timestamp}.${first.body}`, 'utf8')
      .digest('hex');
    expect(signature, driver.describe(
      'webhooks.md §"Signature scheme"',
      'X-openwop-Signature MUST be HMAC-SHA256(secret, `${timestamp}.${rawBody}`) hex',
    )).toBe(expected);

    // Body should parse as JSON with a run event shape.
    const event = JSON.parse(first.body) as { type?: unknown; runId?: unknown };
    expect(typeof event.type).toBe('string');
    expect(event.runId).toBe(runId);

    // Cleanup: unregister.
    const del = await driver.delete(`/v1/webhooks/${encodeURIComponent(sub.subscriptionId)}`);
    expect(del.status).toBeGreaterThanOrEqual(200);
    expect(del.status).toBeLessThan(300);
  });
});
