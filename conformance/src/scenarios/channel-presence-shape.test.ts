/**
 * Channel presence — `channel.presence` ephemeral event (RFC 0110).
 *
 * Always-on, server-free schema-shape probe. Verifies the additive, normative
 * RFC 0110 wire facts on the published schemas:
 *
 *   1. `channel-presence-payload.schema.json` validates a conforming presence
 *      snapshot (`{ conversationId, present[], typing? }`), REQUIRES
 *      conversationId + present, and is CLOSED (`additionalProperties: false`) —
 *      the no-PII guard: no `ip`/`location`/free-text can ride the payload.
 *   2. `typing` is OPTIONAL — a snapshot with nobody typing validates.
 *   3. `run-event.schema.json` enumerates `channel.presence` as a RunEvent type.
 *   4. `capabilities.schema.json` declares `channelPresence` with `supported`,
 *      closed.
 *
 * The host-side MUSTs — presence is membership-gated (every ref a current
 * participant; never delivered to a non-member) and EPHEMERAL (never persisted
 * to the replayable log; replay/`:fork`-invisible) — are behavioral contracts
 * gated on `channelPresence.supported`, landing at the reference-host
 * implementation (RFC 0110 §Conformance). This scenario asserts the wire SHAPE.
 *
 * Normative references:
 *   - RFCS/0110-channel-presence.md (§Proposal / §Conformance)
 *   - schemas/channel-presence-payload.schema.json
 *   - schemas/run-event.schema.json (the channel.presence type)
 *   - schemas/capabilities.schema.json (channelPresence)
 *
 * @see RFCS/0110-channel-presence.md
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

describe('channel-presence-shape: the channel.presence payload (RFC 0110 §Proposal, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const presence = ajv.compile(loadSchema('channel-presence-payload.schema.json'));

  it('a conforming presence snapshot (present + typing) validates', () => {
    expect(
      presence({ conversationId: 'chan-eng', present: ['user:alice', 'agent:iris'], typing: ['user:alice'] }),
      req('openwop.it.channel-presence-shape.a-conforming-presence-snapshot-present-typing-validates', 'RFC 0110 §Proposal', 'a conforming channel.presence payload MUST validate'),
    ).toBe(true);
  });

  it('typing is OPTIONAL — a snapshot with nobody typing validates', () => {
    expect(
      presence({ conversationId: 'chan-eng', present: ['user:alice'] }),
      req('openwop.it.channel-presence-shape.typing-is-optional-a-snapshot-with-nobody-typing-validates', 'RFC 0110 §Proposal', 'typing is optional'),
    ).toBe(true);
  });

  it('conversationId and present are REQUIRED', () => {
    expect(presence({ present: ['user:a'] }), req('openwop.it.channel-presence-shape.conversationid-and-present-are-required', 'RFC 0110 §Proposal', 'conversationId is required')).toBe(false);
    expect(presence({ conversationId: 'c' }), req('openwop.it.channel-presence-shape.conversationid-and-present-are-required', 'RFC 0110 §Proposal', 'present is required')).toBe(false);
  });

  it('the payload is CLOSED — a non-subject-ref field (ip/location) MUST be rejected (the no-PII guard)', () => {
    expect(
      presence({ conversationId: 'c', present: ['user:a'], ip: '10.0.0.1' }),
      req('openwop.it.channel-presence-shape.the-payload-is-closed-a-non-subject-ref-field-ip-location-must-be-rejected-the-n', 'RFC 0110 §Proposal', 'channel.presence MUST forbid extra keys — no PII rides the payload'),
    ).toBe(false);
  });
});

describe('channel-presence-shape: event type + capability advertisement (RFC 0110 §Conformance, server-free)', () => {
  it('run-event.schema.json enumerates `channel.presence` as a RunEvent type', () => {
    const re = loadSchema('run-event.schema.json');
    const enumVals = JSON.stringify(re);
    expect(enumVals.includes('"channel.presence"'), req('openwop.it.channel-presence-shape.run-event-schema-json-enumerates-channel-presence-as-a-runevent-type', 'RFC 0110 §Proposal', 'channel.presence MUST be a declared RunEvent type')).toBe(true);
  });

  it('capabilities.schema.json declares channelPresence with supported, closed', () => {
    const caps = loadSchema('capabilities.schema.json');
    const block = (caps.properties as Record<string, Record<string, unknown>>).channelPresence as
      | { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
      | undefined;
    expect(block, req('openwop.it.channel-presence-shape.capabilities-schema-json-declares-channelpresence-with-supported-closed', 'RFC 0110 §Conformance', 'capabilities.channelPresence MUST be declared')).toBeDefined();
    expect(block?.properties?.supported, req('openwop.it.channel-presence-shape.capabilities-schema-json-declares-channelpresence-with-supported-closed', 'RFC 0110 §Conformance', 'channelPresence.supported MUST be declared')).toBeDefined();
    expect(block?.required, req('openwop.it.channel-presence-shape.capabilities-schema-json-declares-channelpresence-with-supported-closed', 'RFC 0110 §Conformance', 'supported MUST be required on the block')).toContain('supported');
    expect(block?.additionalProperties, req('openwop.it.channel-presence-shape.capabilities-schema-json-declares-channelpresence-with-supported-closed', 'RFC 0110 §Conformance', 'the block MUST be closed')).toBe(false);
  });
});
