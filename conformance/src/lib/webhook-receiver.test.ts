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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIGNATURE_PREFIX,
  receiverBinding,
  createReceiverState,
  verifyWebhookDelivery,
  signPayload,
  resolveRegistrationUrl,
  decodeWhsec,
  standardWebhooksSign,
  verifyStandardWebhooks,
  startModalReceiver,
  hitHeader,
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

/**
 * `receiverBinding()` — where a scenario's own webhook receiver listens and
 * what it advertises.
 *
 * Two levels of assertion here, deliberately. The first group pins the helper's
 * two branches. The second pins the three CALL SITES, because a helper that is
 * correct and unused is the exact defect this change fixes: before it existed,
 * `webhook-signed-delivery` and `replay-fanout-suppression` failed in a
 * container lane whose doubles were reachable, because they hard-coded
 * `127.0.0.1` in the two places that matter and never consulted the harness's
 * own advertise convention. A unit test on the helper alone would stay green
 * through a full revert of all three scenarios.
 */
describe('receiverBinding: loopback by default, operator-declared otherwise', () => {
  const KEY = 'OPENWOP_CONFORMANCE_HARNESS_HOST';
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('binds and advertises loopback when the variable is unset', () => {
    delete process.env[KEY];
    expect(receiverBinding()).toEqual({ bind: '127.0.0.1', advertise: '127.0.0.1' });
  });

  it('treats a blank or whitespace value as unset rather than binding 0.0.0.0 to an empty name', () => {
    process.env[KEY] = '   ';
    expect(receiverBinding()).toEqual({ bind: '127.0.0.1', advertise: '127.0.0.1' });
  });

  it('binds all interfaces and advertises the declared name when the variable is set', () => {
    process.env[KEY] = 'host.docker.internal';
    expect(receiverBinding()).toEqual({ bind: '0.0.0.0', advertise: 'host.docker.internal' });
  });
});

describe('receiverBinding: every scenario receiver actually uses it', () => {
  /**
   * The scenarios that stand up an HTTP receiver and hand the host a URL. Any
   * future one belongs here too — a receiver that hard-codes loopback is
   * unwitnessable off-process, and records a `fail` rather than a missing
   * precondition while being so.
   *
   * Since 2.37.0 most of them do not stand up their OWN listener: they take it
   * from `scoped-receiver.ts`, which binds through `receiverBinding()` and adds
   * a per-exercise nonce path, because on a tunnelled cut four of these files
   * registered one byte-identical destination. So the guard now asks each file
   * for one of the two shapes — its own `receiverBinding()` listener, or the
   * shared helper — and, either way, that no loopback literal survives. Naming
   * the helper as an accepted shape is not a loosening: `scoped-receiver.ts`
   * is itself checked below, and a file that used neither would still fail.
   */
  const RECEIVER_SCENARIOS = [
    'webhook-signed-delivery.test.ts',
    'replay-fanout-suppression.test.ts',
    'v2-webhook-durable-delivery.test.ts',
    // Added 2026-09-18. This guard's own comment says "any future one belongs
    // here too"; `v2-webhook-delivery-shape` landed at suite 2.3.1 and was not
    // added, and it then ignored the port pin for four releases.
    'v2-webhook-delivery-shape.test.ts',
    // Added 2026-09-23 with the same reasoning: it registers a subscription and
    // reads the delivery the host emits.
    'v2-bound-id-kinds.test.ts',
  ] as const;

  const here = dirname(fileURLToPath(import.meta.url));

  for (const name of RECEIVER_SCENARIOS) {
    it(`${name} reaches the host through receiverBinding(), not a literal`, () => {
      const src = readFileSync(join(here, '..', 'scenarios', name), 'utf8');
      const viaHelper = src.includes("from '../lib/scoped-receiver.js'") && src.includes('startScopedReceiver');
      if (!viaHelper) {
        expect(src).toContain('receiverBinding');
        expect(src).toMatch(/server\.listen\([^)]*binding\.bind/);
        expect(src).toContain('http://${binding.advertise}:');
      }
      // The literal must be gone from BOTH places, not just the one that is
      // easier to notice. A receiver that advertises the right name while
      // bound to loopback is still unreachable, and the failure looks
      // identical to the host refusing the delivery.
      expect(src).not.toMatch(/server\.listen\([^)]*'127\.0\.0\.1'/);
      expect(src).not.toContain('url: `http://127.0.0.1:');
    });
  }

  it('the shared receiver binds through receiverBinding() — the helper the scenarios now delegate to', () => {
    const src = readFileSync(join(here, 'scoped-receiver.ts'), 'utf8');
    expect(src).toContain('receiverBinding');
    expect(src).toMatch(/server\.listen\([^)]*binding\.bind/);
    expect(src).toContain('http://${binding.advertise}:');
    expect(src).not.toMatch(/server\.listen\([^)]*'127\.0\.0\.1'/);
  });

  it('no webhook scenario mints its destination with resolveRegistrationUrl — that is one identity for every exercise', () => {
    // The 2.37.0 regression, guarded at the source. `resolveRegistrationUrl`
    // returns `OPENWOP_WEBHOOK_RECEIVER_URL` UNCHANGED, so every file that
    // registered its result pointed at one byte-identical destination and so
    // shared one subscription identity — across files, and across time, because
    // a subscription outlives the leg that made it. A destination belongs to one
    // exercise: `startScopedReceiver().url` when the leg wants the delivery,
    // `unservedDestination()` when it only wants the mint.
    for (const name of RECEIVER_SCENARIOS) {
      const src = readFileSync(join(here, '..', 'scenarios', name), 'utf8');
      const line = src.split('\n').findIndex((l) => l.includes('resolveRegistrationUrl(')) + 1;
      expect(line, `${name}:${line} mints its destination with resolveRegistrationUrl, which returns the operator's front verbatim — use startScopedReceiver().url or unservedDestination()`).toBe(0);
    }
  });
});

