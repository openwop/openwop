/**
 * v2 — the Tier-1 structured-output subset, statically (RFC 0030 §B;
 * `envelopes.tierOneSubsetCompliance` in `schemas/v2/capabilities.schema.json`).
 * The v1 twin is `envelope-tier-one-subset-static`; the walker lives in
 * `lib/envelope-schema-static.ts`.
 *
 *   load-bearing  ALWAYS ON, host-free: each universal-kind payload schema in
 *                 `schemas/v2/envelopes/` uses none of the keywords that fail
 *                 across several Tier-1 vendors (`oneOf`, `allOf`, `not`,
 *                 `if`/`then`/`else`, `dependencies`, `prefixItems`,
 *                 `propertyNames`), nests at most 5 deep and has at most 100
 *                 properties;
 *   strict        LIVE: a host advertising `tierOneSubsetCompliance: "strict"`
 *                 has, for every kind it lists in `supportedEnvelopes.kinds`
 *                 that resolves to a corpus schema, a schema meeting the whole
 *                 intersection (closed objects, every property required, no
 *                 string/number/array bounds). Host-served vendor schemas are
 *                 not fetched, as at v1.
 *
 * The strict rule is stated by the schema seat's description ("`strict`: every
 * host-served envelope schema passes the static subset-compliance check"). The
 * v2 prose (`events.md` §envelopes) states a different, behavioural rule — the
 * host MUST accept an envelope restricted to the subset from any advertised
 * provider — and does not distinguish strict, warn and off.
 *
 * Dispositions (strict leg): discovery unreadable ⇒ `blocked`; `envelopes` not
 * advertised, or `tierOneSubsetCompliance` other than "strict" ⇒
 * `inapplicable`; no advertised kind resolving to a corpus schema ⇒
 * `inapplicable`.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §B
 * @see spec/v2/core/events.md §envelopes
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { loadV2EnvelopeSchema, tierOneViolations, UNIVERSAL_KINDS, type SchemaViolation } from '../lib/envelope-schema-static.js';

const ID_LOAD_BEARING = 'openwop.requirement.envelopes.tier-one-load-bearing-universal-kinds';
const ID_STRICT = 'openwop.requirement.envelopes.tier-one-strict-advertised-kinds';

describe('v2 Tier-1 subset: universal kinds meet the load-bearing rules (always on)', () => {
  for (const kind of UNIVERSAL_KINDS) {
    it(`${kind} uses no keyword that fails across Tier-1 vendors`, () => {
      const schema = loadV2EnvelopeSchema(kind);
      expect(schema !== null, req(ID_LOAD_BEARING, 'RFC 0030 §B', `schemas/v2/envelopes/${kind}.schema.json MUST exist`)).toBe(true);
      const violations = schema === null ? [] : tierOneViolations(schema, 'load-bearing');
      expect(violations, req(ID_LOAD_BEARING, 'RFC 0030 §B', `${kind} load-bearing Tier-1 violations: ${JSON.stringify(violations)}`)).toEqual([]);
    });
  }
});

describe('v2 Tier-1 subset: a strict host\'s advertised kinds meet the whole intersection', () => {
  it('a host advertising tierOneSubsetCompliance strict has advertised kinds whose corpus schemas satisfy the Tier-1 intersection', async () => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    const envelopes = await familyAdvertised('envelopes');
    if (envelopes === null) return softSkip('inapplicable', 'the host does not advertise envelopes');
    if (envelopes['tierOneSubsetCompliance'] !== 'strict') return softSkip('inapplicable', `envelopes.tierOneSubsetCompliance is ${JSON.stringify(envelopes['tierOneSubsetCompliance'])}, not "strict" — the strict walk binds only a strict host`);
    const catalog = await familyAdvertised('supportedEnvelopes');
    const kinds = Array.isArray(catalog?.['kinds']) ? (catalog['kinds'] as unknown[]).filter((k): k is string => typeof k === 'string') : [];
    const walked: Record<string, SchemaViolation[]> = {};
    let resolved = 0;
    for (const kind of kinds) {
      const schema = loadV2EnvelopeSchema(kind);
      if (schema === null) continue;
      resolved++;
      const v = tierOneViolations(schema, 'strict');
      if (v.length > 0) walked[kind] = v;
    }
    if (resolved === 0) return softSkip('inapplicable', `none of the ${kinds.length} kinds in supportedEnvelopes.kinds resolves to a corpus schema; host-served vendor schemas are not fetched`);
    expect(walked, req(ID_STRICT, 'capabilities.schema.json §envelopes.tierOneSubsetCompliance', `a strict host's advertised kinds MUST satisfy the Tier-1 intersection: ${JSON.stringify(walked)}`)).toEqual({});
  });
});
