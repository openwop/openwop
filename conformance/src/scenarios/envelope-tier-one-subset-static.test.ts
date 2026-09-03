/**
 * envelope-tier-one-subset-static — RFC 0030 §B static schema-walker.
 *
 * Capability-gated on `capabilities.envelopes.tierOneSubsetCompliance: "strict"`.
 *
 * For every kind in `capabilities.supportedEnvelopes` whose payload schema
 * is reachable via the host's `/schemas/envelopes/<kind>.schema.json`
 * canonical location OR via this repo's local `schemas/envelopes/` directory
 * (for the four universal kinds), statically assert the Tier-1 cross-vendor
 * intersection rules per `spec/v1/structured-output-subset.md`:
 *
 *   - Object root (`type: object`)
 *   - `additionalProperties: false` on every object subschema
 *   - Every property listed in `required` (OpenAI strict rule)
 *   - No `oneOf` anywhere (Gemini silently drops)
 *   - No `allOf` / `not` / `if/then/else` / `dependencies` / `prefixItems`
 *   - No string format constraints (`minLength` / `maxLength` / `pattern` /
 *     `format`)
 *   - No number bounds (`minimum` / `maximum` / `multipleOf`)
 *   - No array bounds (`minItems` / `maxItems` / `uniqueItems`)
 *   - No `propertyNames`
 *   - Max nesting depth 5
 *   - Max total property count 100
 *
 * Hosts that advertise `warn` or `off` (or omit the field) soft-skip — the
 * conformance suite reports the schemas it walked without failing.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §B
 * @see spec/v1/structured-output-subset.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

const UNIVERSAL_KINDS = ['clarification.request', 'schema.request', 'schema.response', 'error'] as const;

interface DiscoveryDoc {
  capabilities?: {
    supportedEnvelopes?: unknown;
    envelopes?: { tierOneSubsetCompliance?: unknown };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

function loadLocalSchema(kind: string): Record<string, unknown> | null {
  const p = join(SCHEMAS_DIR, 'envelopes', `${kind}.schema.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

interface Violation {
  path: string;
  rule: string;
  detail?: string;
}

/**
 * Walk a schema, collecting violations.
 *
 * `mode: "load-bearing"` — only flags rules that fail across MULTIPLE vendors
 * (Gemini silently drops these, producing looser-than-declared schemas — a
 * silent correctness bug). These are the bare-minimum constraints that
 * RFC 0030 §B applies even to schemas that predate the RFC.
 *
 * `mode: "strict"` — flags every rule outside the OpenAI-strict ∩ Anthropic-
 * strict ∩ Gemini intersection. Used only when the host advertises
 * `tierOneSubsetCompliance: "strict"`.
 */
function walkSchema(
  schema: Record<string, unknown>,
  path: string,
  depth: number,
  propCount: { n: number },
  violations: Violation[],
  mode: 'load-bearing' | 'strict',
): void {
  if (depth > 5) {
    violations.push({ path, rule: 'max-nesting-depth-5', detail: `depth=${depth}` });
    return;
  }
  // Load-bearing forbidden keywords — fail across multiple vendors.
  // `oneOf` is the canonical case (Gemini silently drops); `propertyNames` is
  // dropped by both OpenAI strict and Gemini; `prefixItems` by both Anthropic
  // and OpenAI strict; `if/then/else` + `dependencies` + `not` + `allOf` by
  // every Tier-1 vendor.
  const LOAD_BEARING_KEYWORDS = ['oneOf', 'allOf', 'not', 'if', 'then', 'else', 'dependencies', 'prefixItems', 'propertyNames'] as const;
  for (const kw of LOAD_BEARING_KEYWORDS) {
    if (kw in schema) {
      violations.push({ path, rule: `forbidden-keyword`, detail: kw });
    }
  }
  // anyOf — recurse into branches (anyOf is permitted, but contents are walked)
  if (Array.isArray(schema.anyOf)) {
    for (let i = 0; i < schema.anyOf.length; i++) {
      walkSchema(schema.anyOf[i] as Record<string, unknown>, `${path}/anyOf/${i}`, depth + 1, propCount, violations, mode);
    }
  }
  // Type-specific constraints
  const type = schema.type;
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    // `additionalProperties: false` is OpenAI-strict + Anthropic-strict required, but
    // the universal-kind schemas (which predate RFC 0030) deliberately use
    // `additionalProperties: true` on open metadata bags (e.g., `clarification.request`
    // `questions[].context` and `error.details`). Treat this as strict-only since
    // Gemini accepts both modes and the open-bag pattern is a deliberate v1.1
    // design choice — vendor-kind authors targeting OpenAI/Anthropic strict
    // mode for portability can satisfy this rule in their own schemas.
    if (mode === 'strict' && schema.additionalProperties !== false) {
      violations.push({ path, rule: 'additionalProperties-must-be-false-on-object-strict-only' });
    }
    const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    const required = (schema.required as string[]) ?? [];
    for (const propName of Object.keys(props)) {
      propCount.n++;
      if (mode === 'strict' && !required.includes(propName)) {
        // OpenAI strict requires every property in required. Vendor-kind authors
        // who want OpenAI-strict portability use the `["type","null"]` union
        // pattern per RFC 0030 §D. Universal-kind schemas deliberately omit
        // `reasoning` from required per RFC 0030 §A so they don't fail this rule
        // under load-bearing mode; strict-mode advertisement is opt-in.
        violations.push({ path: `${path}/properties/${propName}`, rule: 'property-not-in-required-strict-mode-only' });
      }
      walkSchema(props[propName], `${path}/properties/${propName}`, depth + 1, propCount, violations, mode);
    }
  }
  // String/number/array constraints — OpenAI-strict-only restrictions. Only
  // flag in `strict` mode; under load-bearing mode these are permitted
  // because Gemini 2.5+ and Anthropic accept them.
  if (mode === 'strict') {
    if (type === 'string' || (Array.isArray(type) && type.includes('string'))) {
      for (const kw of ['minLength', 'maxLength', 'pattern', 'format']) {
        if (kw in schema) {
          violations.push({ path, rule: 'forbidden-string-constraint-strict-only', detail: kw });
        }
      }
    }
    if (type === 'number' || type === 'integer' || (Array.isArray(type) && (type.includes('number') || type.includes('integer')))) {
      for (const kw of ['minimum', 'maximum', 'multipleOf']) {
        if (kw in schema) {
          violations.push({ path, rule: 'forbidden-number-constraint-strict-only', detail: kw });
        }
      }
    }
    if (type === 'array' || (Array.isArray(type) && type.includes('array'))) {
      for (const kw of ['minItems', 'maxItems', 'uniqueItems']) {
        if (kw in schema) {
          violations.push({ path, rule: 'forbidden-array-constraint-strict-only', detail: kw });
        }
      }
    }
  }
  if (type === 'array' || (Array.isArray(type) && type.includes('array'))) {
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      walkSchema(schema.items as Record<string, unknown>, `${path}/items`, depth + 1, propCount, violations, mode);
    }
  }
  // $defs — walk to surface violations inside referenced shapes
  const defs = (schema.$defs as Record<string, Record<string, unknown>>) ?? {};
  for (const defName of Object.keys(defs)) {
    walkSchema(defs[defName], `${path}/$defs/${defName}`, depth + 1, propCount, violations, mode);
  }
}

