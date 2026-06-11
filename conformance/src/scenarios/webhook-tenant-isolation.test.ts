/**
 * webhook-tenant-isolation — RFC 0093 §A.3 + SECURITY/invariants.yaml
 * `webhook-cross-tenant-isolation`.
 *
 * Status: ACTIVE (advertisement + behavioral). RFC 0093 §A.3: a webhook
 * subscription MUST receive only events from runs within the
 * subscription's tenant scope (the tenant established at registration
 * per the webhooks.md registration-time membership gate); cross-tenant
 * delivery is a protocol violation regardless of filter breadth.
 *
 * Delivery itself is not black-box observable from a single-tenant
 * conformance run (RFC 0093 §Conformance) — the delivery half is carried
 * by the reference-impl-tier `webhook-delivery-egress-revalidation`
 * pointers. What this scenario proves, mirroring the existing
 * cross-tenant-isolation pattern (`kv-cross-tenant-isolation.test.ts`):
 *
 *   - Seam-driven two-tenant proof through the optional reference-host
 *     test seam `POST /v1/host/sample/test/surface` (`surface: "webhooks"`,
 *     ops `register` / `list` / `unregister`): a subscription registered
 *     under tenant A MUST NOT appear in tenant B's subscription list.
 *     Hosts that don't expose the seam (HTTP 404) soft-skip this half.
 *
 *   - Black-box single-tenant proxy assertions on the registration
 *     surface (`webhooks.md` §Register/§Unregister): registering under a
 *     tenant the caller is not a member of is refused, and a held
 *     subscription cannot be unregistered through a foreign tenant scope.
 *
 * Gated via `behaviorGate('openwop-webhook-tenant-isolation',
 * webhooks.supported === true)` — soft-skip by default, hard-fail under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` (root-first family read per RFC 0073).
 *
 * @see RFCS/0093-protocol-hardening-webhooks-tokens-idempotency.md §A.3
 * @see spec/v1/webhooks.md §Endpoints (registration-time membership gate)
 * @see SECURITY/invariants.yaml — webhook-cross-tenant-isolation
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface WebhooksCap {
  readonly supported?: unknown;
}

/** A public, registration-safe delivery URL (https:// per webhooks.md;
 *  resolves publicly so SSRF guards don't reject it). Never delivered to
 *  in this scenario — registration only. */
const SAFE_URL = 'https://example.com/openwop-conformance/webhook-tenant-isolation';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seam(tenantId: string, op: string, args: Record<string, unknown>): Promise<OpenWOPResponse> {
  return driver.post('/v1/host/sample/test/surface', { tenantId, surface: 'webhooks', op, args });
}

async function gateOnWebhooks(): Promise<boolean> {
  const cap = await readCapabilityFamily<WebhooksCap>('webhooks');
  return behaviorGate('openwop-webhook-tenant-isolation', cap?.supported === true);
}

describe.skipIf(HTTP_SKIP)('webhook-tenant-isolation: advertisement shape (webhooks.md)', () => {
  it('the webhooks block is either absent or carries a boolean supported flag', async () => {
    const cap = await readCapabilityFamily<WebhooksCap>('webhooks');
    if (cap === undefined) return; // host doesn't advertise webhooks — conformant
    expect(
      typeof cap.supported,
      driver.describe('capabilities.schema.json §webhooks', 'webhooks.supported MUST be a boolean when present'),
    ).toBe('boolean');
  });
});

