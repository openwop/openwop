/**
 * RFC 0201 §D — endpoint verification, for opted-in registrations only (suite
 * 2.36.0, target major 2; gated on `webhooks.signatureAlgorithms` listing
 * `standard-webhooks-1`).
 *
 * Before it answers `201` to a registration that lists `standard-webhooks-1`,
 * the host sends ONE signed verification request and refuses the registration
 * `400 webhook_endpoint_unverified`, persisting nothing, unless a `2xx` arrives
 * within 10 s whose JSON `challenge` equals the one sent. The receiver is the
 * suite's modal receiver, one path per behaviour:
 *
 *   no-echo     200 `{}`                         → MUST be refused
 *   wrong-echo  200 `{ challenge: <other> }`     → MUST be refused
 *   redirect    307 to redirect-target (echoes)  → MUST be refused; the target MUST see nothing
 *   echo        200 `{ challenge }`              → MUST answer 201
 *
 * Each verification request is checked against
 * `schemas/v2/webhook-verification.schema.json`, verified with the supplied
 * secret by the suite's Standard Webhooks verifier, and MUST carry no
 * `OpenWOP-Event-Type` (it is not a delivery). A host MUST NOT retry it, so each
 * refused path sees exactly one.
 *
 * "Persisting nothing" is checked on the wire, not by reading the host: after
 * the refusals, one run is driven and the echo subscription's delivery is the
 * sync point — by the time it lands, a refused path that had been persisted
 * would have received the same event. That catches "201 then verify later"
 * and "400 but keep the row".
 *
 * How it FAILS: a host that answers 201 without verifying (no-echo is 201); a
 * host that follows the 307 (the target sees a hit); a host that verifies
 * afterwards (a refused path receives a delivery); a host that retries the
 * verification (two requests on one path).
 *
 * @see spec/v2/core/webhooks.md §Standard Webhooks
 * @see RFCS/0201-standard-webhooks-signature-scheme.md §D
 */

import { afterEach, describe, it, expect } from 'vitest';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { v2Validator } from '../lib/v2.js';
import { hitHeader, mintWhsec, startModalReceiver, verifyStandardWebhooks } from '../lib/webhook-receiver.js';
import {
  STANDARD_WEBHOOKS_ALG,
  deliveriesFor,
  driveRun,
  loopbackRefusal,
  registerSw,
  swGate,
  unregisterAllSw,
  waitFor,
} from '../lib/standard-webhooks.js';

const REFUSED = ['no-echo', 'wrong-echo', 'redirect'] as const;

let closeReceiver: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unregisterAllSw();
  if (closeReceiver) { const c = closeReceiver; closeReceiver = null; await c(); }
});

describe('RFC 0201 §D — endpoint verification refuses without consent (opted-in registrations only)', () => {
  it('no-echo, wrong-echo and a redirect are refused and persist nothing; an echo is accepted', async () => {
    const g = await swGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const rx = await startModalReceiver();
    closeReceiver = rx.close;
    const secret = mintWhsec();
    const body = (mode: string): Record<string, unknown> => ({ url: rx.urlFor(mode).url, events: ['run.completed'], signatureAlgorithms: ['v1', STANDARD_WEBHOOKS_ALG], secret });
    const tunnelled = rx.urlFor('echo').tunnelled;

    // Register the echo subscription first: its 201 is the positive control, and
    // a loopback refusal here is `blocked` before anything is asserted.
    const ok = await registerSw(body('echo'));
    const blocked = loopbackRefusal(ok, tunnelled);
    if (blocked) return softSkip('blocked', blocked);
    const refused = new Map<string, { status: number; code: string | undefined; id: unknown }>();
    for (const mode of REFUSED) {
      const res = await registerSw(body(mode));
      refused.set(mode, { status: res.status, code: readErrorCode(res.json), id: (res.json as { webhookId?: unknown } | null)?.webhookId });
    }

    const ID = 'openwop.requirement.0201.endpoint-verification';
    expect(ok.status, req(ID, 'RFC 0201 §D.14', `an endpoint that echoes the challenge MUST be registered 201 (got ${ok.status} ${readErrorCode(ok.json) ?? ''})`)).toBe(201);
    const echoId = (ok.json as { webhookId: string }).webhookId;
    for (const [mode, r] of refused) {
      expect(r.status, req(ID, 'RFC 0201 §D.14', `a ${mode} endpoint MUST be refused 400 before any 201 (got ${r.status})`)).toBe(400);
      expect(r.code, req(ID, 'RFC 0201 §D.14', `a ${mode} refusal MUST carry webhook_endpoint_unverified`)).toBe('webhook_endpoint_unverified');
    }

    const validate = v2Validator('webhook-verification');
    for (const mode of ['echo', ...REFUSED]) {
      const vr = rx.hits.filter((h) => h.mode === mode && h.verification);
      expect(vr.length, req(ID, 'RFC 0201 §D.13–§D.14', `the host MUST send exactly one verification request to the ${mode} endpoint and MUST NOT retry it (saw ${vr.length})`)).toBe(1);
      const h = vr[0]!;
      expect(h.method, req(ID, 'RFC 0201 §D.13', 'the verification request MUST be a POST')).toBe('POST');
      const parsed = JSON.parse(h.body) as unknown;
      const v = validate(parsed);
      expect(v.ok, req(ID, 'RFC 0201 §D.13', `the verification body MUST validate against webhook-verification.schema.json (${v.errors})`)).toBe(true);
      expect(hitHeader(h, 'openwop-event-type'), req(ID, 'RFC 0201 §D.13', 'the verification request is not a delivery and MUST carry no OpenWOP-Event-Type')).toBeUndefined();
      const verdict = verifyStandardWebhooks(h.body, h.headers, secret);
      expect(verdict.matched, req(ID, 'RFC 0201 §D.13', `the verification request MUST be signed as §C.9 with the supplied secret (verifier: ${verdict.reason ?? 'ok'})`)).toBeGreaterThan(0);
    }
    const challenges = rx.hits.filter((h) => h.verification).map((h) => (JSON.parse(h.body) as { challenge: string }).challenge);
    expect(new Set(challenges).size, req(ID, 'RFC 0201 §D.13', 'each verification MUST carry a FRESH challenge')).toBe(challenges.length);
    expect(
      rx.hits.filter((h) => h.mode === 'redirect-target').length,
      req(ID, 'RFC 0201 §D.13', 'the verification request MUST NOT follow a redirect — the 307 target MUST see nothing'),
    ).toBe(0);

    // Persisted nothing: drive a run and wait for the echo subscription's
    // delivery; by then any persisted refused subscription would have one too.
    const run = await driveRun();
    expect(run.status, req(ID, 'runs.md §Create', 'POST /runs MUST answer 201 for the noop fixture')).toBe(201);
    await waitFor(() => deliveriesFor(rx.hits, echoId, run.runId).length > 0, 15_000);
    expect(deliveriesFor(rx.hits, echoId, run.runId).length, req(ID, 'webhooks.md §Durability', 'the verified subscription MUST receive run.completed — the sync point for the persisted-nothing check')).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1_000));
    for (const mode of REFUSED) {
      const late = rx.hits.filter((h) => h.mode === mode && !h.verification);
      expect(late.length, req(ID, 'RFC 0201 §D.14', `a refused (${mode}) registration MUST persist no subscription — it received ${late.length} later request(s)`)).toBe(0);
    }
  }, 60_000);
});
