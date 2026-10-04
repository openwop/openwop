/**
 * Static walkers over envelope payload schemas, shared by the v2 static twins
 * `v2-envelope-tier-one-subset-static` and `v2-envelope-variant-discriminator-static`.
 *
 * The walk rules are the v1 rules unchanged (RFC 0030 §B, RFC 0031 §A); what
 * moved at major 2 is where the schemas live (`schemas/v2/envelopes/`) and
 * where a host's kind catalog is advertised (`supportedEnvelopes.kinds`, a
 * family record, instead of a root `string[]`).
 *
 * Every function here is pure and is proven in both directions in
 * `envelope-schema-static.test.ts`: a conforming schema yields no violation,
 * and each defect yields the one it names.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from './paths.js';

export interface SchemaViolation { readonly path: string; readonly rule: string; readonly detail?: string }

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The v2 envelope payload schema directory. */
export const V2_ENVELOPES_DIR = join(SCHEMAS_DIR, 'v2', 'envelopes');

/** The four kinds every engine recognizes (`events.md` §"AI envelopes"). */
export const UNIVERSAL_KINDS = ['clarification.request', 'schema.request', 'schema.response', 'error'] as const;

/** A v2 envelope payload schema by kind, or `null` when the corpus has none. */
export function loadV2EnvelopeSchema(kind: string): Record<string, unknown> | null {
  const p = join(V2_ENVELOPES_DIR, `${kind}.schema.json`);
  if (!existsSync(p)) return null;
  const v: unknown = JSON.parse(readFileSync(p, 'utf8'));
  return isRecord(v) ? v : null;
}

/** Every kind with a payload schema under `schemas/v2/envelopes/`. */
export function listV2EnvelopeKinds(): string[] {
  if (!existsSync(V2_ENVELOPES_DIR)) return [];
  return readdirSync(V2_ENVELOPES_DIR).filter((f) => f.endsWith('.schema.json')).map((f) => f.replace(/\.schema\.json$/, '')).sort();
}

// ---------------------------------------------------------------------------
// RFC 0030 §B — the Tier-1 structured-output subset.
// ---------------------------------------------------------------------------

/** Keywords that fail across more than one Tier-1 vendor (Gemini drops `oneOf` silently). Checked in both modes. */
const LOAD_BEARING_KEYWORDS = ['oneOf', 'allOf', 'not', 'if', 'then', 'else', 'dependencies', 'prefixItems', 'propertyNames'] as const;
export const MAX_DEPTH = 5;
export const MAX_PROPERTIES = 100;

const hasType = (schema: Record<string, unknown>, t: string): boolean => schema['type'] === t || (Array.isArray(schema['type']) && (schema['type'] as unknown[]).includes(t));

/**
 * Walk a payload schema for Tier-1 subset violations.
 *
 * `load-bearing`: only the rules that fail across several vendors — the floor
 * every corpus schema is held to. `strict`: every rule of the OpenAI-strict ∩
 * Anthropic-strict ∩ Gemini intersection, applied only when a host advertises
 * `envelopes.tierOneSubsetCompliance: "strict"`.
 */
export function tierOneViolations(schema: Record<string, unknown>, mode: 'load-bearing' | 'strict'): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  const count = { n: 0 };
  walkTierOne(schema, '#', 0, count, out, mode);
  if (count.n > MAX_PROPERTIES) out.push({ path: '#', rule: 'max-property-count-100-exceeded', detail: `count=${count.n}` });
  return out;
}

function walkTierOne(schema: Record<string, unknown>, path: string, depth: number, count: { n: number }, out: SchemaViolation[], mode: 'load-bearing' | 'strict'): void {
  if (depth > MAX_DEPTH) { out.push({ path, rule: 'max-nesting-depth-5', detail: `depth=${depth}` }); return; }
  for (const kw of LOAD_BEARING_KEYWORDS) if (kw in schema) out.push({ path, rule: 'forbidden-keyword', detail: kw });
  if (Array.isArray(schema['anyOf'])) {
    (schema['anyOf'] as unknown[]).forEach((b, i) => { if (isRecord(b)) walkTierOne(b, `${path}/anyOf/${i}`, depth + 1, count, out, mode); });
  }
  if (hasType(schema, 'object')) {
    if (mode === 'strict' && schema['additionalProperties'] !== false) out.push({ path, rule: 'additionalProperties-must-be-false-on-object-strict-only' });
    const props = isRecord(schema['properties']) ? schema['properties'] : {};
    const required = Array.isArray(schema['required']) ? (schema['required'] as unknown[]) : [];
    for (const [name, sub] of Object.entries(props)) {
      count.n++;
      if (mode === 'strict' && !required.includes(name)) out.push({ path: `${path}/properties/${name}`, rule: 'property-not-in-required-strict-mode-only' });
      if (isRecord(sub)) walkTierOne(sub, `${path}/properties/${name}`, depth + 1, count, out, mode);
    }
  }
  if (mode === 'strict') {
    const bounded: Array<[boolean, readonly string[], string]> = [
      [hasType(schema, 'string'), ['minLength', 'maxLength', 'pattern', 'format'], 'forbidden-string-constraint-strict-only'],
      [hasType(schema, 'number') || hasType(schema, 'integer'), ['minimum', 'maximum', 'multipleOf'], 'forbidden-number-constraint-strict-only'],
      [hasType(schema, 'array'), ['minItems', 'maxItems', 'uniqueItems'], 'forbidden-array-constraint-strict-only'],
    ];
    for (const [applies, kws, rule] of bounded) if (applies) for (const kw of kws) if (kw in schema) out.push({ path, rule, detail: kw });
  }
  if (hasType(schema, 'array') && isRecord(schema['items'])) walkTierOne(schema['items'], `${path}/items`, depth + 1, count, out, mode);
  const defs = isRecord(schema['$defs']) ? schema['$defs'] : {};
  for (const [name, sub] of Object.entries(defs)) if (isRecord(sub)) walkTierOne(sub, `${path}/$defs/${name}`, depth + 1, count, out, mode);
}