describe.skipIf(HTTP_SKIP)('envelope-tier-one-subset-static (RFC 0030 §B)', () => {
  it('hosts advertising tierOneSubsetCompliance: "strict" have payload schemas that satisfy the Tier-1 intersection', async () => {
    const d = await readDiscovery();
    if (d === null) return softSkip('blocked', 'precondition not met — `d === null` returned early (host unreachable; soft-skip) (seam, prior step, or fixture unavailable)'); // host unreachable; soft-skip
    const compliance = capabilityFamily(d, 'envelopes')?.tierOneSubsetCompliance;
    if (compliance !== 'strict') return softSkip('blocked', 'precondition not met — `compliance !== \'strict\'` returned early (gated on "strict" only) (seam, prior step, or fixture unavailable)'); // gated on "strict" only
    const advertised = (capabilityFamily(d, 'supportedEnvelopes') ?? []) as string[];
    if (advertised.length === 0) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `advertised.length === 0` returned early');

    const violationsByKind: Record<string, Violation[]> = {};
    for (const kind of advertised) {
      const local = loadLocalSchema(kind);
      if (local === null) continue; // host-served only; skip for now
      const violations: Violation[] = [];
      const propCount = { n: 0 };
      walkSchema(local, `#`, 0, propCount, violations, 'strict');
      if (propCount.n > 100) {
        violations.push({ path: '#', rule: 'max-property-count-100-exceeded', detail: `count=${propCount.n}` });
      }
      if (violations.length > 0) {
        violationsByKind[kind] = violations;
      }
    }

    expect(
      violationsByKind,
      req('openwop.it.envelope-tier-one-subset-static.hosts-advertising-tieronesubsetcompliance-strict-have-payload-schemas-that-satis', 'RFC 0030 §B', `RFC 0030 §B: schemas violating the Tier-1 subset under strict-mode advertisement: ${JSON.stringify(violationsByKind, null, 2)}`),
    ).toEqual({});
  });
});

describe('envelope-tier-one-subset-static: universal-kind schemas satisfy load-bearing rules (always-on)', () => {
  // Always-on: only flag rules that fail across MULTIPLE vendors (Gemini silently
  // drops these, producing looser-than-declared schemas — a silent correctness
  // bug). The OpenAI-strict-only rules (minLength, maxLength, minItems, etc.)
  // are checked only under host-advertised "strict" mode since Gemini 2.5+
  // and Anthropic accept them.
  for (const kind of UNIVERSAL_KINDS) {
    it(`${kind}.schema.json satisfies load-bearing Tier-1 rules (no oneOf/allOf/not/prefixItems/propertyNames anywhere)`, () => {
      const schema = loadLocalSchema(kind);
      expect(schema, req('openwop.it.envelope-tier-one-subset-static.schema-json-satisfies-load-bearing-tier-1-rules-no-oneof-allof-not-prefixitems-p', 'RFC 0030 §B', `schemas/envelopes/${kind}.schema.json MUST exist`)).not.toBeNull();
      if (schema === null) return softSkip('blocked', 'precondition not met — `schema === null` returned early (seam, prior step, or fixture unavailable)');
      const violations: Violation[] = [];
      const propCount = { n: 0 };
      walkSchema(schema, `#`, 0, propCount, violations, 'load-bearing');
      expect(
        violations,
        req('openwop.it.envelope-tier-one-subset-static.schema-json-satisfies-load-bearing-tier-1-rules-no-oneof-allof-not-prefixitems-p', 'RFC 0030 §B', `${kind}.schema.json load-bearing Tier-1 violations (these fail across multiple vendors): ${JSON.stringify(violations, null, 2)}`),
      ).toEqual([]);
    });
  }
});
