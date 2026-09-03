/**
 * identity-owner-shape — RFC 0048 §C verification.
 *
 * Status: DRAFT. RFC 0048 (tenant·workspace·principal identity model) is
 * `Draft`. The optional `RunSnapshot.owner` triple has landed in
 * `schemas/run-snapshot.schema.json`.
 *
 * Server-free schema validation of the owner triple:
 *   - Positive: `{ tenant }` and `{ tenant, workspace, principal }` validate.
 *   - Negative: missing `tenant` (required), or an unknown property, is rejected.
 *
 * The owner subschema referenced only itself until RFC 0165 added an optional
 * `subject` member ($ref subject.schema.json); that schema is registered on the
 * ajv instance so the owner subschema still compiles standalone.
 *
 * @see RFCS/0048-tenant-workspace-principal-identity-model.md
 * @see schemas/run-snapshot.schema.json properties.owner
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

interface SnapshotSchema {
  $schema: string;
  $id: string;
  properties: { owner?: Record<string, unknown> };
}

const snapshot = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'run-snapshot.schema.json'), 'utf8'),
) as SnapshotSchema;

describe('category: identity owner-triple shape (RFC 0048 §C)', () => {
  it('run-snapshot.schema.json defines an optional owner triple', () => {
    expect(
      snapshot.properties.owner,
      req('openwop.it.identity-owner-shape.run-snapshot-schema-json-defines-an-optional-owner-triple', 'RFC 0048 §C', 'RFC 0048 §C: RunSnapshot MUST define an optional `owner` object'),
    ).toBeDefined();
  });

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'subject.schema.json'), 'utf8')) as Record<string, unknown>);
  // `$id` is the base the relative `subject.schema.json` $ref (RFC 0165) resolves against.
  const ownerSchema = { $schema: snapshot.$schema, $id: snapshot.$id, ...(snapshot.properties.owner as Record<string, unknown>) };
  const validate = ajv.compile(ownerSchema);

  it('positive: tenant-only owner validates', () => {
    expect(validate({ tenant: 'acme' }), req('openwop.it.identity-owner-shape.positive-tenant-only-owner-validates', 'RFC 0048 §C', JSON.stringify(validate.errors))).toBe(true);
  });

  it('positive: full triple validates', () => {
    expect(
      validate({ tenant: 'acme', workspace: 'ws-eng', principal: 'user_42' }),
      req('openwop.it.identity-owner-shape.positive-full-triple-validates', 'RFC 0048 §C', JSON.stringify(validate.errors)),
    ).toBe(true);
  });

  it('negative: owner missing tenant is rejected (tenant is required)', () => {
    expect(validate({ workspace: 'ws-eng' }), req('openwop.it.identity-owner-shape.negative-owner-missing-tenant-is-rejected-tenant-is-required', 'RFC 0048 §C', 'negative: owner missing tenant is rejected (tenant is required)')).toBe(false);
  });

  it('negative: unknown owner property is rejected (additionalProperties:false)', () => {
    expect(validate({ tenant: 'acme', role: 'admin' }), req('openwop.it.identity-owner-shape.negative-unknown-owner-property-is-rejected-additionalproperties-false', 'RFC 0048 §C', 'negative: unknown owner property is rejected (additionalProperties:false)')).toBe(false);
  });
});