describe.skipIf(HTTP_SKIP)('webhook-tenant-isolation: two-tenant proof via the test seam (RFC 0093 §A.3)', () => {
  it('a subscription registered under tenant A is invisible to tenant B', async () => {
    if (!(await gateOnWebhooks())) return;

    const reg = await seam('tenant-a', 'register', {
      url: SAFE_URL,
      events: ['run.completed'],
    });
    if (reg.status === 404) return; // host doesn't expose the test seam — soft-skip
    expect(reg.status, driver.describe('RFC 0093 §A.3', 'seam register under tenant A MUST succeed')).toBe(200);
    const webhookId = (reg.json as { webhookId?: string }).webhookId;
    expect(typeof webhookId, 'seam register MUST return the new webhookId').toBe('string');

    try {
      const listB = await seam('tenant-b', 'list', {});
      expect(listB.status).toBe(200);
      const idsB = ((listB.json as { webhooks?: Array<{ webhookId?: string }> }).webhooks ?? [])
        .map((w) => w.webhookId);
      expect(
        idsB,
        driver.describe(
          'SECURITY/invariants.yaml webhook-cross-tenant-isolation',
          'tenant B MUST NOT see tenant A subscriptions in its list',
        ),
      ).not.toContain(webhookId);

      const listA = await seam('tenant-a', 'list', {});
      const idsA = ((listA.json as { webhooks?: Array<{ webhookId?: string }> }).webhooks ?? [])
        .map((w) => w.webhookId);
      expect(
        idsA,
        driver.describe('RFC 0093 §A.3', 'tenant A MUST see its own subscription (same-tenant control)'),
      ).toContain(webhookId);
    } finally {
      await seam('tenant-a', 'unregister', { webhookId });
    }
  });
});

describe.skipIf(HTTP_SKIP)('webhook-tenant-isolation: black-box registration-surface scoping (webhooks.md)', () => {
  it('registering under a tenant the caller is not a member of is refused', async () => {
    if (!(await gateOnWebhooks())) return;

    const foreignTenant = `openwop-conformance-foreign-${uniqueSuffix()}`;
    const reg = await driver.post('/v1/webhooks', {
      url: SAFE_URL,
      events: ['run.completed'],
      tenantId: foreignTenant,
    });

    if (reg.status === 201) {
      // Leaked registration — clean up before failing the assertion below.
      const body = reg.json as { webhookId?: string };
      if (body.webhookId) {
        await driver.delete(
          `/v1/webhooks/${encodeURIComponent(body.webhookId)}?tenantId=${encodeURIComponent(foreignTenant)}`,
        );
      }
    }
    expect(
      reg.status,
      driver.describe(
        'webhooks.md §Endpoints ("the caller MUST be a member of the tenant") + RFC 0093 §A.3',
        'registration under a tenant the caller is not a member of MUST be refused (403/404/400), never 201',
      ),
    ).not.toBe(201);
  });

  it('a held subscription cannot be unregistered through a foreign tenant scope', async () => {
    if (!(await gateOnWebhooks())) return;

    // Register under the caller's own tenant (host defaults the scope from
    // the API key when tenantId is omitted — the same registration shape the
    // webhook delivery scenarios use).
    const reg = await driver.post('/v1/webhooks', {
      url: SAFE_URL,
      events: ['run.completed'],
    });
    if (reg.status !== 201) {
      // Host requires an explicit tenantId (or rejected the public URL) —
      // nothing to hold; the membership-gate leg above still applies.
      // eslint-disable-next-line no-console
      console.warn(
        `[webhook-tenant-isolation] could not register a probe subscription (${reg.status}); skipping foreign-unregister leg`,
      );
      return;
    }
    const webhookId = (reg.json as { webhookId?: string }).webhookId;
    expect(typeof webhookId, 'registration MUST return webhookId').toBe('string');

    try {
      const foreignTenant = `openwop-conformance-foreign-${uniqueSuffix()}`;
      const del = await driver.delete(
        `/v1/webhooks/${encodeURIComponent(webhookId!)}?tenantId=${encodeURIComponent(foreignTenant)}`,
      );
      expect(
        del.status !== 204 && del.status < 500,
        driver.describe(
          'webhooks.md §Unregister (403 non-member / 404 not-in-scope) + RFC 0093 §A.3',
          `unregister through a foreign tenant scope MUST NOT succeed (got ${del.status})`,
        ),
      ).toBe(true);
    } finally {
      // Best-effort cleanup in the caller's own scope.
      await driver.delete(`/v1/webhooks/${encodeURIComponent(webhookId!)}`);
    }
  });
});