describe('webhook-signed-delivery waits for a delivery rather than sleeping a guess', () => {
  /**
   * Pinned at the source, not by timing. The defect this replaced was a race:
   * a fixed `setTimeout(500)` against a host whose delivery worker polls every
   * 1000ms lost or won depending on where run completion fell inside that tick.
   * Two consecutive container runs measured 2026-09-09 disagreed — one reported
   * zero deliveries after 549ms, the next observed one after 318ms — so a
   * behavioural test for this would itself be a coin flip and could not be
   * trusted to go red on a revert. Pinning the instrument can.
   */
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'scenarios', 'webhook-signed-delivery.test.ts'), 'utf8');

  it('polls to a deadline instead of a single fixed grace period', () => {
    expect(src).toContain('DELIVERY_DEADLINE_MS');
    expect(src).toMatch(/while \(ours\(\)\.length === 0 && Date\.now\(\) < deadline\)/);
  });

  it('keeps the deadline inside the per-test budget alongside the terminal poll', () => {
    const deadline = Number(/const DELIVERY_DEADLINE_MS = ([0-9_]+);/.exec(src)?.[1]?.replace(/_/g, ''));
    const terminalPoll = Number(/pollUntilTerminal\(runId, \{ timeoutMs: ([0-9_]+) \}\)/.exec(src)?.[1]?.replace(/_/g, ''));
    expect(Number.isFinite(deadline)).toBe(true);
    expect(Number.isFinite(terminalPoll)).toBe(true);
    // vitest.config.ts testTimeout. Exceeding it turns an informative
    // requirement message into a bare timeout, which is the failure mode the
    // deadline exists to avoid.
    expect(deadline + terminalPoll).toBeLessThan(30_000);
  });

  it('still fails rather than skipping when nothing arrives', () => {
    // The deadline must feed an assertion, never a soft-skip: a host that
    // registers a subscription and then delivers nothing has a finding, not a
    // missing precondition. Scoped to the span BETWEEN the wait and the
    // assertion — the scenario legitimately soft-skips earlier on capability
    // and fixture advertisement, and a file-wide `softSkip` search would flag
    // those (it did, on the first draft of this case).
    const start = src.indexOf('const ourDeliveries = ours();');
    const end = src.indexOf('.toBeGreaterThan(0)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain('softSkip');
    expect(src.slice(start, end)).toContain('expect(ourDeliveries.length,');
  });
});

/**
 * RFC 0201 — the Standard Webhooks verifier is written from the spec recipe, so
 * it has to be pinned against something that is NOT this suite: the upstream
 * reference library's own `sign` test (standard-webhooks/standard-webhooks,
 * `libraries/javascript/src/webhook.test.ts`, "sign function works"; checked
 * 2026-09-22 against spec tag v1.0.0, identical on `main`). A verifier that
 * signed `ts.body`, used the whsec_ string as the key, or hex-encoded would
 * miss this vector.
 */
