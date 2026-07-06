/**
 * Streaming & CDC trigger sources (RFC 0127) — `trigger-bridge.md` §F.5.
 *
 * Verifies the two additive externally-originated sources — `stream` (a
 * message consumed from a Kafka/Kinesis/Pub-Sub broker) and `change` (a
 * warehouse/DB change-data-capture record) — layered on the RFC 0083/0099
 * bridge with the envelope / SSRF posture / content-free `trigger.*` events /
 * §C-1 dedup floor reused verbatim.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probes:
 *      - the canonical `stream` + `change` TriggerEvent fixtures validate;
 *      - a `change` event WITHOUT `op` fails (`ChangeEvent` requires it —
 *        RFC 0127 §2, schema-enforced);
 *      - an out-of-enum `op` fails;
 *      - the §F.1 exactly-one rule extends to the new sources (a
 *        `source:"stream"` event carrying a `change` sub-object fails);
 *      - a registration accepts `source:"stream"` / `source:"change"`;
 *      - the capabilities enums (`triggerBridge.sources[]` +
 *        `ingestion.externalSources[]`) include both values (regression pin).
 *
 *   B. Capability-gated behavioral legs (soft-skip pre-implementation;
 *      REQUIRED once `ingestion.externalSources[]` advertises the source —
 *      advertise-only-what-you-honor, RFC 0127 §Negative example):
 *      - `POST /v1/host/sample/trigger-bridge/ingest` with a `stream` /
 *        `change` body → a run starts, the delivered `ctx.triggerData`
 *        matches `trigger-event.schema.json`, and the durable
 *        `trigger.delivery.attempted` is content-free (SR-1: no
 *        message/row body);
 *      - `POST /v1/host/sample/trigger-bridge/deliver` `{scenario:"dedup",
 *        source:"stream"}` → the same broker-coordinate dedup key delivered
 *        twice is effectively-once (§C-1 floor, `(topic,partition,offset)`
 *        keying).
 *
 * @see spec/v1/trigger-bridge.md §F.5
 * @see RFCS/0127-streaming-and-cdc-trigger-sources.md
 * @see RFCS/0099-external-event-trigger-ingestion.md (§F envelope, reused)
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
import { driveDelivery } from '../lib/triggerBridge.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

const STREAM_FIXTURE = join(FIXTURES_DIR, 'trigger-events', 'trigger-event-stream.json');
const CHANGE_FIXTURE = join(FIXTURES_DIR, 'trigger-events', 'trigger-event-change.json');

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const name of ['trigger-subscription.schema.json']) {
    ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')));
  }
  return ajv;
}

describe('trigger-stream-cdc: TriggerEvent schema for stream/change (always-on, server-free)', () => {
  const ajv = buildAjv();
  const validate = ajv.compile(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'trigger-event.schema.json'), 'utf8')));

  it('the canonical stream TriggerEvent fixture validates', () => {
    const ev = JSON.parse(readFileSync(STREAM_FIXTURE, 'utf8'));
    expect(
      validate(ev),
      `trigger-event.schema.json MUST accept a conforming stream TriggerEvent (RFC 0127 §2). Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('the canonical change TriggerEvent fixture validates (op + permittedPurposes present)', () => {
    const ev = JSON.parse(readFileSync(CHANGE_FIXTURE, 'utf8'));
    expect(
      validate(ev),
      `trigger-event.schema.json MUST accept a conforming change TriggerEvent (RFC 0127 §2 / RFC 0128 §1). Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('a change event WITHOUT op fails — ChangeEvent requires the operation discriminator', () => {
    const ev = JSON.parse(readFileSync(CHANGE_FIXTURE, 'utf8'));
    delete ev.change.op;
    expect(
      validate(ev),
      'RFC 0127 §2 — `op` (insert|update|delete) is REQUIRED on a change event (schema-enforced in the ChangeEvent $def)',
    ).toBe(false);
  });

  it('an out-of-enum op fails', () => {
    const ev = JSON.parse(readFileSync(CHANGE_FIXTURE, 'utf8'));
    ev.change.op = 'upsert';
    expect(
      validate(ev),
      'RFC 0127 §2 — `op` MUST be one of insert|update|delete',
    ).toBe(false);
  });

  it('the §F.1 exactly-one rule extends — a source:"stream" event carrying a change sub-object fails', () => {
    const ev = JSON.parse(readFileSync(STREAM_FIXTURE, 'utf8'));
    ev.change = { op: 'insert', table: 't' };
    expect(
      validate(ev),
      'trigger-bridge.md §F.1 — a TriggerEvent MUST carry exactly the per-source sub-object matching its `source` and MUST NOT carry the others (extends to stream/change per RFC 0127)',
    ).toBe(false);
  });
});

describe('trigger-stream-cdc: registration + capabilities vocabulary (always-on, server-free)', () => {
  const ajv = buildAjv();
  const validateReg = ajv.compile(
    JSON.parse(readFileSync(join(SCHEMAS_DIR, 'trigger-subscription-registration.schema.json'), 'utf8')),
  );

  it('a registration accepts source:"stream" and source:"change"', () => {
    for (const source of ['stream', 'change']) {
      expect(
        validateReg({ source, workflowId: 'wf_1' }),
        `trigger-subscription-registration.schema.json MUST accept source:"${source}" (RFC 0127 §1). Errors: ${JSON.stringify(validateReg.errors)}`,
      ).toBe(true);
    }
  });

  it('the capabilities source enums include stream + change (regression pin)', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8'));
    const tb = caps.properties?.triggerBridge?.properties ?? {};
    const sources: string[] = tb.sources?.items?.enum ?? [];
    const external: string[] = tb.ingestion?.properties?.externalSources?.items?.enum ?? [];
    for (const v of ['stream', 'change']) {
      expect(sources.includes(v), `RFC 0127 §1 — triggerBridge.sources[] enum MUST include "${v}"`).toBe(true);
      expect(external.includes(v), `RFC 0127 §3 — ingestion.externalSources[] enum MUST include "${v}"`).toBe(true);
    }
  });
});

describe.skipIf(HTTP_SKIP)('trigger-stream-cdc: behavioral ingestion + dedup (capability-gated)', () => {
  it('a stream and a change event each ingest to a run with a schema-valid envelope and a content-free delivery event', async () => {
    const tb = await readCapabilityFamily<{ ingestion?: { externalSources?: string[] } }>('triggerBridge');
    const external = tb?.ingestion?.externalSources ?? [];
    const advertisesNew = external.includes('stream') || external.includes('change');
    // Gate on the RFC 0099 ingestion surface existing at all; the new-source
    // legs soft-skip on a pre-RFC-0127 host. Once the host ADVERTISES
    // stream/change, a soft-skip is forbidden (advertise-only-what-you-honor).
    if (!behaviorGate('triggerBridge.ingestion', (external.length ?? 0) > 0)) return;

    const ajv = buildAjv();
    const validate = ajv.compile(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'trigger-event.schema.json'), 'utf8')));

    const bodies: Record<string, unknown>[] = [
      {
        source: 'stream',
        verification: { mode: 'none' },
        stream: { topic: 'events', partition: 3, offset: '88412', key: 'user_77', message: { type: 'page_view', secretMarker: 'CANARY-STREAM-BODY' } },
      },
      {
        source: 'change',
        verification: { mode: 'none' },
        change: { op: 'update', table: 'contacts', changelogId: '0/1C4F9D0', after: { id: 77, secretMarker: 'CANARY-CHANGE-BODY' } },
      },
    ];

    for (const body of bodies) {
      const res = await driver.post('/v1/host/sample/trigger-bridge/ingest', body);
      if ((res.status === 404 || res.status === 405 || res.status === 400 || res.status === 422) && !advertisesNew) continue; // pre-0127 host — soft-skip this source
      expect(
        res.status < 400,
        driver.describe(
          'trigger-bridge.md §F.5',
          `a host advertising ingestion of "${body.source as string}" MUST ingest it (advertise-only-what-you-honor, RFC 0127 §Negative example) — got HTTP ${res.status}`,
        ),
      ).toBe(true);

      const out = res.json as { triggerEvent?: Record<string, unknown>; deliveryEvent?: Record<string, unknown> } | undefined;
      expect(
        validate(out?.triggerEvent),
        driver.describe(
          'trigger-bridge.md §F.5',
          `the delivered ${body.source as string} envelope MUST validate against trigger-event.schema.json. Errors: ${JSON.stringify(validate.errors)}`,
        ),
      ).toBe(true);

      // SR-1 — the durable delivery event MUST NOT carry the message/row body.
      const durable = JSON.stringify(out?.deliveryEvent ?? {});
      expect(
        !durable.includes('CANARY-STREAM-BODY') && !durable.includes('CANARY-CHANGE-BODY'),
        driver.describe(
          'trigger-bridge.md §F.5 (SR-1)',
          'the durable trigger.delivery.attempted MUST be content-free — the broker message / CDC row body has no slot on the event log',
        ),
      ).toBe(true);
    }
  });

  it('stream dedup — the same broker coordinates delivered twice are effectively-once (§C-1 floor)', async () => {
    const tb = await readCapabilityFamily<{ ingestion?: { externalSources?: string[] } }>('triggerBridge');
    const external = tb?.ingestion?.externalSources ?? [];
    if (!behaviorGate('triggerBridge.ingestion', (external.length ?? 0) > 0)) return;

    const first = await driveDelivery({ scenario: 'dedup', dedupKey: 'events:3:99001', source: 'stream' });
    if (first === null) return; // delivery seam unwired — soft-skip
    if (first.outcome === undefined && !external.includes('stream')) return; // pre-0127 host — soft-skip
    expect(
      first.deliveredCount === 1 || first.outcome === 'delivered',
      driver.describe(
        'trigger-bridge.md §F.5 / §C-1',
        'a stream event dedup-keyed on (topic,partition,offset) redelivered within the window MUST be effectively-once — reuses the RFC 0083 §C-1 ≥24h floor unchanged',
      ),
    ).toBe(true);
  });
});
