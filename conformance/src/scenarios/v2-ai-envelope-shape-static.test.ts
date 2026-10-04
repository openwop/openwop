/**
 * v2 — the AI envelope wire shape, statically (`spec/v2/core/events.md`
 * §"AI envelopes: E1–E5"; `schemas/v2/ai-envelope.schema.json`). The v1 twin is
 * the static half of `ai-envelope-shape`; its live halves (the
 * `envelope/accept` seam legs) are seam-only and not ported.
 *
 *   compile     `ai-envelope.schema.json` and each universal-kind payload
 *               schema compile under Ajv 2020 with the v2 tree registered;
 *   positive    a well-formed envelope validates — with `correlationId` and
 *               `meta.source`, which v2 makes REQUIRED (migration C4.16);
 *   meta        an envelope without `meta` is rejected;
 *   closed      an unknown top-level property is rejected;
 *   correlation NEW at v2: an envelope without `correlationId` is rejected
 *               ("`correlationId` and `meta.source` are REQUIRED on every
 *               envelope … nothing is synthesized");
 *   source      NEW at v2: an envelope whose `meta` has no `source` is rejected.
 *
 * The `<org>.` namespacing rule for kinds is not witnessed here: the schema's
 * `type` is an open string, so the rule binds the engine's acceptance, not the
 * wire shape.
 *
 * Host-free: every leg runs with no OPENWOP_BASE_URL.
 *
 * @see spec/v2/core/events.md §"AI envelopes: E1–E5"
 * @see spec/v1/migrations.json openwop.migration.C4.16
 */

import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';
import { UNIVERSAL_KINDS } from '../lib/envelope-schema-static.js';

const DOC = 'events.md §AI envelopes: E1–E5';
const ID_COMPILE = 'openwop.requirement.ai-envelope.schemas-compile';
const ID_POSITIVE = 'openwop.requirement.ai-envelope.well-formed-accepted';
const ID_META = 'openwop.requirement.ai-envelope.meta-required';
const ID_CLOSED = 'openwop.requirement.ai-envelope.top-level-closed';
const ID_CORRELATION = 'openwop.requirement.ai-envelope.correlation-id-required';
const ID_SOURCE = 'openwop.requirement.ai-envelope.meta-source-required';

const WELL_FORMED = {
  type: 'clarification.request',
  schemaVersion: 1,
  envelopeId: 'env-v2-positive-1',
  correlationId: 'run-1:node-2:turn-0:abc123',
  payload: { questions: [{ id: 'q1', question: 'Which provider?' }] },
  meta: { source: 'ai-generation', ts: '2026-10-04T10:00:00Z', contentTrust: 'trusted' },
} as const;

/** The well-formed envelope with one top-level field removed. */
function without(field: string): Record<string, unknown> {
  const e: Record<string, unknown> = { ...WELL_FORMED };
  delete e[field];
  return e;
}

describe('v2 AI envelope shape: schemas compile', () => {
  it('ai-envelope.schema.json compiles under Ajv 2020', () => {
    expect(() => v2Validator('ai-envelope'), req(ID_COMPILE, DOC, 'schemas/v2/ai-envelope.schema.json MUST compile')).not.toThrow();
  });

  for (const kind of UNIVERSAL_KINDS) {
    it(`envelopes/${kind}.schema.json compiles under Ajv 2020`, () => {
      expect(() => v2Validator(`envelopes/${kind}`), req(ID_COMPILE, DOC, `schemas/v2/envelopes/${kind}.schema.json MUST compile`)).not.toThrow();
    });
  }
});

describe('v2 AI envelope shape: round-trip', () => {
  const validate = v2Validator('ai-envelope');

  it('accepts a well-formed envelope carrying correlationId and meta.source', () => {
    const r = validate(WELL_FORMED);
    expect(r.ok, req(ID_POSITIVE, DOC, `a well-formed envelope MUST validate (${r.errors})`)).toBe(true);
  });

  it('rejects an envelope missing meta', () => {
    expect(validate(without('meta')).ok, req(ID_META, DOC, 'an envelope without meta MUST be rejected')).toBe(false);
  });

  it('rejects an envelope with an unknown top-level property', () => {
    expect(validate({ ...WELL_FORMED, unknownTopLevel: 'x' }).ok, req(ID_CLOSED, 'schemas/v2/ai-envelope.schema.json', 'the envelope is closed: an unknown top-level property MUST be rejected')).toBe(false);
  });

  it('rejects an envelope missing correlationId', () => {
    expect(validate(without('correlationId')).ok, req(ID_CORRELATION, DOC, 'correlationId is REQUIRED on every envelope at v2 — an envelope without it MUST be rejected, never synthesized')).toBe(false);
  });

  it('rejects an envelope whose meta carries no source', () => {
    const { source: _source, ...meta } = WELL_FORMED.meta;
    expect(validate({ ...WELL_FORMED, meta }).ok, req(ID_SOURCE, DOC, 'meta.source is REQUIRED on every envelope at v2 — an envelope without it MUST be rejected')).toBe(false);
  });
});
