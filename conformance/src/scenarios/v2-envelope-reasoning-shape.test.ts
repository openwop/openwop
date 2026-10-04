/**
 * v2 — the optional `reasoning` payload field (`spec/v2/core/events.md`
 * §`envelopes`; RFC 0030 §A). Static: reads `schemas/v2/envelopes/` only. The
 * v1 twin is `envelope-reasoning-shape`; its two advertisement legs
 * (`envelopes.reasoning`, `envelopes.tierOneSubsetCompliance`) are ported to
 * `v2-envelopes-advertisement`, not repeated here.
 *
 *   declared   `clarification.request`, `schema.request` and `error` declare an
 *              OPTIONAL `reasoning: string` ("A vendor kind whose payload needs
 *              multi-step reasoning SHOULD declare it as optional");
 *   omitted    `schema.response` (a side-channel ack) does not declare it;
 *   absent ok  each of the three validates WITHOUT `reasoning` ("A host MUST NOT
 *              reject an envelope without it, whatever `promptDirective` says");
 *   present ok each validates WITH a string `reasoning`;
 *   typed      a non-string `reasoning` is rejected.
 *
 * Host-free: every leg runs with no OPENWOP_BASE_URL.
 *
 * @see spec/v2/core/events.md §envelopes
 * @see schemas/v2/envelopes/
 */

import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';
import { loadV2EnvelopeSchema } from '../lib/envelope-schema-static.js';

const DOC = 'events.md §envelopes';
const ID_DECLARED = 'openwop.requirement.envelopes.reasoning-declared-optional-string';
const ID_OMITTED = 'openwop.requirement.envelopes.reasoning-omitted-from-schema-response';
const ID_ABSENT_OK = 'openwop.requirement.envelopes.reasoning-absent-accepted';
const ID_PRESENT_OK = 'openwop.requirement.envelopes.reasoning-present-accepted';
const ID_TYPED = 'openwop.requirement.envelopes.reasoning-non-string-rejected';

/** A valid payload per kind, without `reasoning`. */
const BASE: Readonly<Record<string, Record<string, unknown>>> = {
  'clarification.request': { questions: [{ id: 'q1', question: 'Which provider?' }] },
  'schema.request': { envelopeType: 'acme.prd.create' },
  error: { code: 'validation_failed', message: 'Could not match the schema.' },
};
const KINDS = Object.keys(BASE);

describe('v2 envelope reasoning: payload schemas (events.md §envelopes)', () => {
  for (const kind of KINDS) {
    it(`${kind} declares an optional reasoning of type string`, () => {
      const schema = loadV2EnvelopeSchema(kind);
      const props = (schema?.['properties'] ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema?.['required'] ?? []) as unknown[];
      expect(schema !== null, req(ID_DECLARED, DOC, `schemas/v2/envelopes/${kind}.schema.json MUST exist`)).toBe(true);
      expect(props['reasoning']?.['type'], req(ID_DECLARED, DOC, `${kind} MUST declare reasoning as type string`)).toBe('string');
      expect(required.includes('reasoning'), req(ID_DECLARED, DOC, `${kind} MUST NOT require reasoning — it is optional`)).toBe(false);
    });
  }

  it('schema.response does not declare reasoning (a side-channel ack)', () => {
    const schema = loadV2EnvelopeSchema('schema.response');
    const props = (schema?.['properties'] ?? {}) as Record<string, unknown>;
    expect(schema !== null, req(ID_OMITTED, 'RFC 0030 §A', 'schemas/v2/envelopes/schema.response.schema.json MUST exist')).toBe(true);
    expect('reasoning' in props, req(ID_OMITTED, 'RFC 0030 §A', 'schema.response MUST NOT declare reasoning')).toBe(false);
  });
});

describe('v2 envelope reasoning: round-trip (events.md §envelopes)', () => {
  for (const kind of KINDS) {
    const validate = v2Validator(`envelopes/${kind}`);

    it(`${kind} validates without reasoning`, () => {
      const r = validate(BASE[kind]);
      expect(r.ok, req(ID_ABSENT_OK, DOC, `a ${kind} payload without reasoning MUST validate — a host MUST NOT reject it (${r.errors})`)).toBe(true);
    });

    it(`${kind} validates with a string reasoning`, () => {
      const r = validate({ reasoning: 'The input named X twice; I asked which one.', ...BASE[kind] });
      expect(r.ok, req(ID_PRESENT_OK, DOC, `a ${kind} payload with a string reasoning MUST validate (${r.errors})`)).toBe(true);
    });

    it(`${kind} rejects a non-string reasoning`, () => {
      expect(validate({ reasoning: 42, ...BASE[kind] }).ok, req(ID_TYPED, DOC, `${kind}: a numeric reasoning MUST be rejected — reasoning is a plain string`)).toBe(false);
    });
  }
});