describe('RFC 0201 — Standard Webhooks 1.0.0 verifier (upstream test vector)', () => {
  const KEY = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const MSG_ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
  const TS = 1614265330;
  const PAYLOAD = '{"test": 2432232314}';
  const EXPECTED = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

  it('signs the upstream vector byte for byte', () => {
    expect(decodeWhsec(KEY)?.length).toBe(24);
    expect(standardWebhooksSign(KEY, MSG_ID, TS, PAYLOAD)).toBe(EXPECTED);
  });

  it('accepts the vector, and counts each matching entry of a space-separated list', () => {
    const headers = { 'webhook-id': MSG_ID, 'webhook-timestamp': String(TS), 'webhook-signature': `v1,AAAA ${EXPECTED} v1a,ZZZZ` };
    const v = verifyStandardWebhooks(PAYLOAD, headers, KEY, { nowSeconds: TS });
    expect(v.accepted).toBe(true);
    expect(v.entries.length).toBe(3);
    expect(v.matched).toBe(1);
  });

  it('refuses a signature over ts.body (the id is inside the signed bytes)', () => {
    const tsBody = `v1,${createHmac('sha256', decodeWhsec(KEY)!).update(`${TS}.${PAYLOAD}`).digest('base64')}`;
    const v = verifyStandardWebhooks(PAYLOAD, { 'webhook-id': MSG_ID, 'webhook-timestamp': String(TS), 'webhook-signature': tsBody }, KEY, { nowSeconds: TS });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('no_matching_signature');
  });

  it('refuses a key taken as the whsec_ string rather than its decoded bytes', () => {
    const wrongKey = `v1,${createHmac('sha256', KEY).update(`${MSG_ID}.${TS}.${PAYLOAD}`).digest('base64')}`;
    const v = verifyStandardWebhooks(PAYLOAD, { 'webhook-id': MSG_ID, 'webhook-timestamp': String(TS), 'webhook-signature': wrongKey }, KEY, { nowSeconds: TS });
    expect(v.accepted).toBe(false);
  });

  it('refuses a timestamp outside the five-minute tolerance, and an id containing a dot', () => {
    const headers = { 'webhook-id': MSG_ID, 'webhook-timestamp': String(TS), 'webhook-signature': EXPECTED };
    expect(verifyStandardWebhooks(PAYLOAD, headers, KEY, { nowSeconds: TS + 301 }).reason).toBe('timestamp_out_of_tolerance');
    expect(verifyStandardWebhooks(PAYLOAD, { ...headers, 'webhook-id': 'msg.x' }, KEY, { nowSeconds: TS }).reason).toBe('malformed_id');
  });

  it('decodes only whsec_ secrets of 24–64 bytes', () => {
    expect(decodeWhsec(`whsec_${Buffer.alloc(8).toString('base64')}`)).toBeNull();
    expect(decodeWhsec(`whsec_${Buffer.alloc(65).toString('base64')}`)).toBeNull();
    expect(decodeWhsec(Buffer.alloc(32).toString('base64'))).toBeNull();
    expect(decodeWhsec(`whsec_${Buffer.alloc(64).toString('base64')}`)?.length).toBe(64);
  });
});

describe('RFC 0201 — the modal receiver routes by path, so one tunnelled URL can carry every mode', () => {
  it('echoes, refuses to echo, echoes wrong, redirects, and fails twice per key, each by path', async () => {
    const r = await startModalReceiver();
    try {
      const post = (mode: string, body: unknown): Promise<Response> => fetch(r.urlFor(mode).url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'OpenWOP-Webhook-Id': 't/sub' }, body: JSON.stringify(body), redirect: 'manual' });
      const challenge = 'c'.repeat(22);
      const verify = { type: 'openwop.webhook.verification', challenge };
      expect(await (await post('echo', verify)).json()).toEqual({ challenge });
      expect(await (await post('no-echo', verify)).json()).toEqual({});
      expect(((await (await post('wrong-echo', verify)).json()) as { challenge: string }).challenge).not.toBe(challenge);
      const redirected = await post('redirect', verify);
      expect(redirected.status).toBe(307);
      expect(redirected.headers.get('location')).toContain(`/${r.nonce}/redirect-target`);
      const delivery = { runId: 't/run', event: { sequence: 3 } };
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await post('fail2', delivery)).status);
      expect(statuses).toEqual([500, 500, 204]);
      expect(r.hits.filter((h) => h.verification).map((h) => h.mode)).toEqual(['echo', 'no-echo', 'wrong-echo', 'redirect']);
      expect(hitHeader(r.hits[0]!, 'openwop-webhook-id')).toBe('t/sub');
    } finally {
      await r.close();
    }
  });
});
