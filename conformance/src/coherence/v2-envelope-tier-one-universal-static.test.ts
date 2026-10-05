/**
 * v2 — the Tier-1 structured-output subset over the universal kinds, statically
 * (RFC 0030 §B). The walker lives in `lib/envelope-schema-static.ts`.
 *
 *   load-bearing  each universal-kind payload schema in `schemas/v2/envelopes/`
 *                 uses none of the keywords that fail across several Tier-1
 *                 vendors (`oneOf`, `allOf`, `not`, `if`/`then`/`else`,
 *                 `dependencies`, `prefixItems`, `propertyNames`), nests at most
 *                 5 deep and has at most 100 properties.
 *
 * A corpus gate (`conformance.md` §Two products): it reads only the corpus, runs in
 * the spec repo's CI, and never reaches a host bundle. Split out of
 * `src/scenarios/v2-envelope-tier-one-subset-static` in 2.45.18; that scenario
 * keeps the strict leg, which reads the host's advertised kinds.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §B
 */

import { describe, it, expect } from 'vitest';
import { V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { loadV2EnvelopeSchema, tierOneViolations, UNIVERSAL_KINDS } from '../lib/envelope-schema-static.js';

const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';
const ID_LOAD_BEARING = 'openwop.requirement.envelopes.tier-one-load-bearing-universal-kinds';

describe('v2 Tier-1 subset: universal kinds meet the load-bearing rules (always on)', () => {
  for (const kind of UNIVERSAL_KINDS) {
    it(`${kind} uses no keyword that fails across Tier-1 vendors`, () => {
      if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
      const schema = loadV2EnvelopeSchema(kind);
      expect(schema !== null, req(ID_LOAD_BEARING, 'RFC 0030 §B', `schemas/v2/envelopes/${kind}.schema.json MUST exist`)).toBe(true);
      const violations = schema === null ? [] : tierOneViolations(schema, 'load-bearing');
      expect(violations, req(ID_LOAD_BEARING, 'RFC 0030 §B', `${kind} load-bearing Tier-1 violations: ${JSON.stringify(violations)}`)).toEqual([]);
    });
  }
});
