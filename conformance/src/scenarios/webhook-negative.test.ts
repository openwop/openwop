/**
 * Webhook negative-path contract (webhooks.md + review hardening).
 *
 * Exercises three failure surfaces that the positive `webhook-signed-
 * delivery.test.ts` doesn't cover:
 *   1. SSRF guard — `POST /v1/webhooks` with a private-IP destination
 *      returns 400 `webhook_url_rejected` on hosts that enforce it.
 *   2. URL validation — malformed `url` returns 400 `validation_error`.
 *   3. Unregister of unknown subscription — `DELETE /v1/webhooks/{id}`
 *      returns 404 `subscription_not_found`.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.webhooks.supported = true`.
 *
 * SSRF gating: hosts that don't implement the guard (or bypass it via
 * `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true`) will accept the loopback URL
 * with 201 — that's acceptable spec behavior, so the SSRF subtest
 * soft-skips with a warning rather than failing.
 *
 * @see spec/v1/webhooks.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

async function isWebhookSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = (disco.json as { capabilities?: { webhooks?: { supported?: boolean } } })
    .capabilities;
  return caps?.webhooks?.supported === true;
}

describe('webhook-negative: SSRF guard rejects private destinations', () => {
  it('host with SSRF guard returns 400 webhook_url_rejected for loopback', async () => {
    if (!(await isWebhookSupported())) {
      // eslint-disable-next-line no-console
      console.warn('[webhook-negative] host does not advertise webhook support; skipping');
      return;
    }
    // Spec-complete except for the private URL, so validation passes and the
    // request reaches the SSRF guard. `{ url }` alone 400s `validation_error`
    // (missing `events`) before the guard runs. (Suite defect, fixed 2026-08-09.)
    const reg = await driver.post('/v1/webhooks', {
      url: 'http://127.0.0.1:65535/',
      events: ['run.completed'],
      tenantId: 'conformance-tenant',
    });
    if (reg.status === 201) {
      // Host accepted — SSRF guard not implemented or bypassed.
      // Soft-skip; this is acceptable per spec.
      // eslint-disable-next-line no-console
      console.warn(
        '[webhook-negative] host accepts loopback destinations; SSRF guard not enforced',
      );
      // Cleanup the subscription so we don't leak state.
      const body = reg.json as { subscriptionId?: string };
      if (body.subscriptionId) {
        await driver.delete(`/v1/webhooks/${encodeURIComponent(body.subscriptionId)}`);
      }
      return;
    }
    expect(reg.status, driver.describe(
      'webhooks.md + review §"Webhook SSRF guard"',
      'host with SSRF guard MUST return 400 for loopback / RFC1918 / link-local destinations',
    )).toBe(400);
    const body = reg.json as { error?: string };
    expect(body.error).toBe('webhook_url_rejected');
  });
});

describe('webhook-negative: validation errors', () => {
  it('malformed url returns 400 validation_error', async () => {
    if (!(await isWebhookSupported())) return;
    const reg = await driver.post('/v1/webhooks', { url: 'not a url' });
    expect([400, 422]).toContain(reg.status);
    const body = reg.json as { error?: string };
    expect(['validation_error', 'webhook_url_rejected']).toContain(body.error);
  });

  it('missing url returns 400 validation_error', async () => {
    if (!(await isWebhookSupported())) return;
    const reg = await driver.post('/v1/webhooks', { eventTypes: ['run.completed'] });
    expect(reg.status).toBe(400);
    const body = reg.json as { error?: string };
    expect(body.error).toBe('validation_error');
  });
});

describe('webhook-negative: unregister of unknown subscription', () => {
  it('DELETE /v1/webhooks/{unknown} returns 404 subscription_not_found', async () => {
    if (!(await isWebhookSupported())) return;
    const del = await driver.delete('/v1/webhooks/wh-does-not-exist');
    expect(del.status).toBe(404);
    const body = del.json as { error?: string };
    expect(body.error).toBe('subscription_not_found');
  });
});
