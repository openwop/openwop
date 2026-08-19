/**
 * End-to-end webhook signed-delivery scenario (webhooks.md).
 *
 * Boots a local HTTP receiver, registers it via
 * `POST /v1/webhooks`, drives a run, and verifies that:
 *   1. Delivery arrives at the receiver.
 *   2. `X-openwop-Signature-Algorithm: v1` header is present.
 *   3. `X-openwop-Signature` is a valid HMAC-SHA256 of
 *      `${timestamp}.${rawBody}` under the subscription secret.
 *   4. `X-openwop-Webhook-Id` matches the returned `webhookId`.
 *      (This line said `X-openwop-Subscription-Id` until 2026-08-19, two years
 *      after the assertion below stopped checking that header — a docblock
 *      asserting more than the code did, in the file that documents a
 *      security-relevant contract.)
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
import { softSkip } from '../lib/soft-skip.js';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { discoverOwnedTenant } from '../lib/webhook-receiver.js';

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
  const caps = discoveryFamilies(disco.json) as { webhooks?: { supported?: boolean } };
  return caps.webhooks?.supported === true;
}

describe('webhook-signed-delivery: end-to-end HMAC v1', () => {
  it('host POSTs run events to subscriber with valid X-openwop-Signature', async () => {
    if (!(await isWebhookSupported())) {
      // eslint-disable-next-line no-console
      console.warn('[webhook-signed-delivery] host does not advertise webhook support; skipping');
      return softSkip('inapplicable', '[webhook-signed-delivery] host does not advertise webhook support; skipping');
    }
    if (!isFixtureAdvertised('conformance-noop')) {
      // eslint-disable-next-line no-console
      console.warn('[webhook-signed-delivery] conformance-noop not advertised; skipping');
      return softSkip('inapplicable', '[webhook-signed-delivery] conformance-noop not advertised; skipping');
    }

    const receiver = await startReceiver();
    activeServer = receiver.server;

    // Register the webhook.
    // webhooks.md §Register: `events` + `tenantId` are REQUIRED (empty events → 400).
    // The pre-fix `{ url }`-only body 400s on validation before delivery can occur.
    // (Suite defect, fixed 2026-08-09.) The delivered run's tenant must match this
    // subscription's tenantId — verified end-to-end against the openwop-app host.
    // Derive a tenant the bearer OWNS from a probe run's snapshot — a hard-coded
    // tenantId is 403'd by a host that scopes subscriptions by membership
    // (RFC 0093). Single-tenant hosts return undefined ⇒ omit tenantId.
    const ownedTenant = await discoverOwnedTenant(driver);
    const reg = await driver.post('/v1/webhooks', {
      url: receiver.url,
      events: ['run.completed'],
      ...(ownedTenant ? { tenantId: ownedTenant } : {}),
    });

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
        return softSkip('blocked', 'precondition not met — `body.error === \'webhook_url_rejected\'` returned early (seam, prior step, or fixture unavailable)');
      }
    }

    expect(reg.status, driver.describe(
      'webhooks.md §"Register"',
      'POST /v1/webhooks MUST return 201 with webhookId + secret on success',
    )).toBe(201);
    // `webhookId`, NOT `subscriptionId` (corrected 2026-08-19). `webhooks.md`
    // §"Register" shows `{"webhookId": "wh_a3b9c2", ...}`, `api/openapi.yaml`
    // declares the 201 body `required: [webhookId]` with no `subscriptionId`
    // property at all, and the sibling `webhook-tenant-isolation.test.ts` reads
    // `webhookId`. This file required a field the contract does not define, so a
    // SPEC-CONFORMING host failed at the first assertion — the suite being
    // different from the spec, which is worse than the stricter-than-spec case
    // COMPATIBILITY.md §2.3 forbids. Reported by a tier-2 host emitting exactly
    // what the spec shows. The postgres reference host returns both names, which
    // is why nothing went red here.
    const sub = reg.json as { webhookId: string; secret: string };
    expect(typeof sub.webhookId, driver.describe(
      'api/openapi.yaml registerWebhook 201',
      'the 201 body MUST carry `webhookId` (required) — `subscriptionId` is not in the contract',
    )).toBe('string');
    expect(typeof sub.secret).toBe('string');
    expect(sub.secret.length).toBeGreaterThan(0);

    // Drive a run; the host MUST deliver events to the registered receiver.
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    // Allow a small grace period for fire-and-forget delivery to land.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Test-isolation note: when this scenario runs concurrently with
    // other webhook-bearing scenarios against a stateful host, the
    // host's webhook registry fans out EVERY run's events to EVERY
    // registered subscription. Receivers in this scenario MAY observe
    // deliveries from other tests' concurrent runs. Filter to events
    // carrying THIS test's runId so the assertion checks the
    // signature shape on a delivery the host emitted for THIS run.
    const ourDeliveries = receiver.received.filter((d) => {
      try {
        const body = JSON.parse(d.body) as { runId?: unknown };
        return body.runId === runId;
      } catch {
        return false;
      }
    });
    expect(ourDeliveries.length, driver.describe(
      'webhooks.md §"Delivery"',
      'host MUST POST at least one event for THIS run to a registered subscriber after run.completed',
    )).toBeGreaterThan(0);

    // Validate the FIRST delivery's signature contract. Other deliveries
    // share the same signing rules; checking one is sufficient.
    const first = ourDeliveries[0]!;
    expect(first.headers['x-openwop-signature-algorithm'], driver.describe(
      'webhooks.md §"Signature algorithm versioning"',
      'every delivery MUST set X-openwop-Signature-Algorithm: v1',
    )).toBe('v1');
    // Header names + signature format per webhooks.md v1.1 §"Delivery headers"
    // (the SSoT). The pre-fix scenario asserted `x-openwop-subscription-id`,
    // `x-openwop-signature-timestamp`, and a BARE-HEX `x-openwop-signature` —
    // three names/shapes that appear in NO spec file or RFC. webhooks.md
    // specifies `X-openwop-Webhook-Id`, `X-openwop-Timestamp`, and
    // `X-openwop-Signature: sha256={hex}`. (Suite↔spec divergence fixed 2026-08-09.)
    expect(
      first.headers['x-openwop-webhook-id'],
      driver.describe('webhooks.md §"Delivery headers"', 'X-openwop-Webhook-Id MUST carry the subscription id'),
    ).toBe(sub.webhookId);

    const timestamp = first.headers['x-openwop-timestamp'];
    expect(
      typeof timestamp === 'string' && timestamp.length > 0,
      driver.describe('webhooks.md §"Delivery headers"', 'X-openwop-Timestamp MUST be a Unix-seconds integer string'),
    ).toBe(true);

    const signature = first.headers['x-openwop-signature'] ?? '';
    expect(
      signature.startsWith('sha256='),
      driver.describe('webhooks.md §"Delivery headers"', 'X-openwop-Signature MUST carry the `sha256=` prefix'),
    ).toBe(true);
    const expected = createHmac('sha256', sub.secret)
      .update(`${timestamp}.${first.body}`, 'utf8')
      .digest('hex');
    expect(
      signature.replace('sha256=', ''),
      driver.describe('webhooks.md §"Delivery headers"', 'X-openwop-Signature MUST be sha256=HMAC-SHA256(secret, `${X-openwop-Timestamp}.${rawBody}`)'),
    ).toBe(expected);

    // Body should parse as JSON with a run event shape.
    const event = JSON.parse(first.body) as { type?: unknown; runId?: unknown };
    expect(typeof event.type).toBe('string');
    expect(event.runId).toBe(runId);

    // Cleanup: unregister.
    const del = await driver.delete(`/v1/webhooks/${encodeURIComponent(sub.webhookId)}`);
    expect(del.status).toBeGreaterThanOrEqual(200);
    expect(del.status).toBeLessThan(300);
  });
});
