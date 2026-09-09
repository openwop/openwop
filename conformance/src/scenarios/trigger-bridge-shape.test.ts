/**
 * Durable trigger + channel bridge — subscription + events + profile shapes (RFC 0083).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `trigger-subscription.schema.json` round-trips a conforming
 *     `TriggerSubscription` and rejects the malformed (missing REQUIRED `state`;
 *     an out-of-enum `source`; an unknown property under
 *     `additionalProperties:false`).
 *   - the four-state vocabulary (`active`/`paused`/`failed`/`dead-lettered`) is
 *     stable on the subscription `state` + the event `fromState`/`toState`.
 *   - the `trigger.subscription.state.changed` + `trigger.delivery.attempted`
 *     payload $defs validate conforming content-free records and reject malformed
 *     ones (a missing `outcome`; an out-of-enum `outcome`), and both event names
 *     appear in the RunEventType enum.
 *   - `capabilities.triggerBridge` (+ `webhooks.durable`) is declared.
 *   - `deriveProfiles` surfaces `openwop-trigger-bridge` for a host advertising
 *     the bridge + a dead-letter sink + a durable source, and withholds it when
 *     the dead-letter sink is absent (the §D predicate's OR + sink requirement).
 *
 * Behavioral assertions (the dedup → retry → dead-letter → causation delivery
 * loop) are gated on the `openwop-trigger-bridge` profile and land in
 * `trigger-bridge-delivery.test.ts` (deferred per RFC 0083 §Conformance —
 * reference host deferred). This scenario asserts the wire contract, not host
 * behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/trigger-bridge.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/profiles.md (§`openwop-trigger-bridge`)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0083-durable-trigger-and-channel-bridge-profile.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { deriveProfiles } from '../lib/profiles.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

const STATES = ['active', 'paused', 'failed', 'dead-lettered'] as const;

describe('trigger-bridge-shape: TriggerSubscription (RFC 0083 §B, server-free)', () => {
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const sub = loadSchema('trigger-subscription.schema.json');
  const validate = ajv.compile(sub);

  it('a conforming subscription validates', () => {
    expect(
      validate({ subscriptionId: 'sub-1', source: 'webhook', state: 'active', dedupEnabled: true, retryPolicy: { maxAttempts: 8, backoff: 'exponential' }, webhookId: 'wh-1', secretFingerprint: 'fp-abc' }),
      req('openwop.it.trigger-bridge-shape.a-conforming-subscription-validates', 'trigger-bridge.md §B', 'a conforming TriggerSubscription MUST validate'),
    ).toBe(true);
  });

  it('rejects a missing REQUIRED state, an out-of-enum source, and an unknown property', () => {
    expect(validate({ subscriptionId: 's', source: 'webhook' }), req('openwop.it.trigger-bridge-shape.rejects-a-missing-required-state-an-out-of-enum-source-and-an-unknown-property', 'trigger-bridge.md §B', 'state is REQUIRED')).toBe(false);
    expect(validate({ subscriptionId: 's', source: 'carrier-pigeon', state: 'active' }), req('openwop.it.trigger-bridge-shape.rejects-a-missing-required-state-an-out-of-enum-source-and-an-unknown-property', 'trigger-bridge.md §B', 'source is a closed enum')).toBe(false);
    expect(validate({ subscriptionId: 's', source: 'webhook', state: 'active', body: 'inbound' }), req('openwop.it.trigger-bridge-shape.rejects-a-missing-required-state-an-out-of-enum-source-and-an-unknown-property', 'trigger-bridge.md §B', 'TriggerSubscription MUST be additionalProperties:false')).toBe(false);
  });

  it('secretFingerprint MUST be bounded — a full 64-hex (unsalted-hash-smelling) digest is rejected', () => {
    const truncated = 'a1b2c3d4e5f6a7b8';      // 16 hex — a truncated host-keyed fingerprint
    const fullDigest = 'a'.repeat(64);          // 64 hex — smells like an unsalted SHA256(secret)
    expect(validate({ subscriptionId: 's', source: 'webhook', state: 'active', secretFingerprint: truncated }), req('openwop.it.trigger-bridge-shape.secretfingerprint-must-be-bounded-a-full-64-hex-unsalted-hash-smelling-digest-is', 'trigger-bridge.md §B', 'a truncated fingerprint MUST validate')).toBe(true);
    expect(validate({ subscriptionId: 's', source: 'webhook', state: 'active', secretFingerprint: fullDigest }), req('openwop.it.trigger-bridge-shape.secretfingerprint-must-be-bounded-a-full-64-hex-unsalted-hash-smelling-digest-is', 'SR-1', 'a full 64-hex digest MUST be rejected (brute-force oracle)')).toBe(false);
  });

  it('the state enum is exactly the four §B states', () => {
    const stateEnum = ((sub.properties as Record<string, { enum?: string[] }>).state?.enum) ?? [];
    expect([...stateEnum].sort(), req('openwop.it.trigger-bridge-shape.the-state-enum-is-exactly-the-four-b-states', 'trigger-bridge.md §B', 'the four-state vocabulary MUST be stable')).toEqual([...STATES].sort());
  });
});

describe('trigger-bridge-shape: trigger.* events (RFC 0083 §C, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const compile = (defName: string) => ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: (payloads as { $defs: Record<string, unknown> }).$defs,
    $ref: `#/$defs/${defName}`,
  } as Record<string, unknown>);

  it('trigger.subscription.state.changed validates + reason is a CLOSED enum (no URL-bearing free text)', () => {
    const v = compile('triggerSubscriptionStateChanged');
    expect(v({ subscriptionId: 's', source: 'webhook', fromState: 'active', toState: 'dead-lettered', reason: 'retry-exhausted' }), req('openwop.it.trigger-bridge-shape.trigger-subscription-state-changed-validates-reason-is-a-closed-enum-no-url-bear', 'trigger-bridge.md §C', 'state-changed MUST validate')).toBe(true);
    expect(v({ subscriptionId: 's', source: 'webhook', fromState: 'active' }), req('openwop.it.trigger-bridge-shape.trigger-subscription-state-changed-validates-reason-is-a-closed-enum-no-url-bear', 'trigger-bridge.md §C', 'toState is REQUIRED')).toBe(false);
    expect(v({ subscriptionId: 's', source: 'webhook', fromState: 'active', toState: 'failed', reason: 'https://attacker.example/leak?token=sk' }), req('openwop.it.trigger-bridge-shape.trigger-subscription-state-changed-validates-reason-is-a-closed-enum-no-url-bear', 'SR-1', 'a free-form / URL-bearing reason MUST be rejected')).toBe(false);
  });

  it('trigger.delivery.attempted validates + enforces the outcome enum', () => {
    const v = compile('triggerDeliveryAttempted');
    expect(v({ subscriptionId: 's', dedupKey: 'evt-9f3', attempt: 1, outcome: 'delivered', runId: 'run_x' }), req('openwop.it.trigger-bridge-shape.trigger-delivery-attempted-validates-enforces-the-outcome-enum', 'trigger-bridge.md §C', 'delivery-attempted MUST validate')).toBe(true);
    expect(v({ subscriptionId: 's', dedupKey: 'evt-9f3', attempt: 1 }), req('openwop.it.trigger-bridge-shape.trigger-delivery-attempted-validates-enforces-the-outcome-enum', 'trigger-bridge.md §C', 'outcome is REQUIRED')).toBe(false);
    expect(v({ subscriptionId: 's', dedupKey: 'evt-9f3', attempt: 1, outcome: 'exploded' }), req('openwop.it.trigger-bridge-shape.trigger-delivery-attempted-validates-enforces-the-outcome-enum', 'trigger-bridge.md §C', 'outcome is a closed enum')).toBe(false);
  });

  it('both trigger event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = ((runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum) ?? [];
    for (const name of ['trigger.subscription.state.changed', 'trigger.delivery.attempted']) {
      expect(enumVals.includes(name), req('openwop.it.trigger-bridge-shape.both-trigger-event-names-appear-in-the-runeventtype-enum', 'run-event.schema.json', `${name} MUST be in the RunEventType enum`)).toBe(true);
    }
  });
});

describe('trigger-bridge-shape: capability + profile derivation (RFC 0083 §A/§D, server-free)', () => {
  it('capabilities.triggerBridge + webhooks.durable are declared', () => {
    const caps = loadSchema('capabilities.schema.json');
    const props = caps.properties as Record<string, { properties?: Record<string, unknown> }>;
    expect(props.triggerBridge?.properties?.supported, req('openwop.it.trigger-bridge-shape.capabilities-triggerbridge-webhooks-durable-are-declared', 'trigger-bridge.md §A', 'triggerBridge.supported MUST be declared')).toBeDefined();
    expect(props.webhooks?.properties?.durable, req('openwop.it.trigger-bridge-shape.capabilities-triggerbridge-webhooks-durable-are-declared', 'trigger-bridge.md §A', 'webhooks.durable MUST be declared')).toBeDefined();
  });

  const coreBase = {
    protocolVersion: '1.0',
    supportedEnvelopes: ['clarification.request'],
    schemaVersions: {},
    limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 },
  };

  it('deriveProfiles surfaces openwop-trigger-bridge for bridge + deadLetter + a durable source', () => {
    const c = { ...coreBase, triggerBridge: { supported: true }, deadLetter: { supported: true }, queueBus: { supported: true } } as Record<string, unknown>;
    expect(deriveProfiles(c).includes('openwop-trigger-bridge'), req('openwop.it.trigger-bridge-shape.deriveprofiles-surfaces-openwop-trigger-bridge-for-bridge-deadletter-a-durable-s', 'profiles.md §openwop-trigger-bridge', 'bridge + sink + durable source MUST derive the profile')).toBe(true);
  });

  it('deriveProfiles withholds openwop-trigger-bridge when the dead-letter sink is absent', () => {
    const c = { ...coreBase, triggerBridge: { supported: true }, webhooks: { durable: true } } as Record<string, unknown>;
    expect(deriveProfiles(c).includes('openwop-trigger-bridge'), req('openwop.it.trigger-bridge-shape.deriveprofiles-withholds-openwop-trigger-bridge-when-the-dead-letter-sink-is-abs', 'profiles.md §openwop-trigger-bridge', 'no deadLetter sink ⇒ MUST NOT derive the profile')).toBe(false);
  });
});
