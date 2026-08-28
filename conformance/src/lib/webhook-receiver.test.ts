/**
 * Unit tests for `webhook-receiver.ts` — the signature-header contract.
 *
 * This verifier is the reference a subscriber implementer copies. It required
 * `v1=` and therefore rejected, as malformed, the exact header `webhooks.md`
 * §"Delivery headers" mandates (`X-openwop-Signature: sha256={hex}`). The
 * divergence survived because `webhook-receiver-adversarial.test.ts` signs with
 * `signPayload` and verifies with `verifyWebhookDelivery` — a closed loop that is
 * self-consistent and wrong, and so green against every host. These cases pin the
 * header against the SPEC rather than against the suite's own output.
 *
 * @see webhook-receiver.ts, spec/v1/webhooks.md §"Delivery headers"
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  SIGNATURE_PREFIX,
  createReceiverState,
  verifyWebhookDelivery,
  signPayload,
  resolveRegistrationUrl,
} from './webhook-receiver.js';

const SECRET = 'shhh-not-a-real-secret';
const BODY = JSON.stringify({ event: { type: 'run.completed' } });

/** Build the header exactly as `webhooks.md` documents it, not as we emit it. */
function specShapedHeader(ts: number): string {
  const hex = createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex');
  return `sha256=${hex}`;
}

describe('webhook-receiver: the X-openwop-Signature prefix follows the spec', () => {
  it('the constant is the spec value, not the algorithm-header value', () => {
    // `v1` names the SIGNING SCHEME (X-openwop-Signature-Algorithm). It is not
    // the encoding prefix. One value, two fields — the conflation this fixes.
    expect(SIGNATURE_PREFIX).toBe('sha256=');
  });

  it('ACCEPTS a header built to the spec by hand, with no help from signPayload', () => {
    const ts = Math.floor(Date.now() / 1000);
    const result = verifyWebhookDelivery(
      SECRET,
      specShapedHeader(ts),
      'v1',
      String(ts),
      BODY,
      createReceiverState(),
    );
    expect(result.accepted).toBe(true);
  });

  it('REJECTS the pre-2026-08-19 `v1=` prefix as malformed — the shape the spec never defined', () => {
    const ts = Math.floor(Date.now() / 1000);
    const hex = createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex');
    const result = verifyWebhookDelivery(
      SECRET,
      `v1=${hex}`,
      'v1',
      String(ts),
      BODY,
      createReceiverState(),
    );
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toBe('malformed_signature_header');
  });

  it('signPayload emits what the verifier accepts AND what the spec documents', () => {
    const ts = Math.floor(Date.now() / 1000);
    const { signatureHeader, algorithmHeader } = signPayload(SECRET, ts, BODY);
    // Both halves matter: agreeing with the verifier alone is the closed loop
    // that hid the bug, so this also compares against the hand-built header.
    expect(signatureHeader).toBe(specShapedHeader(ts));
    expect(algorithmHeader).toBe('v1');
  });
});

/**
 * `OPENWOP_WEBHOOK_RECEIVER_URL` validation.
 *
 * Each case names the gate it is about, taken from `webhooks.md`, rather than
 * restating the implementation: the point of the variable is to clear all three
 * SSRF gates honestly, so a value that cannot clear one of them is an operator
 * error the suite must refuse LOUDLY. A skip here would hide a
 * misconfiguration behind a disposition that reads as "the host could not be
 * exercised", which is a claim about the host and would be false.
 */
describe('resolveRegistrationUrl — OPENWOP_WEBHOOK_RECEIVER_URL', () => {
  const LOCAL = 'http://127.0.0.1:54321/';
  const saved = process.env.OPENWOP_WEBHOOK_RECEIVER_URL;
  const set = (v: string | undefined) => {
    if (v === undefined) delete process.env.OPENWOP_WEBHOOK_RECEIVER_URL;
    else process.env.OPENWOP_WEBHOOK_RECEIVER_URL = v;
  };
  afterEach(() => set(saved));

  it('unset ⇒ registers the local receiver unchanged, not tunnelled', () => {
    set(undefined);
    expect(resolveRegistrationUrl(LOCAL)).toEqual({ url: LOCAL, tunnelled: false });
  });

  it('whitespace-only is treated as unset rather than as a malformed URL', () => {
    set('   ');
    expect(resolveRegistrationUrl(LOCAL)).toEqual({ url: LOCAL, tunnelled: false });
  });

  it('a public https front is used for registration and marked tunnelled', () => {
    set('https://tunnel.example.com/hook');
    expect(resolveRegistrationUrl(LOCAL)).toEqual({
      url: 'https://tunnel.example.com/hook',
      tunnelled: true,
    });
  });

  it('rejects http: — cannot clear gate 1 (webhooks.md §"Register": url MUST be https)', () => {
    set('http://tunnel.example.com/hook');
    expect(() => resolveRegistrationUrl(LOCAL)).toThrow(/MUST be https/i);
  });

  it.each([
    ['loopback name', 'https://localhost/hook'],
    ['loopback v4', 'https://127.0.0.1/hook'],
    ['RFC1918 10/8', 'https://10.1.2.3/hook'],
    ['RFC1918 192.168/16', 'https://192.168.1.9/hook'],
    ['RFC1918 172.16/12', 'https://172.20.0.5/hook'],
    ['link-local', 'https://169.254.169.254/hook'],
  ])('rejects %s — cannot clear gate 2 (registration-time address check)', (_label, url) => {
    set(url);
    expect(() => resolveRegistrationUrl(LOCAL)).toThrow(/publicly-resolvable/i);
  });

  it('rejects a value that is not a URL at all', () => {
    set('not a url');
    expect(() => resolveRegistrationUrl(LOCAL)).toThrow(/not a valid URL/i);
  });

  it('does not reject a public host that merely LOOKS private (172.32 is public)', () => {
    // 172.16.0.0/12 ends at 172.31.255.255. A naive /^172\./ check would
    // reject this and send an operator hunting a nonexistent misconfiguration.
    set('https://172.32.0.1/hook');
    expect(resolveRegistrationUrl(LOCAL).tunnelled).toBe(true);
  });
});
