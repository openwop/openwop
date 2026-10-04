/**
 * v2 — variant payload discrimination, statically (RFC 0031 §A). The v1 twin
 * is `envelope-variant-discriminator-static`; the walker lives in
 * `lib/envelope-schema-static.ts`.
 *
 * For every payload schema in `schemas/v2/envelopes/`:
 *   no oneOf       `oneOf` appears at no depth (Gemini drops it silently, so a
 *                  model gets a looser schema than declared);
 *   discriminated  in a variant union — an `anyOf` where two or more branches
 *                  can be objects — every object branch declares, in `required`,
 *                  a property of `type: string` with a one-value `enum`; a `$ref`
 *                  branch is accepted unresolved, as at v1. A type union with at
 *                  most one object branch (`string | binding`, as
 *                  `ui.a2ui-surface` payload v2's `dyn*` defs declare) is
 *                  selected by JSON type and is not judged: a scalar branch has
 *                  no property to discriminate on. This scoping is new at v2 —
 *                  the v1 walker flagged every non-`$ref` branch, which no v1
 *                  schema exercised.
 *
 * No v2 core document states this rule: `spec/v2/core/` carries no text on
 * variant payload discrimination (the nearest is `ext/a2uiSurface/README.md`,
 * whose components are "discriminated by a single-string-enum `component`").
 * The requirement is cited to RFC 0031 §A, its only normative home.
 *
 * Host-free: every leg runs with no OPENWOP_BASE_URL.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §A
 */

import { describe, it, expect } from 'vitest';
import { req } from '../lib/requirement-ids.js';
import { anyOfDiscriminatorViolations, listV2EnvelopeKinds, loadV2EnvelopeSchema, oneOfViolations, UNIVERSAL_KINDS } from '../lib/envelope-schema-static.js';

const DOC = 'RFC 0031 §A';
const ID_PRESENT = 'openwop.requirement.envelopes.payload-schemas-present';
const ID_NO_ONEOF = 'openwop.requirement.envelopes.variant-no-oneof';
const ID_DISCRIMINATED = 'openwop.requirement.envelopes.variant-anyof-discriminated';

const KINDS = listV2EnvelopeKinds();

describe('v2 envelope variant discrimination (RFC 0031 §A)', () => {
  it('schemas/v2/envelopes carries a payload schema for each universal kind', () => {
    for (const k of UNIVERSAL_KINDS) expect(KINDS.includes(k), req(ID_PRESENT, DOC, `schemas/v2/envelopes/${k}.schema.json MUST exist`)).toBe(true);
  });

  for (const kind of KINDS) {
    it(`${kind} contains no oneOf at any depth`, () => {
      const v = oneOfViolations(loadV2EnvelopeSchema(kind));
      expect(v, req(ID_NO_ONEOF, DOC, `${kind} MUST NOT use oneOf — use anyOf with a single-string-enum discriminator: ${JSON.stringify(v)}`)).toEqual([]);
    });

    it(`${kind} discriminates every anyOf branch by a single-string-enum property`, () => {
      const v = anyOfDiscriminatorViolations(loadV2EnvelopeSchema(kind));
      expect(v, req(ID_DISCRIMINATED, DOC, `${kind} anyOf branches without a discriminator: ${JSON.stringify(v)}`)).toEqual([]);
    });
  }
});
