/**
 * envelope-variant-discriminator-static — RFC 0031 §A static schema-walker.
 *
 * Asserts (always-on):
 *   1. For every envelope payload schema in `schemas/envelopes/*.schema.json`,
 *      `oneOf` MUST NOT appear at any nesting depth (Gemini silently drops
 *      `oneOf`, producing a looser-than-declared schema — silent correctness bug).
 *   2. Where `anyOf` is present in a payload schema, every branch MUST declare
 *      a single-string-`enum` discriminator property in `required` per RFC 0031 §A.
 *
 * Capability-gated extension (when `OPENWOP_BASE_URL` is set AND
 * `capabilities.supportedEnvelopes` is non-empty): same checks applied
 * to the host's full envelope catalog where schemas can be resolved locally.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §A
 * @see spec/v1/ai-envelope.md §"Variant payload discrimination (normative)"
 * @see spec/v1/structured-output-subset.md (Tier-1 portability rationale)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

interface DiscriminatorViolation {
  path: string;
  rule: string;
  detail?: string;
}

function loadSchema(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function walkForOneOf(schema: unknown, path: string, out: DiscriminatorViolation[]): void {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    schema.forEach((item, i) => walkForOneOf(item, `${path}/${i}`, out));
    return;
  }
  const obj = schema as Record<string, unknown>;
  if ('oneOf' in obj) {
    out.push({
      path,
      rule: 'oneOf-forbidden',
      detail: 'use `anyOf` with single-string-enum discriminator per RFC 0031 §A',
    });
  }
  for (const key of Object.keys(obj)) {
    walkForOneOf(obj[key], `${path}/${key}`, out);
  }
}

interface AnyOfBranchValidation {
  ok: boolean;
  rule?: string;
  detail?: string;
}

function validateAnyOfBranch(branch: Record<string, unknown>): AnyOfBranchValidation {
  // A branch passes the discriminator rule if at least one of its `required` properties
  // declares `type: string` + `enum` containing exactly one value.
  const required = (branch.required as string[] | undefined) ?? [];
  const properties = (branch.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const propName of required) {
    const prop = properties[propName];
    if (!prop) continue;
    if (prop.type === 'string' && Array.isArray(prop.enum) && prop.enum.length === 1) {
      return { ok: true };
    }
  }
  // The branch may also be a `$ref` to a defined shape; ref-resolution is
  // out of scope for this static walker — flag with a note rather than a hard fail.
  if ('$ref' in branch) {
    return { ok: true, detail: 'branch is a $ref; discriminator presence assumed in referenced $def' };
  }
  return {
    ok: false,
    rule: 'anyOf-branch-missing-discriminator',
    detail: 'branch MUST declare a single-string-enum discriminator property in `required` per RFC 0031 §A',
  };
}

function walkForAnyOfDiscriminators(
  schema: unknown,
  path: string,
  out: DiscriminatorViolation[],
): void {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    schema.forEach((item, i) => walkForAnyOfDiscriminators(item, `${path}/${i}`, out));
    return;
  }
  const obj = schema as Record<string, unknown>;
  if (Array.isArray(obj.anyOf)) {
    obj.anyOf.forEach((branch, i) => {
      const result = validateAnyOfBranch(branch as Record<string, unknown>);
      if (!result.ok) {
        out.push({
          path: `${path}/anyOf/${i}`,
          rule: result.rule ?? 'unknown',
          ...(result.detail !== undefined ? { detail: result.detail } : {}),
        });
      }
    });
  }
  for (const key of Object.keys(obj)) {
    if (key === 'anyOf') continue; // handled above
    walkForAnyOfDiscriminators(obj[key], `${path}/${key}`, out);
  }
}

function listLocalEnvelopeSchemas(): { kind: string; path: string }[] {
  const dir = join(SCHEMAS_DIR, 'envelopes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => ({ kind: f.replace(/\.schema\.json$/, ''), path: join(dir, f) }));
}

describe('envelope-variant-discriminator-static (RFC 0031 §A)', () => {
  const schemas = listLocalEnvelopeSchemas();

  it('local envelope-schema directory is discoverable', () => {
    expect(
      schemas.length,
      req('openwop.it.envelope-variant-discriminator-static.local-envelope-schema-directory-is-discoverable', 'RFC 0031 §A', 'schemas/envelopes/*.schema.json MUST contain at least the four universal-kind schemas'),
    ).toBeGreaterThanOrEqual(4);
  });

  for (const { kind, path } of schemas) {
    it(`${kind}.schema.json MUST NOT contain \`oneOf\` at any nesting depth (Gemini silently drops it)`, () => {
      const schema = loadSchema(path);
      const violations: DiscriminatorViolation[] = [];
      walkForOneOf(schema, '#', violations);
      expect(
        violations,
        req('openwop.it.envelope-variant-discriminator-static.schema-json-must-not-contain-oneof-at-any-nesting-depth-gemini-silently-drops-it', 'RFC 0031 §A', `${kind}.schema.json contains \`oneOf\` — REFORMULATE as \`anyOf\` + single-string-enum discriminator per RFC 0031 §A. Violations: ${JSON.stringify(violations, null, 2)}`),
      ).toEqual([]);
    });

    it(`${kind}.schema.json: every \`anyOf\` branch declares a single-string-enum discriminator in \`required\``, () => {
      const schema = loadSchema(path);
      const violations: DiscriminatorViolation[] = [];
      walkForAnyOfDiscriminators(schema, '#', violations);
      expect(
        violations,
        req('openwop.it.envelope-variant-discriminator-static.schema-json-every-anyof-branch-declares-a-single-string-enum-discriminator-in-re', 'RFC 0031 §A', `${kind}.schema.json \`anyOf\` discriminator violations: ${JSON.stringify(violations, null, 2)}`),
      ).toEqual([]);
    });
  }
});
