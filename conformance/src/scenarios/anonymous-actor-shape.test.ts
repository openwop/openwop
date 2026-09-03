/**
 * Anonymous-actor authorization — capability + snapshot + audit shapes (RFC 0132).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.anonymousActor` is declared with its `supported` / `tiers` /
 *     `writeEgressControls` / `failClosed` sub-flags.
 *   - the `anonymousActor` block validates a conforming `read` advert and a
 *     conforming `bounded-write-egress` advert, and REJECTS the negatives:
 *     `tiers: []` (minItems); `bounded-write-egress` without `writeEgressControls`
 *     (the §B.2 conditional-MUST); `writeEgressControls` present without the
 *     write tier (§B.2 else); `supported: false` (the block is omitted when
 *     unsupported, `const: true`); and an unknown property (additionalProperties).
 *   - `run-snapshot.owner` accepts the optional `principalKind: "anonymous"` and
 *     rejects an out-of-enum `"guest"`.
 *   - the anon audit reuses the existing RFC 0049 `authorization.decided` event:
 *     a content-free grant/deny record (opaque `anon:` principal + a machine
 *     `reason`) validates, and `authorization.decided` is in the RunEventType enum.
 *
 * Behavioral assertions (default-deny grant, no-secret-reach, SSRF-guarded egress,
 * gated writes, opaque audit) are gated on `capabilities.anonymousActor.supported`
 * and land in the five `anonymous-actor-*.test.ts` scenarios (deferred per RFC 0132
 * §Conformance — reference host soft-skips until openwop-app wires a tool-enabled
 * public surface). This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md (§anonymousActor)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/auth.md (§Identity claims — the anonymous principal kind)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0132-anonymous-actor-authorization.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('anonymous-actor-shape: capability advertisement (RFC 0132 §B, server-free)', () => {
  const caps = loadSchema('capabilities.schema.json');
  const anon = (caps.properties as Record<string, { properties?: Record<string, unknown> }>)
    .anonymousActor;

  it('the capabilities schema declares anonymousActor with its sub-flags', () => {
    expect(
      anon,
      req('openwop.it.anonymous-actor-shape.the-capabilities-schema-declares-anonymousactor-with-its-sub-flags', 'capabilities.md §anonymousActor', 'capabilities.anonymousActor MUST be declared'),
    ).toBeDefined();
    for (const flag of ['supported', 'tiers', 'writeEgressControls', 'failClosed']) {
      expect(
        anon?.properties?.[flag],
        req('openwop.it.anonymous-actor-shape.the-capabilities-schema-declares-anonymousactor-with-its-sub-flags', 'capabilities.md §anonymousActor', `anonymousActor.${flag} MUST be declared`),
      ).toBeDefined();
    }
  });

  it('validates conforming read + bounded-write-egress adverts and rejects the negatives', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(anon as Record<string, unknown>);

    // Positive — read-only tier.
    expect(
      validate({ supported: true, tiers: ['read'], failClosed: true }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B', 'a conforming read-tier advert MUST validate'),
    ).toBe(true);
    // Positive — bounded-write-egress tier with a mandatory control.
    expect(
      validate({
        supported: true,
        tiers: ['read', 'bounded-write-egress'],
        writeEgressControls: ['hitl'],
        failClosed: true,
      }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B', 'a bounded-write-egress advert with a control MUST validate'),
    ).toBe(true);

    // Negative — empty tiers (minItems: 1).
    expect(
      validate({ supported: true, tiers: [] }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B', 'tiers: [] MUST be rejected (minItems)'),
    ).toBe(false);
    // Negative — write tier without a control (the §B.2 conditional-MUST).
    expect(
      validate({ supported: true, tiers: ['bounded-write-egress'] }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B.2', 'bounded-write-egress without writeEgressControls MUST be rejected'),
    ).toBe(false);
    // Negative — controls advertised without the write tier (§B.2 else branch).
    expect(
      validate({ supported: true, tiers: ['read'], writeEgressControls: ['hitl'] }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B.2', 'writeEgressControls without the write tier MUST be rejected'),
    ).toBe(false);
    // Negative — supported: false (the block is omitted when unsupported, const: true).
    expect(
      validate({ supported: false, tiers: ['read'] }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B', 'supported: false MUST be rejected (const: true — omit the block instead)'),
    ).toBe(false);
    // Negative — unknown property (additionalProperties: false).
    expect(
      validate({ supported: true, tiers: ['read'], surface: 'wgt_abc' }),
      req('openwop.it.anonymous-actor-shape.validates-conforming-read-bounded-write-egress-adverts-and-rejects-the-negatives', 'RFC 0132 §B', 'an unknown property MUST be rejected (additionalProperties: false)'),
    ).toBe(false);
  });
});

describe('anonymous-actor-shape: owner.principalKind (RFC 0132 §A, server-free)', () => {
  it('run-snapshot owner accepts principalKind "anonymous" and rejects "guest"', () => {
    const snap = loadSchema('run-snapshot.schema.json');
    // RFC 0165 added an optional `subject` member ($ref subject.schema.json);
    // register it and give the extracted sub-schema its parent's `$id` as the
    // base the relative $ref resolves against.
    const owner = { $id: snap.$id as string, ...((snap.properties as Record<string, unknown>).owner as Record<string, unknown>) };
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(loadSchema('subject.schema.json'));
    const validate = ajv.compile(owner);
    expect(
      validate({ tenant: 'acme', principal: 'anon:sess-3f9c', principalKind: 'anonymous' }),
      req('openwop.it.anonymous-actor-shape.run-snapshot-owner-accepts-principalkind-anonymous-and-rejects-guest', 'RFC 0132 §A', 'owner.principalKind "anonymous" MUST validate'),
    ).toBe(true);
    // Absent principalKind is today's RFC 0048 behavior — still valid.
    expect(
      validate({ tenant: 'acme', principal: 'u_42' }),
      req('openwop.it.anonymous-actor-shape.run-snapshot-owner-accepts-principalkind-anonymous-and-rejects-guest', 'RFC 0048', 'owner without principalKind MUST still validate'),
    ).toBe(true);
    expect(
      validate({ tenant: 'acme', principalKind: 'guest' }),
      req('openwop.it.anonymous-actor-shape.run-snapshot-owner-accepts-principalkind-anonymous-and-rejects-guest', 'RFC 0132 §A', 'owner.principalKind "guest" MUST be rejected (enum)'),
    ).toBe(false);
  });
});

describe('anonymous-actor-shape: audit reuses authorization.decided (RFC 0132 §D, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(loadSchema('subject.schema.json'));
  ajv.addSchema(payloads, 'payloads');
  const decided = ajv.getSchema('payloads#/$defs/authorizationDecided');

  it('a content-free anon grant + deny record validates against the existing $def', () => {
    expect(decided, req('openwop.it.anonymous-actor-shape.a-content-free-anon-grant-deny-record-validates-against-the-existing-def', 'RFC 0132', 'the authorizationDecided $def MUST exist (no new event minted)')).toBeTruthy();
    // Grant — the §G positive example.
    expect(
      decided!({
        principal: 'anon:sess-3f9c',
        action: 'tool:catalog.read',
        resource: 'tenant:acme',
        allowed: true,
        reason: 'anon-granted',
      }),
      req('openwop.it.anonymous-actor-shape.a-content-free-anon-grant-deny-record-validates-against-the-existing-def', 'RFC 0132 §D', 'a conforming anon grant record MUST validate'),
    ).toBe(true);
    // Deny — a not-granted tool.
    expect(
      decided!({
        principal: 'anon:sess-3f9c',
        action: 'tool:crm.write',
        resource: 'tenant:acme',
        allowed: false,
        reason: 'anon-not-granted',
      }),
      req('openwop.it.anonymous-actor-shape.a-content-free-anon-grant-deny-record-validates-against-the-existing-def', 'RFC 0132 §D', 'a conforming anon deny record MUST validate'),
    ).toBe(true);
  });

  it('authorization.decided is in the RunEventType enum (the reused audit event)', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(enumVals, req('openwop.it.anonymous-actor-shape.authorization-decided-is-in-the-runeventtype-enum-the-reused-audit-event', 'RFC 0132', 'authorization.decided is in the RunEventType enum (the reused audit event)')).toContain('authorization.decided');
  });
});
