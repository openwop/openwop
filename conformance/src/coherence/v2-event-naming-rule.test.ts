/**
 * v2-event-naming-rule — RFC 0171 §A.2 (corpus wrapper, inline).
 *
 * The v2 event-type naming rule: `domain.verb-ed` — kebab, exactly two segments
 * — for a transition; `domain.noun` permitted only where the event names an
 * emitted artifact rather than a transition, with the exception list RECORDED
 * in RFC 0171 §A.2 (`output.chunk`, `provider.usage`, `channel.presence`,
 * `agent.handoff`, `envelope.refusal`, `agent.reasoning-delta`,
 * `voice.synthesis-chunk`, `voice.endpoint-candidate`). The corpus gate checks
 * the list, so an exception is a decision, not a drift: every closed-enum
 * member of `schemas/v2/run-event.schema.json` matches the two-segment kebab
 * grammar, and every recorded exception is an enum member (a stale exception
 * is a drift in the other direction).
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle, under `openwop.requirement.0171.event-naming-rule`.
 *
 * @see RFCS/0171-v2-wire-envelope.md §A.2
 * @see schemas/v2/run-event.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0171.event-naming-rule';
const SECTION = 'RFC 0171 §A.2';
const GRAMMAR = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
/** The artifact-event exceptions RFC 0171 §A.2 records (domain.noun, not domain.verb-ed). */
const ARTIFACT_EXCEPTIONS = ['output.chunk', 'provider.usage', 'channel.presence', 'agent.handoff', 'envelope.refusal', 'agent.reasoning-delta', 'voice.synthesis-chunk', 'voice.endpoint-candidate'];

describe('v2-event-naming-rule (RFC 0171 §A.2)', () => {
  it('every closed-enum v2 event type is two kebab segments, and every recorded artifact exception is an enum member', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'run-event.schema.json'), 'utf8')) as { properties: { type: { oneOf: Array<{ enum?: string[] }> } } };
    const members = schema.properties.type.oneOf[0]?.enum ?? [];
    expect(members.length, req(ID, SECTION, 'run-event.schema.json properties.type.oneOf[0] MUST be the closed enum of v2 event types')).toBeGreaterThan(0);
    const exceptions = new Set(ARTIFACT_EXCEPTIONS);
    for (const t of members) {
      if (exceptions.has(t)) continue;
      expect(GRAMMAR.test(t), req(ID, SECTION, `event type \`${t}\` MUST match the \`domain.verb-ed\` grammar (kebab, exactly two segments) or be a recorded §A.2 artifact exception`)).toBe(true);
    }
    for (const x of ARTIFACT_EXCEPTIONS) {
      expect(members, req(ID, SECTION, `recorded §A.2 artifact exception \`${x}\` MUST be a member of the closed enum — an exception that names no event is a drift`)).toContain(x);
    }
  });
});
