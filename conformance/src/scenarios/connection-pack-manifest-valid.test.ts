/**
 * Connection-pack manifest validity — `connection-packs.md` §Manifest clauses 1/3
 * + `schemas/connection-pack-manifest.schema.json` (RFC 0095 §A).
 *
 * Always-on, server-free schema probe. Exercises the new
 * `connection-pack-manifest.schema.json` with the canonical positive fixture
 * and the kind-discriminator negatives:
 *
 *   1. Positive: the `connection-pack-github` fixture (a complete `kind:
 *      "connection"` manifest, MCP reach) validates cleanly.
 *   2. Capability shape: `capabilities.schema.json` declares
 *      `connections.packsSupported` (RFC 0095 §C).
 *   3. Negative — kind discriminator: the same manifest with `kind: "node"`
 *      is rejected (`const` violation) — the discriminator routes a
 *      connection manifest away from the other pack schemas.
 *   4. Negative — kind/contents mixing: a manifest carrying BOTH `provider`
 *      AND `nodes[]` is rejected. Surface-level outcome at the registry is
 *      `pack_kind_invalid` per `node-packs.md` §"Pack kinds"; schema-level
 *      outcome is an `additionalProperties` violation on `nodes`.
 *   5. Negative — non-https token endpoint: `http://` is rejected with a
 *      `pattern` violation (clause 3).
 *   6. Positive — a SemVer prerelease `version` (`1.0.0-alpha.1`) is
 *      schema-VALID: prerelease *precedence* (clause 6, SemVer §11) is a
 *      host resolution concern, not a manifest-shape constraint.
 *   7. Positive — a string `provider.vendor` validates (RFC 0123 clause 16).
 *   8. Positive — a manifest OMITTING `provider.vendor` still validates
 *      (vendor is OPTIONAL — back-compat).
 *   9. Negative — a non-string `provider.vendor` (an array) is rejected.
 *
 * Behavioral resolution legs live in `connection-provider-resolution.test.ts`
 * (capability-gated on `capabilities.connections.packsSupported`).
 *
 * @see spec/v1/connection-packs.md
 * @see schemas/connection-pack-manifest.schema.json
 * @see RFCS/0095-connection-packs-portable-provider-definitions.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { SCHEMAS_DIR, FIXTURES_DIR } from '../lib/paths.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'connection-pack-manifest.schema.json');
const FIXTURE_PATH = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-github.json');

type Manifest = Record<string, unknown> & {
  provider: Record<string, unknown> & { auth: Record<string, unknown> };
};

function fixture(): Manifest {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Manifest;
}

describe('category: connection-pack manifest validation (RFC 0095 §A)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  const failsWith = (manifest: unknown, keyword: string): ErrorObject[] => {
    const ok = validate(manifest);
    expect(ok).toBe(false);
    return (validate.errors ?? []).filter((e) => e.keyword === keyword);
  };

  it('positive: the connection-pack-github fixture validates cleanly', () => {
    expect(
      validate(fixture()),
      `connection-packs.md §Manifest clause 1: a well-formed kind:"connection" manifest MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('capabilities.schema.json declares connections.packsSupported (RFC 0095 §C)', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as {
      properties?: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    };
    const connections = caps.properties?.connections;
    expect(connections, 'capabilities.md §connections — the connections block MUST be declared').toBeDefined();
    expect(
      connections?.properties?.packsSupported,
      'RFC 0095 §C — connections.packsSupported MUST be declared',
    ).toBeDefined();
  });

  it('negative: the kind discriminator routes other kinds away (kind: "node" rejected)', () => {
    const m = { ...fixture(), kind: 'node' };
    const errs = failsWith(m, 'const');
    expect(
      errs.length,
      'connection-packs.md §Manifest clause 1: kind MUST be the const "connection"',
    ).toBeGreaterThan(0);
  });

  it('negative: a manifest mixing provider and nodes[] is rejected (pack_kind_invalid at the registry)', () => {
    const m = {
      ...fixture(),
      nodes: [{ typeId: 'vendor.acme.x', version: '1.0.0', category: 'data', role: 'pure' }],
    };
    const errs = failsWith(m, 'additionalProperties');
    expect(
      errs.some((e) => (e.params as { additionalProperty?: string }).additionalProperty === 'nodes'),
      'node-packs.md §"Pack kinds": one kind per pack — a foreign `nodes[]` field MUST be rejected (additionalProperties:false)',
    ).toBe(true);
  });

  it('negative: a non-https token endpoint is rejected (clause 3)', () => {
    const m = fixture();
    (m.provider.auth.endpoints as Record<string, string>).token = 'http://example.com/token';
    const errs = failsWith(m, 'pattern');
    expect(
      errs.length,
      'connection-packs.md §Manifest clause 3: auth endpoints MUST be absolute https:// URLs',
    ).toBeGreaterThan(0);
  });

  it('positive: a SemVer prerelease version is schema-valid (precedence is a host concern, clause 6)', () => {
    const m = { ...fixture(), version: '1.0.0-alpha.1' };
    expect(
      validate(m),
      `connection-packs.md §Manifest clause 6: prerelease ordering is resolution-time SemVer §11, not manifest shape. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  // RFC 0123 — presentational provider.vendor grouping (§Manifest clause 16).
  it('positive: a provider.vendor string validates (RFC 0123)', () => {
    const m = fixture();
    m.provider.vendor = 'Google';
    expect(
      validate(m),
      `connection-packs.md §Manifest clause 16 (RFC 0123): a string provider.vendor MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('positive: a manifest OMITTING provider.vendor still validates (back-compat, RFC 0123)', () => {
    const m = fixture();
    expect('vendor' in m.provider, 'the base fixture omits vendor').toBe(false);
    expect(
      validate(m),
      `connection-packs.md §Manifest clause 16 (RFC 0123): vendor is OPTIONAL — a manifest without it MUST remain valid. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('negative: a non-string provider.vendor is rejected (RFC 0123)', () => {
    const m = fixture();
    (m.provider as Record<string, unknown>).vendor = ['Google'];
    const errs = failsWith(m, 'type');
    expect(
      errs.some((e) => e.instancePath === '/provider/vendor'),
      'connection-packs.md §Manifest clause 16 (RFC 0123): provider.vendor MUST be a string — an array MUST be rejected',
    ).toBe(true);
  });
});