// ---------------------------------------------------------------------------
// RFC 0031 §A — variant payloads: no `oneOf`; every `anyOf` branch discriminated.
// ---------------------------------------------------------------------------

/** `oneOf` anywhere in a payload schema. */
export function oneOfViolations(schema: unknown, path = '#'): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  const walk = (s: unknown, p: string): void => {
    if (Array.isArray(s)) { s.forEach((x, i) => walk(x, `${p}/${i}`)); return; }
    if (!isRecord(s)) return;
    if ('oneOf' in s) out.push({ path: p, rule: 'oneOf-forbidden', detail: 'use anyOf with a single-string-enum discriminator (RFC 0031 §A)' });
    for (const [k, v] of Object.entries(s)) walk(v, `${p}/${k}`);
  };
  walk(schema, path);
  return out;
}

/**
 * A branch is discriminated when one of its `required` properties is
 * `type: string` with an `enum` of exactly one value. A `$ref` branch is
 * accepted unresolved, as at v1: the referenced shape is walked where it is
 * defined, and a version-selected union (one branch per `schemaVersion`, as
 * `ui.a2ui-surface` declares) is not a payload-field discrimination at all.
 */
export function branchDiscriminated(branch: unknown): boolean {
  if (!isRecord(branch)) return false;
  if ('$ref' in branch) return true;
  const required = Array.isArray(branch['required']) ? (branch['required'] as unknown[]) : [];
  const props = isRecord(branch['properties']) ? branch['properties'] : {};
  return required.some((name) => {
    const p = typeof name === 'string' ? props[name] : undefined;
    return isRecord(p) && p['type'] === 'string' && Array.isArray(p['enum']) && (p['enum'] as unknown[]).length === 1;
  });
}

/** Whether a branch can match a JSON object: an explicit object type, a `$ref`, or object keywords with no type. */
function admitsObject(branch: unknown): boolean {
  if (!isRecord(branch)) return false;
  if ('$ref' in branch) return true;
  const t = branch['type'];
  if (t === undefined) return 'properties' in branch || 'required' in branch;
  return t === 'object' || (Array.isArray(t) && t.includes('object'));
}

/**
 * Every `anyOf` branch, at any depth, that carries no single-string-enum
 * discriminator — in a VARIANT union, one where two or more branches can be
 * objects. A union with at most one object branch (`string | binding`,
 * `string | number | boolean | array | binding`, as `ui.a2ui-surface`
 * payload v2 declares) is a type union: JSON type alone selects the branch, no
 * field is inspected, and a scalar branch has no property to discriminate on.
 * RFC 0031 §A governs variant payloads; it is not read as forbidding these.
 */
export function anyOfDiscriminatorViolations(schema: unknown, path = '#'): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  const walk = (s: unknown, p: string): void => {
    if (Array.isArray(s)) { s.forEach((x, i) => walk(x, `${p}/${i}`)); return; }
    if (!isRecord(s)) return;
    if (Array.isArray(s['anyOf']) && (s['anyOf'] as unknown[]).filter(admitsObject).length >= 2) {
      (s['anyOf'] as unknown[]).forEach((b, i) => {
        if (admitsObject(b) && !branchDiscriminated(b)) out.push({ path: `${p}/anyOf/${i}`, rule: 'anyOf-branch-missing-discriminator', detail: 'a branch MUST declare a single-string-enum discriminator property in required (RFC 0031 §A)' });
      });
    }
    for (const [k, v] of Object.entries(s)) walk(v, `${p}/${k}`);
  };
  walk(schema, path);
  return out;
}
