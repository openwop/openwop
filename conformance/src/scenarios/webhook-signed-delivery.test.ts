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
 * Operator contract — THREE gates, not one (clarified 2026-08-25).
 *
 * The test receiver is `http://127.0.0.1:{port}/`, and `webhooks.md`
 * forbids it three separate times. A host honoring
 * `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` (or an equivalent opt-in) MUST
 * relax ALL THREE for this scenario to be witnessable:
 *
 *   1. **Scheme.** §"SSRF protection" bullet 1 rejects non-`https://`
 *      protocols, and §"Register" says `url` MUST be `https://`. The
 *      receiver is plain `http`. This gate is the one the flag's
 *      description omitted until 2026-08-25, and it fires FIRST on a
 *      host that validates scheme before address.
 *   2. **Registration-time address check.** §"SSRF protection": the
 *      server MUST validate subscription URLs at registration time and
 *      reject loopback / RFC1918 / link-local / ULA / metadata.
 *   3. **Delivery-time re-resolution.** §"Delivery-time egress
 *      validation (RFC 0093)": the dispatcher MUST re-resolve at
 *      delivery time and validate every resolved address against the
 *      same ranges.
 *
 * Gates 2 and 3 are INDEPENDENT MUSTs at different layers, so "which
 * layer must the opt-in reach" is not a matter of taste: a relaxation
 * reaching only one layer cannot produce a witness. Delivery-only leaves
 * registration returning `400 webhook_url_rejected` (observed on a tier-2
 * host, 2026-08-25); registration-only leaves the dispatcher re-resolving
 * `127.0.0.1` and refusing to connect. A host whose opt-in reaches one
 * layer is not non-conformant — it simply cannot witness this scenario,
 * and that is a property of the test posture, not of its webhook signing.
 *
 * What that costs is more than a checkmark, and it is worth stating plainly
 * because the cost is invisible from inside such a host. This scenario is
 * typically the ONLY automated oracle a host has on its delivery header
 * NAMES: a host-local delivery test almost always compares a hand-written
 * literal in the test to a hand-written literal in the implementation, which
 * is a mirror — typo both and it stays green — while the HMAC assertion
 * beside it recomputes from `node:crypto` and is real. So the names go
 * unchecked exactly where the bytes are checked well. All three reference
 * hosts emitted invented header names for 16 days (openwop-examples#22) and
 * the runs that would have caught it were the ones this scenario could not
 * reach. A host that runs it is not thereby careful; it is thereby measured.
 *
 * Relaxing gates 2 and 3 is test-only posture. See
 * `SECURITY/threat-model-secret-leakage.md` §4.9 for why a
 * registration-time relaxation is the more dangerous of the two: it
 * writes a durable subscription row that survives the flag being turned
 * back off.
 *
 * `OPENWOP_WEBHOOK_RECEIVER_URL` — the route that relaxes NOTHING (added
 * 2026-08-28). Set it to a public `https:` tunnel or TLS-terminating proxy
 * standing in front of this scenario's own local receiver. Registration then
 * uses that URL and all three gates are satisfied honestly: the scheme is
 * `https:`, the registered address is public, and delivery-time re-resolution
 * resolves a public address it is entitled to connect to. No guard is waived,
 * no durable private-address row is written, and §4.9's hazard does not arise.
 *
 * This exists because the ALLOW_PRIVATE contract above is unsatisfiable for a
 * host whose guard is strongest at registration time: reported by a tier-2
 * host (2026-08-25) whose `classifyUrl` rejects on scheme AND address as two
 * independent grounds returning one code, so relaxing the address check leaves
 * the scheme check standing and the row `blocked` either way. Such a host is
 * conformant and was simply unmeasurable. It is now measurable.
 *
 * Two things it deliberately does NOT do. It is not "register any endpoint":
 * the assertions read an in-process array, so a third-party destination would
 * turn the row green while every assertion went vacuous — see
 * `resolveRegistrationUrl`. And it does not soften a rejection into a skip: a
 * host that refuses a legitimate public https destination FAILS, because
 * `blocked` would let it record a missing precondition forever instead of the
 * finding it earned.
 *
 * Paired with a positive control (bottom of this file) so the tunnelled pass
 * is attributable to a guard that works rather than to a guard that is absent.
 *
 * When the host rejects with `400 webhook_url_rejected`, this scenario
 * records `blocked` (RFC 0148 §A) — NOT a pass. Under a plain
 * `vitest run` the console still prints "1 passed", because that is
 * vitest reporting test outcomes rather than conformance dispositions;
 * the run-end disposition summary (`src/global-setup.ts`) is where the
 * `blocked` becomes visible without `--certify`.
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
import { discoverOwnedTenant, resolveRegistrationUrl } from '../lib/webhook-receiver.js';
import { req } from '../lib/requirement-ids.js';

interface DeliveredRequest {
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function startReceiver(): Promise<{ server: Server; url: string; received: DeliveredRequest[] }> {
  const received: DeliveredRequest[] = [];
  const server = createServer((reqBody: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    reqBody.on('data', (c: Buffer) => chunks.push(c));
    reqBody.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(reqBody.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(',');
      }
      received.push({ headers, body });
      res.writeHead(204);
      res.end();
    });
  });
  // Port 0 (ephemeral) by default — nothing outside this process needs to find
  // it. But OPENWOP_WEBHOOK_RECEIVER_URL fronts THIS receiver through a tunnel,
  // and a tunnel has to be pointed at a port the operator knows in ADVANCE. An
  // ephemeral port makes that variable unusable by anyone not reading the port
  // out of a running process — a gap found by standing up a real TLS front and
  // trying to use the feature, not by reading the code. OPENWOP_WEBHOOK_RECEIVER_PORT
  // pins it so `ngrok http <port>` (or a proxy) has a stable target.
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  await new Promise<void>((resolve) => server.listen(bindPort, '127.0.0.1', () => resolve()));
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
    const registration = resolveRegistrationUrl(receiver.url);
    const reg = await driver.post('/v1/webhooks', {
      url: registration.url,
      events: ['run.completed'],
      ...(ownedTenant ? { tenantId: ownedTenant } : {}),
    });

    // SSRF guard: if the host rejects the destination, what that MEANS depends
    // on which URL was registered.
    //
    //   * No tunnel wired (loopback URL): the host is refusing a private
    //     address, which webhooks.md REQUIRES it to do. That is correct
    //     behaviour and the scenario is unwitnessable here — `blocked`.
    //   * Tunnel wired (public https URL): the host refused a destination the
    //     spec makes legitimate. RFC 0093 does not permit rejecting a public
    //     https host, so this is a FINDING, not a missing precondition. Fail.
    //
    // Soft-skipping the second case would let a host that rejects everything
    // record `blocked` forever instead of the failure it earned.
    if (reg.status === 400) {
      const body = reg.json as { error?: string };
      if (body.error === 'webhook_url_rejected') {
        if (!registration.tunnelled) {
          // eslint-disable-next-line no-console
          console.warn(
            '[webhook-signed-delivery] host SSRF guard rejected the loopback receiver; ' +
              'set OPENWOP_WEBHOOK_RECEIVER_URL to a public https tunnel in front of it ' +
              '(preferred — relaxes no guard), or OPENWOP_WEBHOOK_ALLOW_PRIVATE=true on the host',
          );
          return softSkip('blocked', 'precondition not met — `body.error === \'webhook_url_rejected\'` returned early (seam, prior step, or fixture unavailable)');
        }
        expect.fail(
          `host rejected the operator-supplied public https receiver (${registration.url}) with ` +
            'webhook_url_rejected. A public https destination is legitimate under ' +
            'webhooks.md §"SSRF protection" and RFC 0093 §"Delivery-time egress validation"; ' +
            'rejecting it is a host defect, not an unmet precondition.',
        );
      }
    }

    expect(reg.status, req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 
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
    expect(typeof sub.webhookId, req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 
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
    // With a tunnel wired this is the assertion that keeps a mis-wired front
    // from reading as a pass. Registration succeeded, so the host believes it
    // has a subscriber; if nothing arrived HERE, the delivery went somewhere
    // this process cannot see and every assertion below it would be vacuous.
    // It fails — it must never soft-skip.
    expect(ourDeliveries.length, req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 
      'webhooks.md §"Delivery"',
      registration.tunnelled
        ? 'host MUST POST at least one event for THIS run to the registered subscriber. ' +
          'Registration was accepted, so zero deliveries observed on the local receiver means ' +
          'either the host did not deliver, or OPENWOP_WEBHOOK_RECEIVER_URL does not actually ' +
          'front this process. Both are failures; neither is a skip.'
        : 'host MUST POST at least one event for THIS run to a registered subscriber after run.completed',
    )).toBeGreaterThan(0);

    // Validate the FIRST delivery's signature contract. Other deliveries
    // share the same signing rules; checking one is sufficient.
    const first = ourDeliveries[0]!;
    expect(first.headers['x-openwop-signature-algorithm'], req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 
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
      req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 'webhooks.md §"Delivery headers"', 'X-openwop-Webhook-Id MUST carry the subscription id'),
    ).toBe(sub.webhookId);

    const timestamp = first.headers['x-openwop-timestamp'];
    expect(
      typeof timestamp === 'string' && timestamp.length > 0,
      req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 'webhooks.md §"Delivery headers"', 'X-openwop-Timestamp MUST be a Unix-seconds integer string'),
    ).toBe(true);

    const signature = first.headers['x-openwop-signature'] ?? '';
    expect(
      signature.startsWith('sha256='),
      req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 'webhooks.md §"Delivery headers"', 'X-openwop-Signature MUST carry the `sha256=` prefix'),
    ).toBe(true);
    const expected = createHmac('sha256', sub.secret)
      .update(`${timestamp}.${first.body}`, 'utf8')
      .digest('hex');
    expect(
      signature.replace('sha256=', ''),
      req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 'webhooks.md §"Delivery headers"', 'X-openwop-Signature MUST be sha256=HMAC-SHA256(secret, `${X-openwop-Timestamp}.${rawBody}`)'),
    ).toBe(expected);

    // RFC 0165 §C.1 — dual emission of the `OpenWOP-*` family. SHOULD-level and
    // presence-gated: when the new family is present, every value MUST equal its
    // `X-openwop-*` counterpart and the signature verifies reading either.
    const dual = first.headers['openwop-signature'];
    if (dual === undefined) {
      softSkip('inapplicable', 'host does not yet dual-emit the OpenWOP-* webhook header family (RFC 0165 §C.1 — SHOULD)');
    } else {
      for (const [neu, old] of [
        ['openwop-webhook-id', 'x-openwop-webhook-id'],
        ['openwop-event-type', 'x-openwop-event-type'],
        ['openwop-timestamp', 'x-openwop-timestamp'],
        ['openwop-signature', 'x-openwop-signature'],
        ['openwop-signature-algorithm', 'x-openwop-signature-algorithm'],
      ] as const) {
        expect(first.headers[neu], req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 'RFC 0165 §C.1', `${neu} MUST equal ${old} when the OpenWOP-* family is emitted`)).toBe(first.headers[old]);
      }
      expect(
        String(dual).replace('sha256=', ''),
        req('openwop.it.webhook-signed-delivery.host-posts-run-events-to-subscriber-with-valid-x-openwop-signature', 'RFC 0165 §C.1', 'OpenWOP-Signature MUST verify over the same bytes as X-openwop-Signature'),
      ).toBe(expected);
    }

    // Body should parse as JSON with a run event shape.
    const event = JSON.parse(first.body) as { type?: unknown; runId?: unknown };
    expect(typeof event.type).toBe('string');
    expect(event.runId).toBe(runId);

    // Cleanup: unregister.
    const del = await driver.delete(`/v1/webhooks/${encodeURIComponent(sub.webhookId)}`);
    expect(del.status).toBeGreaterThanOrEqual(200);
    expect(del.status).toBeLessThan(300);
  });

  /**
   * POSITIVE CONTROL for the tunnel path.
   *
   * Without this, the tunnel run passes identically on two very different
   * hosts: one whose SSRF guard is intact and was cleared by a legitimate
   * public destination, and one that has NO GUARD AT ALL and would have
   * accepted the loopback URL just as happily. The green would be reporting on
   * the operator's tunnel rather than on the host's behaviour, and the
   * variable would be doing no work.
   *
   * So: with the tunnel wired, re-register the LOOPBACK url and require that
   * the host still refuses it. That is what makes the sibling test's pass
   * attributable to the guard being cleared rather than absent.
   *
   * A host that ACCEPTS loopback here is not necessarily non-conformant — it
   * may be running with `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true`. But in that
   * configuration the tunnel is demonstrating nothing, and saying so is the
   * control's whole job.
   */
  it('control: with a tunnel wired, the host still refuses the loopback receiver', async () => {
    if (!(await isWebhookSupported())) {
      return softSkip('inapplicable', '[webhook-signed-delivery] host does not advertise webhook support; skipping');
    }
    if (!process.env.OPENWOP_WEBHOOK_RECEIVER_URL?.trim()) {
      // No tunnel wired ⇒ the sibling test already registers loopback directly
      // and this control has nothing to add.
      return softSkip('inapplicable', 'control applies only when OPENWOP_WEBHOOK_RECEIVER_URL is set');
    }

    const receiver = await startReceiver();
    activeServer = receiver.server;

    const ownedTenant = await discoverOwnedTenant(driver);
    const reg = await driver.post('/v1/webhooks', {
      url: receiver.url, // deliberately the raw loopback URL, NOT the tunnel
      events: ['run.completed'],
      ...(ownedTenant ? { tenantId: ownedTenant } : {}),
    });

    if (reg.status >= 200 && reg.status < 300) {
      // Clean up the subscription we just created before failing, so a failed
      // control does not leave a live loopback subscriber behind.
      const created = reg.json as { webhookId?: string };
      if (created?.webhookId) {
        await driver.delete(`/v1/webhooks/${encodeURIComponent(created.webhookId)}`);
      }
    }

    expect(reg.status, req('openwop.it.webhook-signed-delivery.control-with-a-tunnel-wired-the-host-still-refuses-the-loopback-receiver', 
      'webhooks.md §"SSRF protection"',
      'the server MUST reject loopback subscription URLs at registration time. ' +
        'It was accepted here, so this run cannot attribute the tunnelled test\'s pass to ' +
        'a working guard: a host with no guard produces the same result. Either the guard is ' +
        'absent (a finding) or OPENWOP_WEBHOOK_ALLOW_PRIVATE is set (in which case drop the ' +
        'tunnel — it is not doing anything).',
    )).toBe(400);
  });
});
