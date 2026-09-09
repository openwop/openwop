/**
 * v2 — `enum-growth-rule` (suite 2.0.0; RFC 0171 §A.1, §A.5;
 * `spec/v2/core/events.md` §"Types" — Growth; `overview.md` §0).
 *
 * Witness class: witnessable — unaided. A registry-backed enum grows by adding
 * a row and regenerating; a consumer MUST accept an unknown registered member
 * and MUST NOT act on it, and a producer MUST NOT emit an unregistered member.
 * The schema half is server-free: `run-event.schema.json`'s `oneOf` accepts a
 * vendor type `<org>.thing` (the org read from the host's `extensions`, `acme`
 * when the host is unreachable or advertises none) that is unknown to this
 * suite, and rejects the reserved `openwop.` prefix. The reader half is the
 * suite's own fold: `event-type-closed` and `payload-registry-closed` ignore a
 * vendor event's payload rather than acting on it, which is what the growth
 * rule requires of a consumer. The producer half is `event-type-closed`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/events.md §Types (Growth)';

async function org(): Promise<string> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  const ext = doc?.['extensions'];
  const first = ext !== null && typeof ext === 'object' ? Object.keys(ext as Record<string, unknown>)[0] : undefined;
  const o = first?.split('.')[0];
  return o !== undefined && o.length > 0 ? o : 'acme';
}

function protocolTypes(): Set<string> {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'run-event.schema.json'), 'utf8')) as { properties: { type: { oneOf: Array<{ enum?: string[] }> } } };
  return new Set(schema.properties.type.oneOf.flatMap((b) => b.enum ?? []));
}

function event(type: string): Record<string, unknown> {
  return {
    eventId: 'conformanceevent0123456789',
    runId: 'openwop-conformance-tenant/conformancerun0123456789',
    type,
    payload: { anything: 'the suite does not act on it' },
    timestamp: '2026-09-03T00:00:00Z',
    sequence: 0,
    schemaVersion: 1,
  };
}

describe('v2 enum-growth-rule (RFC 0171 §A.5)', () => {
  it('the envelope accepts a registered-but-unknown-to-this-suite vendor member', async () => {
    const validate = v2Validator('run-event');
    const type = `${await org()}.thing`;
    expect(protocolTypes().has(type), req('openwop.requirement.0171.enum-growth-rule.unknown-member-accepted', DOC, `${type} MUST NOT be a member of the suite's closed protocol enum — it is the unknown member the rule is about`)).toBe(false);
    const r = validate(event(type));
    expect(r.ok, req('openwop.requirement.0171.enum-growth-rule.unknown-member-accepted', DOC, `a consumer MUST accept an unknown registered member: the schema's oneOf vendor branch MUST admit ${type} (${r.errors})`)).toBe(true);
    const three = validate(event(`${await org()}.thing.happened`));
    expect(three.ok, req('openwop.requirement.0171.enum-growth-rule.unknown-member-accepted', DOC, 'the vendor branch admits an optional third segment (<org>.<domain>.<name>)')).toBe(true);
  });

  it('the reserved prefix and a malformed member are rejected', () => {
    const validate = v2Validator('run-event');
    expect(validate(event('openwop.thing')).ok, req('openwop.requirement.0171.enum-growth-rule.reserved-rejected', DOC, 'openwop. is the only reserved prefix; a type under it that is not in the enum MUST fail')).toBe(false);
    expect(validate(event('Acme.Thing')).ok, req('openwop.requirement.0171.enum-growth-rule.reserved-rejected', DOC, 'a member outside the positive pattern (upper-case) MUST fail')).toBe(false);
    expect(validate(event('thing')).ok, req('openwop.requirement.0171.enum-growth-rule.reserved-rejected', DOC, 'a single-segment member MUST fail — every type is <domain>.<name> or <org>.<name>')).toBe(false);
  });
});
