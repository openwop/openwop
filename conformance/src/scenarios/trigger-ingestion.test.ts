/**
 * External-event trigger ingestion (RFC 0099) — `trigger-bridge.md` §F.
 *
 * Verifies the additive external-event ingestion leg of the RFC 0083
 * durable-trigger bridge: the normalized in-run `TriggerEvent` envelope,
 * the `TriggerSubscriptionRegistration` create contract, and the two new
 * SECURITY invariants `trigger-ingestion-ssrf` +
 * `trigger-ingestion-content-redaction`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probes:
 *      - `trigger-event.schema.json` round-trips a conforming per-source
 *        `TriggerEvent` and enforces the §F.1 one-of rule (a
 *        `source:"email"` event carrying a `webhook` sub-object fails).
 *      - `AttachmentRef` requires a host-internal `ref` and rejects a raw
 *        external `url` field (the public test for `trigger-ingestion-ssrf`
 *        at the schema layer — the host never hands the run a fetchable URL).
 *      - `contentTrust` is the const `"untrusted"`.
 *      - the durable `trigger.delivery.attempted` payload carries ONLY the
 *        content-free `{subscriptionId,dedupKey,attempt,outcome}` shape (the
 *        public test for `trigger-ingestion-content-redaction` — the inbound
 *        body has no slot on the durable event).
 *      - `trigger-subscription-registration.schema.json` validates + requires
 *        `source` + `workflowId`.
 *
 *   B. Capability-gated behavioral leg (`triggerBridge.ingestion`, via the
 *      `POST /v1/host/sample/trigger-bridge/ingest` seam): a simulated
 *      external event starts a run whose `ctx.triggerData` matches the
 *      `TriggerEvent` shape and whose `trigger.delivery.attempted` is
 *      content-free; an ingestion-path fetch to a private address is refused
 *      (`trigger-ingestion-ssrf`); a `webhook.headers.Authorization`
 *      passthrough is stripped (`trigger-ingestion-content-redaction`).
 *      Soft-skips when the capability is unadvertised or the seam is unwired.
 *
 * @see spec/v1/trigger-bridge.md §F
 * @see SECURITY/invariants.yaml ids trigger-ingestion-ssrf, trigger-ingestion-content-redaction
 * @see RFCS/0099-external-event-trigger-ingestion.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

const EVENT_SCHEMA_PATH = join(SCHEMAS_DIR, 'trigger-event.schema.json');
const REG_SCHEMA_PATH = join(SCHEMAS_DIR, 'trigger-subscription-registration.schema.json');
const EVENT_FIXTURE = join(FIXTURES_DIR, 'trigger-events', 'trigger-event-email.json');
const REG_FIXTURE = join(FIXTURES_DIR, 'trigger-events', 'trigger-subscription-registration-email.json');

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // The registration schema $refs the trigger-subscription schema for
  // `retryPolicy`; register it so the absolute $ref resolves offline.
  for (const name of ['trigger-subscription.schema.json']) {
    ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')));
  }
  return ajv;
}

describe('trigger-ingestion: TriggerEvent schema (always-on, server-free)', () => {
  const ajv = buildAjv();
  const validate = ajv.compile(JSON.parse(readFileSync(EVENT_SCHEMA_PATH, 'utf8')));

  it('the canonical email TriggerEvent fixture validates', () => {
    const ev = JSON.parse(readFileSync(EVENT_FIXTURE, 'utf8'));
    expect(
      validate(ev),
      req('openwop.it.trigger-ingestion.the-canonical-email-triggerevent-fixture-validates', 'RFC 0099', `trigger-event.schema.json MUST accept a conforming email TriggerEvent. Errors: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('the §F.1 one-of rule holds — a source:"email" event carrying a webhook sub-object fails', () => {
    const ev = JSON.parse(readFileSync(EVENT_FIXTURE, 'utf8'));
    ev.webhook = { method: 'POST', body: { x: 1 } };
    expect(
      validate(ev),
      req('openwop.it.trigger-ingestion.the-f-1-one-of-rule-holds-a-source-email-event-carrying-a-webhook-sub-object-fai', 'RFC 0099', 'trigger-bridge.md §F.1 — a TriggerEvent MUST carry exactly the per-source sub-object matching its `source` and MUST NOT carry the others'),
    ).toBe(false);
  });

  it('contentTrust MUST be the const "untrusted"', () => {
    const ev = JSON.parse(readFileSync(EVENT_FIXTURE, 'utf8'));
    ev.contentTrust = 'trusted';
    expect(
      validate(ev),
      req('openwop.it.trigger-ingestion.contenttrust-must-be-the-const-untrusted', 'RFC 0099', 'trigger-bridge.md §F.1 — `contentTrust` MUST be `"untrusted"`'),
    ).toBe(false);
  });

  it('AttachmentRef requires a host-internal `ref` and rejects a raw external `url` (trigger-ingestion-ssrf)', () => {
    // Missing ref → invalid.
    const noRef = JSON.parse(readFileSync(EVENT_FIXTURE, 'utf8'));
    noRef.email.attachments = [{ filename: 'x.png' }];
    expect(
      validate(noRef),
      req('openwop.it.trigger-ingestion.attachmentref-requires-a-host-internal-ref-and-rejects-a-raw-external-url-trigge', 'RFC 0099', 'SECURITY invariant trigger-ingestion-ssrf — an AttachmentRef MUST carry a host-internal `ref`'),
    ).toBe(false);

    // A raw external `url` the run would fetch itself → invalid
    // (additionalProperties:false structurally forbids it).
    const rawUrl = JSON.parse(readFileSync(EVENT_FIXTURE, 'utf8'));
    rawUrl.email.attachments = [{ ref: 'blob_a1', url: 'http://169.254.169.254/latest/meta-data/' }];
    expect(
      validate(rawUrl),
      req('openwop.it.trigger-ingestion.attachmentref-requires-a-host-internal-ref-and-rejects-a-raw-external-url-trigge', 'RFC 0099', 'SECURITY invariant trigger-ingestion-ssrf — the host MUST NOT hand the run an external URL to fetch itself; AttachmentRef is a host-internal handle only'),
    ).toBe(false);
  });

  it('a webhook TriggerEvent with an allowlisted header validates', () => {
    const ev = {
      source: 'webhook',
      subscriptionId: 'sub_9',
      deliveryId: 'dlv_c3d4',
      receivedAt: '2026-06-13T18:10:00Z',
      verified: true,
      contentTrust: 'untrusted',
      webhook: { method: 'POST', headers: { 'X-Event-Type': 'issue.created' }, body: { issue: { id: 42 } } },
    };
    expect(
      validate(ev),
      req('openwop.it.trigger-ingestion.a-webhook-triggerevent-with-an-allowlisted-header-validates', 'RFC 0099', `a conforming webhook TriggerEvent MUST validate. Errors: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });
});

describe('trigger-ingestion: content-freeness of the durable trigger.delivery.attempted payload (trigger-ingestion-content-redaction)', () => {
  // The public, schema-layer proof for `trigger-ingestion-content-redaction`:
  // the durable event payload defines ONLY content-free fields. The inbound
  // body/headers/email/form content has NO slot — it lives only in the in-run
  // TriggerEvent (`ctx.triggerData`), never on the event log.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const payloads = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'run-event-payloads.schema.json'), 'utf8'));
  const deliveryDef = payloads.$defs?.triggerDeliveryAttempted;

  it('trigger.delivery.attempted declares only the content-free RFC 0083 §C fields', () => {
    expect(deliveryDef, req('openwop.it.trigger-ingestion.trigger-delivery-attempted-declares-only-the-content-free-rfc-0083-c-fields', 'RFC 0083 §C', 'run-event-payloads.schema.json MUST define triggerDeliveryAttempted')).toBeDefined();
    const props = Object.keys(deliveryDef.properties ?? {});
    // The complete content-free field set — no `body`, `headers`, `email`,
    // `form`, `fields`, or any inbound-content carrier.
    expect(props.sort()).toEqual(['attempt', 'dedupKey', 'outcome', 'runId', 'subscriptionId'].sort());
    for (const banned of ['body', 'headers', 'email', 'form', 'fields', 'html', 'text', 'subject']) {
      expect(
        props.includes(banned),
        req('openwop.it.trigger-ingestion.trigger-delivery-attempted-declares-only-the-content-free-rfc-0083-c-fields', 'RFC 0083 §C', `trigger-ingestion-content-redaction — the durable trigger.delivery.attempted payload MUST NOT carry an inbound-content field ("${banned}")`),
      ).toBe(false);
    }
  });
});

describe('trigger-ingestion: TriggerSubscriptionRegistration schema (always-on, server-free)', () => {
  const ajv = buildAjv();
  const validate = ajv.compile(JSON.parse(readFileSync(REG_SCHEMA_PATH, 'utf8')));

  it('the canonical registration fixture validates', () => {
    const reg = JSON.parse(readFileSync(REG_FIXTURE, 'utf8'));
    expect(
      validate(reg),
      req('openwop.it.trigger-ingestion.the-canonical-registration-fixture-validates', 'RFC 0099', `trigger-subscription-registration.schema.json MUST accept a conforming registration. Errors: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('requires source + workflowId and rejects an out-of-enum source', () => {
    expect(validate({ workflowId: 'w' }), req('openwop.it.trigger-ingestion.requires-source-workflowid-and-rejects-an-out-of-enum-source', 'RFC 0099', 'registration MUST require `source`')).toBe(false);
    expect(validate({ source: 'email' }), req('openwop.it.trigger-ingestion.requires-source-workflowid-and-rejects-an-out-of-enum-source', 'RFC 0099', 'registration MUST require `workflowId`')).toBe(false);
    expect(
      validate({ source: 'schedule', workflowId: 'w' }),
      req('openwop.it.trigger-ingestion.requires-source-workflowid-and-rejects-an-out-of-enum-source', 'RFC 0099', 'registration `source` MUST be one of webhook/email/form (schedule is not externally registerable)'),
    ).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('trigger-ingestion: behavioral ingestion + SSRF (capability-gated)', () => {
  it('an ingestion-path fetch to a private address is refused; a delivered event is content-free', async () => {
    const tb = await readCapabilityFamily<{ ingestion?: { externalSources?: string[] } }>('triggerBridge');
    const ingests = Array.isArray(tb?.ingestion?.externalSources) && tb!.ingestion!.externalSources!.length > 0;
    if (!behaviorGate('triggerBridge.ingestion', ingests)) return;

    // SSRF leg — an attachment whose resolution would hit a private address
    // MUST be refused by the host's safeFetch guard (trigger-ingestion-ssrf).
    const ssrf = await driver.post('/v1/host/sample/trigger-bridge/ingest', {
      source: 'email',
      verification: { mode: 'none' },
      attachmentUrl: 'http://169.254.169.254/latest/meta-data/',
    });
    if (ssrf.status === 404 || ssrf.status === 403) return softSkip('blocked', 'precondition not met — `ssrf.status === 404 || ssrf.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const ssrfBody = ssrf.json as { triggerEvent?: { email?: { attachments?: unknown[] } }; ssrfRefused?: boolean } | undefined;
    expect(
      ssrfBody?.ssrfRefused === true ||
        (ssrfBody?.triggerEvent?.email?.attachments ?? []).length === 0,
      req('openwop.it.trigger-ingestion.an-ingestion-path-fetch-to-a-private-address-is-refused-a-delivered-event-is-con', 
        'trigger-bridge.md §F.4',
        'trigger-ingestion-ssrf — an ingestion-path fetch to a private address MUST be refused (attachment dropped), the run still starting on the rest of the event',
      ),
    ).toBe(true);

    // Content-redaction leg — the durable trigger.delivery.attempted MUST be
    // content-free even when the inbound carried a credential-bearing header.
    const del = await driver.post('/v1/host/sample/trigger-bridge/ingest', {
      source: 'webhook',
      verification: { mode: 'none' },
      webhook: { method: 'POST', headers: { Authorization: 'Bearer canary' }, body: { x: 1 } },
    });
    if (del.status === 404 || del.status === 403) return softSkip('blocked', 'precondition not met — `del.status === 404 || del.status === 403` returned early (seam, prior step, or fixture unavailable)');
    const delBody = del.json as
      | { deliveryEvent?: Record<string, unknown>; triggerEvent?: { webhook?: { headers?: Record<string, string> } } }
      | undefined;
    const evtJson = JSON.stringify(delBody?.deliveryEvent ?? {});
    expect(
      evtJson.includes('Bearer canary') === false && evtJson.includes('Authorization') === false,
      req('openwop.it.trigger-ingestion.an-ingestion-path-fetch-to-a-private-address-is-refused-a-delivered-event-is-con', 
        'trigger-bridge.md §F.4',
        'trigger-ingestion-content-redaction — the durable trigger.delivery.attempted MUST NOT carry inbound body/header content',
      ),
    ).toBe(true);
    const passedHeaders = delBody?.triggerEvent?.webhook?.headers ?? {};
    expect(
      Object.keys(passedHeaders).every((k) => k.toLowerCase() !== 'authorization'),
      req('openwop.it.trigger-ingestion.an-ingestion-path-fetch-to-a-private-address-is-refused-a-delivered-event-is-con', 
        'trigger-bridge.md §F.1',
        'webhook.headers MUST be a host-curated allowlist — Authorization MUST NOT pass through',
      ),
    ).toBe(true);
  });
});
