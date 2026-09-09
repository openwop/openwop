/**
 * Pack runtime-requirements vocabulary + shape — `node-packs.md`
 * §"Runtime platform requirements" + `schemas/node-pack-manifest.schema.json`
 * `$defs/Runtime.requires` (RFC 0076 §A).
 *
 * Server-free schema-validation scenario. The `runtime.requires[]` field is an
 * OPTIONAL, closed, runtime-agnostic vocabulary a pack uses to declare the
 * platform primitives its code exercises, so a sandbox host can gate at install
 * time instead of trial-load. This file exercises the schema layer (the §A
 * "vocabulary-validation" normative behavior — a raw builtin name is rejected —
 * plus the additive/empty-array shape contract):
 *
 *   1. Positive: a manifest declaring valid primitives validates cleanly.
 *   2. Positive: the field is OPTIONAL — a manifest omitting it validates.
 *   3. Positive: an empty array (`requires: []`) validates and is equivalent to
 *      omission (no host may read a distinct meaning into it; §A).
 *   4. Positive: every one of the 8 vocabulary tokens individually validates.
 *   5. Negative — raw builtin name: `"node:dns/promises"` (the value that
 *      motivated the abstract vocabulary) is rejected; the registry/host
 *      surfaces this as `invalid_manifest`.
 *   6. Negative — duplicate token: `uniqueItems` is enforced.
 *
 * The install-time GATE behavior (grant / refuse → `pack_runtime_requirement_unmet`,
 * and the non-sandbox-host SHOULD-projection) is host behavior and lives in the
 * seam-gated `runtime-requires-install-gate.test.ts`.
 *
 * @see spec/v1/node-packs.md §"Runtime platform requirements"
 * @see spec/v1/registry-operations.md §"Runtime-requirement install gate"
 * @see schemas/node-pack-manifest.schema.json
 * @see RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'node-pack-manifest.schema.json');

const VOCABULARY = [
  'net.dns',
  'net.outbound',
  'crypto',
  'subprocess',
  'fs.read',
  'fs.write',
  'env.read',
  'clock',
] as const;

function manifest(requires?: unknown) {
  const runtime: Record<string, unknown> = { language: 'javascript', entry: 'index.mjs' };
  if (requires !== undefined) runtime.requires = requires;
  return {
    name: 'vendor.example.http',
    version: '1.0.0',
    engines: { openwop: '>=1.1 <2.0.0' },
    runtime,
    nodes: [{ typeId: 'vendor.example.http.fetch', version: '1.0.0', category: 'integration', role: 'side-effect' }],
  };
}

describe('category: runtime.requires vocabulary + shape (RFC 0076 §A)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Register every schema first so cross-$refs resolve (node-pack-manifest
  // references agent-manifest.schema.json for its agents[] branch). addSchema
  // registers without compiling; the target compiles below.
  for (const file of readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith('.schema.json')) continue;
    try {
      ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8')) as Record<string, unknown>);
    } catch {
      /* duplicate/already-registered — the target is compiled below */
    }
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = (ajv.getSchema(schema['$id'] as string) ?? ajv.compile(schema)) as ValidateFunction;

  const errorsOn = (m: unknown): ErrorObject[] => {
    expect(validate(m)).toBe(false);
    return validate.errors ?? [];
  };

  it('positive: a manifest declaring valid primitives validates cleanly', () => {
    const ok = validate(manifest(['net.dns', 'net.outbound']));
    expect(
      ok,
      req('openwop.it.runtime-requires-shape.positive-a-manifest-declaring-valid-primitives-validates-cleanly', 'node-packs.md', `node-packs.md §"Runtime platform requirements": a well-formed runtime.requires MUST validate. Errors: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('positive: runtime.requires is OPTIONAL — a manifest omitting it validates (additive)', () => {
    expect(
      validate(manifest(undefined)),
      req('openwop.it.runtime-requires-shape.positive-runtime-requires-is-optional-a-manifest-omitting-it-validates-additive', 'node-packs.md', 'node-pack-manifest.schema.json: runtime.requires is additive/OPTIONAL — packs predating RFC 0076 validate unchanged'),
    ).toBe(true);
  });

  it('positive: an empty requires[] validates (equivalent to omission per §A)', () => {
    expect(
      validate(manifest([])),
      req('openwop.it.runtime-requires-shape.positive-an-empty-requires-validates-equivalent-to-omission-per-a', 'node-packs.md', 'node-packs.md §"Runtime platform requirements": runtime.requires:[] is valid and equivalent to omission'),
    ).toBe(true);
  });

  it('positive: every vocabulary token individually validates', () => {
    for (const token of VOCABULARY) {
      expect(
        validate(manifest([token])),
        req('openwop.it.runtime-requires-shape.positive-every-vocabulary-token-individually-validates', 'node-packs.md', `node-pack-manifest.schema.json: "${token}" is in the RFC 0076 §A vocabulary. Errors: ${JSON.stringify(validate.errors)}`),
      ).toBe(true);
    }
  });

  it('negative: a raw builtin name (node:dns/promises) is rejected (→ invalid_manifest)', () => {
    const errs = errorsOn(manifest(['node:dns/promises']));
    expect(
      errs.some((e) => e.instancePath.includes('/runtime/requires')),
      req('openwop.it.runtime-requires-shape.negative-a-raw-builtin-name-node-dns-promises-is-rejected-invalid-manifest', 'node-packs.md', 'node-packs.md §"Runtime platform requirements": raw language builtin names are NOT in the closed vocabulary — the abstract net.dns is the portable equivalent; the registry/host surfaces this as invalid_manifest'),
    ).toBe(true);
  });

  it('negative: a duplicate token is rejected (uniqueItems)', () => {
    const errs = errorsOn(manifest(['net.dns', 'net.dns']));
    expect(
      errs.some((e) => e.keyword === 'uniqueItems'),
      req('openwop.it.runtime-requires-shape.negative-a-duplicate-token-is-rejected-uniqueitems', 'node-packs.md', 'node-pack-manifest.schema.json: runtime.requires has uniqueItems:true'),
    ).toBe(true);
  });
});
