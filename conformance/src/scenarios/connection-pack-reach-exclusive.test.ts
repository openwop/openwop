/**
 * Connection-pack reach exclusivity — `connection-packs.md` §Manifest clause 5
 * (RFC 0095 §B.5).
 *
 * Always-on, server-free schema probe. `provider.reach` MUST specify exactly
 * ONE of `mcp` / `openapi` / `integration` — the schema pins this with
 * `minProperties: 1` + `maxProperties: 1` + `additionalProperties: false`:
 *
 *   1. Positive: each of the three reach modes validates alone.
 *   2. Negative — two modes (`mcp` + `openapi`) → `maxProperties` violation.
 *   3. Negative — zero modes (`reach: {}`) → `minProperties` violation.
 *   4. Negative — an unknown mode (`grpc`) → `additionalProperties` violation.
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

const MCP = { mcp: { server: { url: 'https://api.githubcopilot.com/mcp/', transport: 'http' } } };
const OPENAPI = { openapi: { ref: 'https://api.github.com/openapi.json' } };
const INTEGRATION = { integration: { node: 'core.openwop.integration.github' } };

type Manifest = Record<string, unknown> & { provider: Record<string, unknown> };

function withReach(reach: Record<string, unknown>): Manifest {
  const m = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Manifest;
  m.provider.reach = reach;
  // openapi reach REQUIRES provider.apiHosts (RFC 0120 §A, schema
  // provider/allOf/0/then/required); other modes MUST NOT carry it. Set it here
  // so the manifest validates against a live corpus root, not just the vendored
  // snapshot. (Suite defect, fixed 2026-08-09.)
  if ('openapi' in reach) m.provider.apiHosts = ['api.github.com'];
  else delete m.provider.apiHosts;
  return m;
}

describe('connection-pack-reach-exclusive (RFC 0095 §B.5)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));

  const failsWith = (manifest: unknown, keyword: string): ErrorObject[] => {
    const ok = validate(manifest);
    expect(ok).toBe(false);
    return (validate.errors ?? []).filter((e) => e.keyword === keyword);
  };

  it('positive: each reach mode validates alone', () => {
    for (const reach of [MCP, OPENAPI, INTEGRATION]) {
      expect(
        validate(withReach(reach)),
        `connection-packs.md §Manifest clause 5: a single reach mode (${Object.keys(reach)[0]}) MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }
  });

  it('negative: two reach modes are rejected (maxProperties:1)', () => {
    const errs = failsWith(withReach({ ...MCP, ...OPENAPI }), 'maxProperties');
    expect(
      errs.length,
      'connection-packs.md §Manifest clause 5: reach MUST specify exactly one of mcp/openapi/integration',
    ).toBeGreaterThan(0);
  });

  it('negative: an empty reach is rejected (minProperties:1)', () => {
    const errs = failsWith(withReach({}), 'minProperties');
    expect(
      errs.length,
      'connection-packs.md §Manifest clause 5: reach MUST declare a mode — an empty object is invalid',
    ).toBeGreaterThan(0);
  });

  it('negative: an unknown reach mode is rejected (additionalProperties:false)', () => {
    const errs = failsWith(withReach({ grpc: { url: 'https://example.com' } }), 'additionalProperties');
    expect(
      errs.some((e) => (e.params as { additionalProperty?: string }).additionalProperty === 'grpc'),
      'connection-packs.md §Manifest clause 5: the reach vocabulary is closed (mcp | openapi | integration)',
    ).toBe(true);
  });
});
