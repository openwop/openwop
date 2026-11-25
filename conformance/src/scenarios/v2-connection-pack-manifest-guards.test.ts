/**
 * `v2-connection-pack-manifest-guards` (target major 2; server-free) — the two
 * credential guards the v2 connection-pack manifest carries by construction.
 *
 * `spec/v2/core/connection-packs.md`: "The manifest is
 * `schemas/v2/connection-pack-manifest.schema.json`" — the v2 corpus states the
 * manifest's shape in the schema alone, so the schema IS the v2 rule, and a v2
 * host installing a pack validates against it. The v1 files
 * (`connection-pack-no-credential-material`, `connection-pack-apihosts`) compile
 * `schemas/connection-pack-manifest.schema.json` — the v1 tree — so a v2 schema
 * that re-admitted a secret-named field or a credential-egress host outside the
 * allow-list grammar would have passed every gate.
 *
 * Legs:
 *   1. `connection-packs.manifest-no-credential-material` (invariant
 *      `connection-pack-no-credential-material`) — every name on the normative
 *      minimum blocklist, injected at the manifest root, under `provider` and
 *      under `provider.auth`, is refused by the v2 schema; the one exemption,
 *      `provider.auth.endpoints.token` (the token-endpoint URL), validates.
 *   2. `connection-packs.api-host-shape` (invariant
 *      `connection-pack-api-host-shape`) — an `openapi`-reach provider declaring
 *      `apiHosts` validates; the same provider without `apiHosts` is refused;
 *      an `mcp`-reach provider MAY omit it; an IPv4 literal, a wildcard, a port,
 *      a single label, an uppercase entry, a scheme or a path is refused.
 *
 * The install-time refusal codes are host behaviour gated on
 * `connections.packsSupported` and a seam; no v2 seam installs a connection pack
 * today, so this file asserts the wire rule only (stated, not hidden).
 *
 * Sabotage (corpus, local): setting `additionalProperties: true` on
 * `provider.auth` in `schemas/v2/connection-pack-manifest.schema.json` fails
 * leg 1; dropping the `apiHosts` items `pattern` fails leg 2.
 *
 * @see spec/v2/core/connection-packs.md
 * @see SECURITY/invariants.yaml id: connection-pack-no-credential-material, connection-pack-api-host-shape
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../lib/paths.js';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/connection-packs.md; schemas/v2/connection-pack-manifest.schema.json';
const ID_CREDENTIAL = 'openwop.requirement.connection-packs.manifest-no-credential-material';
const ID_API_HOST = 'openwop.requirement.connection-packs.api-host-shape';
const BLOCKLIST = ['clientSecret', 'client_secret', 'apiKey', 'api_key', 'token', 'accessToken', 'refreshToken', 'password', 'privateKey', 'secret'];

type Manifest = Record<string, unknown> & { provider: Record<string, unknown> & { auth: Record<string, unknown> } };
const load = (name: string): Manifest => JSON.parse(readFileSync(join(FIXTURES_DIR, 'connection-packs', `${name}.json`), 'utf8')) as Manifest;
const validate = v2Validator('connection-pack-manifest');

describe('v2 connection-pack manifest guards (server-free)', () => {
  it('no credential-named member validates anywhere in the manifest; the token-endpoint URL does', () => {
    const base = load('connection-pack-github');
    const ok = validate(base);
    expect(ok.ok, req(ID_CREDENTIAL, DOC, `control: the github fixture MUST validate against the v2 manifest schema (${ok.errors})`)).toBe(true);
    expect(typeof (base.provider.auth['endpoints'] as Record<string, unknown> | undefined)?.['token'], req(ID_CREDENTIAL, DOC, 'control: the fixture declares provider.auth.endpoints.token')).toBe('string');
    for (const name of BLOCKLIST) {
      const atRoot = { ...load('connection-pack-github'), [name]: 'xxx' };
      const atProvider = load('connection-pack-github'); atProvider.provider[name] = 'xxx';
      const atAuth = load('connection-pack-github'); atAuth.provider.auth[name] = 'xxx';
      for (const [where, m] of [['root', atRoot], ['provider', atProvider], ['provider.auth', atAuth]] as const) {
        expect(validate(m).ok, req(ID_CREDENTIAL, DOC, `a member named "${name}" at ${where} MUST NOT validate — a connection pack carries no credential material`)).toBe(false);
      }
    }
  });

  it('apiHosts is required for openapi reach and admits only bare lowercase registrable hostnames', () => {
    const good = load('connection-pack-apihosts-valid');
    expect(validate(good).ok, req(ID_API_HOST, DOC, `an openapi-reach provider declaring apiHosts MUST validate (${validate(good).errors})`)).toBe(true);
    const missing = load('connection-pack-apihosts-valid'); delete missing.provider['apiHosts'];
    expect(validate(missing).ok, req(ID_API_HOST, DOC, 'an openapi-reach provider that omits apiHosts MUST be refused')).toBe(false);
    const mcp = load('connection-pack-github');
    expect(mcp.provider['apiHosts'] === undefined && validate(mcp).ok, req(ID_API_HOST, DOC, 'an mcp-reach provider MAY omit apiHosts')).toBe(true);
    for (const bad of ['127.0.0.1', '10.0.0.1', '*.facebook.com', 'graph.facebook.com:8443', 'facebook', 'Facebook.com', 'https://facebook.com', 'facebook.com/api']) {
      const m = load('connection-pack-apihosts-valid'); m.provider['apiHosts'] = [bad];
      expect(validate(m).ok, req(ID_API_HOST, DOC, `apiHosts entry "${bad}" MUST be refused — an entry is a bare, lowercase hostname of two or more labels with an alphabetic TLD`)).toBe(false);
    }
  });
});
