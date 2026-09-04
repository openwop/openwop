/**
 * RFC 0176 §D.2 — `v1-signed-webhook-accepted` (suite 2.0.0, target major 2;
 * gated on `webhooks`, driven through the seams profile).
 *
 * A v2 receiver MUST accept a delivery carrying only the `X-openwop-*` header
 * family under scheme `v1`, verifying the same bytes (`{timestamp}.{rawBody}`
 * HMAC-SHA256 with the subscription secret); this adds no signature scheme and
 * per-subscription secrets are unchanged across the cut (`spec/v2/core/webhooks.md`
 * §Dual emission through the overlap; persistence.md §Everything else a v1 host
 * persisted; migration row C9.9). The facet's `signatureAlgorithms[]` MUST list
 * `"v1"` (webhooks.md §Surfaces).
 *
 * The receiver under test is the HOST's inbound receiver path — the v2 host as
 * a subscriber (its trigger bridge, its A2A/MCP peer callbacks) — which the
 * canonical API does not expose. The seam this scenario drives:
 *
 *   POST /conformance/seams/sample/webhooks/receive
 *     { secret, headers: { "X-openwop-Webhook-Id", "X-openwop-Event-Type", "X-openwop-Timestamp",
 *                          "X-openwop-Signature", "X-openwop-Signature-Algorithm" }, body }
 *     → 200 { accepted: boolean, reason? }
 *
 * The host runs the delivery through its production verifier with `secret` as
 * the subscription secret and reports the verdict. Catalogued in
 * `api/seams-v2.yaml` (`receiveWebhookDelivery`); a host answering 404 / 403 / 405 records `blocked`
 * naming it. A control delivery with a wrong signature MUST be refused, so a
 * receiver that accepts everything does not pass.
 *
 * @see spec/v2/core/webhooks.md §Dual emission through the overlap
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { seamPath, seamsProfileAdvertised } from '../lib/seams.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/webhooks.md §Dual emission through the overlap';
const RECEIVE_V1 = '/v1/host/sample/webhooks/receive';
const RECEIVE = seamPath(RECEIVE_V1);

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** An `X-openwop-*`-only scheme-v1 delivery over the given bytes. */
function v1Delivery(secret: string, body: string, tamper = false): { headers: Record<string, string>; body: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const signature = tamper ? sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) : sig;
  return {
    headers: {
      'X-openwop-Webhook-Id': 'wh-conformance-v1-signed',
      'X-openwop-Event-Type': 'run.completed',
      'X-openwop-Timestamp': timestamp,
      'X-openwop-Signature': `sha256=${signature}`,
      'X-openwop-Signature-Algorithm': 'v1',
    },
    body,
  };
}

type Verdict = { readonly ok: true; readonly accepted: unknown; readonly reason: unknown } | { readonly ok: false; readonly kind: 'blocked'; readonly reason: string };

async function deliver(secret: string, delivery: { headers: Record<string, string>; body: string }): Promise<Verdict> {
  const res = await http(() => driver.post(RECEIVE_V1, { secret, headers: delivery.headers, body: delivery.body }));
  if (res === null) return { ok: false, kind: 'blocked', reason: `${RECEIVE} unreachable (fetch failed)` };
  if (res.status === 404 || res.status === 403 || res.status === 405) return { ok: false, kind: 'blocked', reason: `no inbound receiver seam — ${RECEIVE} answered ${res.status}; the host's v2 receiver path cannot be driven (RFC 0176 falsifiability §D.2)` };
  if (res.status !== 200 || !res.json || typeof res.json !== 'object') return { ok: false, kind: 'blocked', reason: `${RECEIVE} answered ${res.status} without a 200 { accepted } verdict — the receiver seam contract is not honoured` };
  const j = res.json as { accepted?: unknown; reason?: unknown };
  return { ok: true, accepted: j.accepted, reason: j.reason };
}

describe('RFC 0176 §D.2 — v1-signed-webhook-accepted (gated on webhooks + seams)', () => {
  it('the webhooks facet lists scheme "v1" — the scheme a v1-signed delivery is verified under', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const webhooks = await gateFamily('webhooks');
    if (!webhooks) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    const algorithms = webhooks['signatureAlgorithms'];
    expect(Array.isArray(algorithms), req('openwop.requirement.0176.v1-signed-webhook-accepted.facet', 'spec/v2/core/webhooks.md §Surfaces', 'the webhooks facet is { signatureAlgorithms[] }')).toBe(true);
    expect(algorithms, req('openwop.requirement.0176.v1-signed-webhook-accepted.facet', 'spec/v2/core/webhooks.md §Surfaces', 'signatureAlgorithms MUST list "v1" — the cut adds no signature scheme (RFC 0176 §D.2)')).toContain('v1');
  });

  it('the host\'s v2 receiver path accepts an X-openwop-*-only scheme-v1 delivery and refuses a tampered one', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    if (!(await gateFamily('webhooks'))) return softSkip('inapplicable', 'webhooks family not advertised (gate recorded under openwop.family.webhooks)');
    if (!seamsProfileAdvertised(doc)) return softSkip('blocked', `seams profile not advertised (conformance.seamsProfile !== openwop-conformance-seams-v2) — the host's inbound receiver is reachable only through ${RECEIVE}`);
    const secret = `conformance-secret-${Date.now().toString(36)}`;
    const body = JSON.stringify({ runId: 'run-conformance-v1-signed', workspaceId: 'ws-conformance', event: { type: 'run.completed', sequence: 3, payload: { durationMs: 1 } } });
    const good = await deliver(secret, v1Delivery(secret, body));
    if (!good.ok) return softSkip(good.kind, good.reason);
    expect(
      good.accepted,
      req('openwop.requirement.0176.v1-signed-webhook-accepted', DOC, `a v2 receiver MUST accept a delivery carrying only the X-openwop-* family under scheme v1, verifying the same bytes — refused${good.reason !== undefined ? ` (${String(good.reason)})` : ''}`),
    ).toBe(true);
    const bad = await deliver(secret, v1Delivery(secret, body, true));
    if (!bad.ok) return softSkip(bad.kind, `${bad.reason} — the acceptance was witnessed, the tamper control was not`);
    expect(
      bad.accepted,
      req('openwop.requirement.0176.v1-signed-webhook-accepted', 'spec/v2/core/webhooks.md §Verification', 'a receiver MUST verify before acting: the same delivery with a wrong X-openwop-Signature MUST be refused (a receiver that accepts everything is not verifying the v1 bytes)'),
    ).toBe(false);
  });
});
