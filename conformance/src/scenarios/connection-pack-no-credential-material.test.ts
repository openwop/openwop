/**
 * Connection packs carry NO credential material — `connection-packs.md`
 * §Manifest clause 2 (RFC 0095 §B.2). Public test for the protocol-tier
 * SECURITY invariant `connection-pack-no-credential-material`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema probe — every name on the normative
 *      minimum blocklist (`clientSecret`, `client_secret`, `apiKey`,
 *      `api_key`, `token`, `accessToken`, `refreshToken`, `password`,
 *      `privateKey`, `secret`), injected at the manifest root, under
 *      `provider`, and under `provider.auth`, is rejected by
 *      `connection-pack-manifest.schema.json` (`additionalProperties:false`
 *      everywhere — the schema layer never admits a secret-named field).
 *      The single normative EXEMPTION — the property named `token` at
 *      exactly `provider.auth.endpoints.token` (the OAuth token-endpoint
 *      URL) — IS schema-valid.
 *
 *   B. Capability-gated behavioral leg — on a host advertising
 *      `capabilities.connections.packsSupported: true` that exposes the
 *      `POST /v1/host/sample/connection-packs/install` test seam
 *      (`host-sample-test-seams.md`), installing a manifest that carries
 *      `clientSecret` MUST be rejected with the SPECIFIC error code
 *      `connection_pack_credential_material` — not a generic schema-shape
 *      error — because clause 2 requires the credential-material scan to
 *      run BEFORE generic schema validation. Hosts without the seam
 *      soft-skip (404); unadvertised hosts skip via the behavior gate.
 *
 * @see spec/v1/connection-packs.md
 * @see SECURITY/invariants.yaml id: connection-pack-no-credential-material
 * @see RFCS/0095-connection-packs-portable-provider-definitions.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'connection-pack-manifest.schema.json');
const FIXTURE_PATH = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-github.json');

const BLOCKLIST = [
  'clientSecret',
  'client_secret',
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'privateKey',
  'secret',
] as const;

type Manifest = Record<string, unknown> & {
  provider: Record<string, unknown> & { auth: Record<string, unknown> };
};

function fixture(): Manifest {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Manifest;
}

describe('connection-pack-no-credential-material: schema layer (always-on, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));

  it('every blocklisted property name is schema-rejected at the root, provider, and auth levels', () => {
    for (const name of BLOCKLIST) {
      const atRoot = { ...fixture(), [name]: 'xxx' };
      const atProvider = fixture();
      (atProvider.provider as Record<string, unknown>)[name] = 'xxx';
      const atAuth = fixture();
      (atAuth.provider.auth as Record<string, unknown>)[name] = 'xxx';
      for (const [where, m] of [['root', atRoot], ['provider', atProvider], ['provider.auth', atAuth]] as const) {
        expect(
          validate(m),
          `SECURITY invariant connection-pack-no-credential-material — a property named "${name}" at ${where} MUST NOT validate (additionalProperties:false)`,
        ).toBe(false);
      }
    }
  });

  it('the exemption: provider.auth.endpoints.token (the token-endpoint URL) IS valid', () => {
    const m = fixture();
    expect(
      typeof (m.provider.auth.endpoints as Record<string, string>).token,
      'fixture sanity — the github fixture declares the token endpoint',
    ).toBe('string');
    expect(
      validate(m),
      `connection-packs.md §Manifest clause 2 — the property named "token" at exactly provider.auth.endpoints.token is the OAuth token-endpoint URL and MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });
});

describe('connection-pack-no-credential-material: specific rejection code (capability-gated, RFC 0095 §B.2)', () => {
  it('installing a manifest carrying clientSecret is rejected with connection_pack_credential_material', async () => {
    const connections = await readCapabilityFamily<{ packsSupported?: boolean }>('connections');
    if (!behaviorGate('connections.packsSupported', connections?.packsSupported === true)) return;

    const leaky = fixture();
    (leaky.provider.auth as Record<string, unknown>).clientSecret = 'ghs_conformance_canary';
    const res = await driver.post('/v1/host/sample/connection-packs/install', { manifest: leaky });
    if (res.status === 404 || res.status === 403) return; // seam unwired — soft-skip

    const body = res.json as { installed?: boolean; errors?: Array<{ code?: string }> } | undefined;
    expect(
      body?.installed,
      driver.describe('connection-packs.md §Manifest clause 2', 'a manifest carrying credential material MUST NOT install'),
    ).toBe(false);
    expect(
      (body?.errors ?? []).some((e) => e.code === 'connection_pack_credential_material'),
      driver.describe(
        'connection-packs.md §Manifest clause 2',
        'the credential-material scan runs BEFORE generic schema validation — the SPECIFIC code connection_pack_credential_material MUST surface, not a generic shape error',
      ),
    ).toBe(true);
  });
});
