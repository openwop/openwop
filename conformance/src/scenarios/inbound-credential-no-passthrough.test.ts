/**
 * RFC 0200 §E — a credential the host received inbound never leaves it (suite 2.36.0,
 * both majors; invariant `inbound-credential-no-passthrough`).
 *
 * A host that calls a webhook receiver, an MCP server or an A2A peer on a caller's behalf
 * is a confused deputy the moment it reuses the caller's own `Authorization`, `Cookie` or
 * `Proxy-Authorization` on the outbound request: the destination receives a credential
 * minted for the HOST, carrying the caller's full privilege, and can replay it back. MCP
 * states the same rule for its mounts ("the MCP server MUST NOT pass through the token it
 * received from the MCP client"); OpenWOP had only `trigger-bridge.md` §F.1, which covers
 * inbound headers into RUN DATA and says nothing about egress.
 *
 * **The witness is the suite's own credential.** The suite knows its API key, and it mints
 * two more canaries it sends on the run-creating request. Every outbound request the host
 * makes lands at a receiver the SUITE owns, so the comparison is against bytes the suite
 * controls end to end — not against the host's report of its own behaviour.
 *
 * One requirement id. The unaided leg is the webhook one; it is `blocked`, never a pass,
 * when no delivery is captured, because a hop that never happened leaks nothing.
 *
 * NOT witnessed, and deliberately: a credential the host re-derives or re-encodes, one
 * copied into a nested body field under a name the suite cannot guess, and a DPoP proof
 * (no committed host advertises a sender-constrained lane). The header and raw-body
 * canaries are the witnessed subset of a wider MUST — `SECURITY/invariants.yaml` and
 * `SECURITY/threat-model-secret-leakage.md` §6 say so too.
 *
 * How it FAILS (the sabotage run before citing the row):
 *   (a) the host copies the inbound Authorization onto the webhook delivery → the key is
 *       found in a captured header
 *   (b) the host forwards the inbound Cookie into the delivery body        → c1 is found
 *
 * @see spec/v1/auth.md §"Onward hops"; spec/v2/core/security-defaults.md §"Onward hops"
 * @see RFCS/0200-host-as-oauth-protected-resource.md §E
 * @see SECURITY/invariants.yaml id: inbound-credential-no-passthrough
 */

import { afterEach, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { targetMajor } from '../lib/seams.js';
import { startModalReceiver } from '../lib/webhook-receiver.js';
import { projectBoundId } from '../lib/bound-id.js';

const DOC = 'spec/v1/auth.md §"Onward hops"; spec/v2/core/security-defaults.md §"Onward hops" (RFC 0200 §E)';
const ID = 'openwop.requirement.0200.inbound-credential-no-passthrough';
const FIXTURE = 'conformance-noop';
const WAIT_MS = 15_000;

const webhooksPath = (suffix = ''): string => `${targetMajor() === 2 ? '' : '/v1'}/webhooks${suffix}`;
const runsPath = (suffix = ''): string => `${targetMajor() === 2 ? '' : '/v1'}/runs${suffix}`;

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { const c = cleanup; cleanup = null; await c(); }
});

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return pred();
}

describe('RFC 0200 §E — inbound-credential-no-passthrough (the caller\'s credential never leaves the host)', () => {
  it('no webhook delivery carries the caller\'s Authorization, Cookie or Proxy-Authorization', async () => {
    const env = loadEnv();
    const rx = await startModalReceiver();
    let subscriptionId: string | null = null;
    cleanup = async () => {
      if (subscriptionId !== null) { try { await driver.delete(webhooksPath(`/${projectBoundId(subscriptionId)}`)); } catch { /* best effort */ } }
      await rx.close();
    };
    const target = rx.urlFor('no-echo');
    const reg = await driver.post(webhooksPath(), { url: target.url, events: ['run.completed'] });
    if (reg.status === 404 || reg.status === 501) return softSkip('inapplicable', `this host serves no webhook registration (${reg.status}) — it makes no webhook hop for §E to cover`);
    if (reg.status !== 201) {
      return softSkip('blocked', `the subscription could not be registered (${reg.status}) — with no delivery there is no outbound request to inspect${target.tunnelled ? '' : '; set OPENWOP_WEBHOOK_RECEIVER_URL to a public https front if the host refuses the loopback receiver'}`);
    }
    subscriptionId = String((reg.json as { webhookId?: unknown } | null)?.webhookId ?? '') || null;

    // The three canaries, all sent on the run-creating request. The API key is the one the
    // suite itself authenticates with, so a host that forwards it is handing a receiver a
    // credential for this very host.
    const c1 = `c1-${randomBytes(16).toString('hex')}`;
    const c2 = Buffer.from(`canary:${randomBytes(16).toString('hex')}`).toString('base64');
    const created = await driver.post(runsPath(), { workflowId: FIXTURE }, {
      headers: { Cookie: `ow_canary=${c1}`, 'Proxy-Authorization': `Basic ${c2}` },
    });
    if (created.status !== 201) return softSkip('blocked', `could not start ${FIXTURE} (${created.status}) — no run, no delivery, nothing to inspect`);

    const delivered = await waitFor(() => rx.hits.some((h) => !h.verification), WAIT_MS);
    // A hop that never happened leaks nothing: this is `blocked`, not a pass.
    if (!delivered) return softSkip('blocked', `no delivery reached the suite-owned receiver within ${WAIT_MS}ms — an unmade hop cannot witness that a credential did not cross it`);

    const canaries: Array<[string, string]> = [['the suite\'s own API key', env.apiKey], ['the Cookie canary', c1], ['the Proxy-Authorization canary', c2]];
    const found: string[] = [];
    for (const hit of rx.hits) {
      const headerBytes = Object.entries(hit.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : String(v ?? '')}`).join('\n');
      for (const [label, value] of canaries) {
        if (value.length < 8) continue;
        if (headerBytes.includes(value)) found.push(`${label} in a request header of ${hit.method} ${hit.path}`);
        if (hit.body.includes(value)) found.push(`${label} in the delivery body of ${hit.method} ${hit.path}`);
      }
    }
    expect(
      found,
      req(ID, DOC, `a host MUST NOT attach a credential it received inbound to any outbound request — the suite's API key and two cookie/proxy canaries were sent on the run-creating request and MUST appear in no header or body captured at the suite-owned receiver (${rx.hits.length} capture(s) inspected)`),
    ).toEqual([]);
  }, 90_000);
});
