/**
 * Connection-pack `provider.apiHosts` — credential-egress allow-list
 * (RFC 0120; `connection-packs.md` §Manifest items 10–15 +
 * `schemas/connection-pack-manifest.schema.json`).
 *
 * Public tests for two SECURITY invariants:
 *   - `connection-pack-api-host-shape`     (always-on, server-free schema legs)
 *   - `connection-pack-egress-host-bound`  (server-free matching-rule legs +
 *                                            capability-gated behavioral leg)
 *
 * Legs:
 *   A. Schema (always-on, server-free) — exercises the new `provider.apiHosts`
 *      property + the provider-level `allOf` conditional MUST:
 *        1. Positive: the `connection-pack-apihosts-valid` fixture (an
 *           `openapi`-reach provider declaring `apiHosts:["facebook.com"]`)
 *           validates.
 *        2. Conditional MUST (item 13 / §A allOf): an `openapi`-reach provider
 *           that OMITS `apiHosts` is rejected (`required`).
 *        3. Omission OK off the conditional: an `mcp`-reach provider without
 *           `apiHosts` validates (the github fixture).
 *        4. Entry shape (item 11): IPv4 literal, wildcard, port-bearing,
 *           single-label, and uppercase entries are each rejected (`pattern`).
 *   B. Matching rule (always-on, server-free) — asserts the item-10 dot-anchored
 *      eTLD+1 suffix-containment rule + the no-substring-escape property that the
 *      `connection-pack-egress-host-bound` invariant rests on.
 *   C. Behavioral egress allow-list (capability-gated) — drives a host
 *      advertising `connections.packsSupported` through the
 *      `POST /v1/host/sample/connection-packs/egress-check` seam
 *      (`host-sample-test-seams.md` §10): a credential-bearing egress to a host
 *      matching `apiHosts` is PERMITTED; one that does not is FAIL-CLOSED, with
 *      no substring/suffix escape. Soft-skips when unadvertised / seam unwired;
 *      hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * @see spec/v1/connection-packs.md
 * @see schemas/connection-pack-manifest.schema.json
 * @see RFCS/0120-connection-pack-api-hosts.md
 * @see spec/v1/host-sample-test-seams.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { SCHEMAS_DIR, FIXTURES_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'connection-pack-manifest.schema.json');
const APIHOSTS_FIXTURE = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-apihosts-valid.json');
const MCP_FIXTURE = join(FIXTURES_DIR, 'connection-packs', 'connection-pack-github.json');

type Manifest = Record<string, unknown> & {
  provider: Record<string, unknown> & { id: string; apiHosts?: string[] };
};

function apiHostsFixture(): Manifest {
  return JSON.parse(readFileSync(APIHOSTS_FIXTURE, 'utf8')) as Manifest;
}
function mcpFixture(): Manifest {
  return JSON.parse(readFileSync(MCP_FIXTURE, 'utf8')) as Manifest;
}

/**
 * The item-10 matching rule, exactly as the spec defines it: a request host
 * matches an `apiHosts` entry IFF it equals the entry OR ends with `"." + entry`
 * (dot-anchored suffix containment — never a bare substring). This is the
 * server-free, host-independent encoding of `connection-pack-egress-host-bound`.
 */
function matchesApiHost(requestHost: string, entry: string): boolean {
  const h = requestHost.toLowerCase();
  const e = entry.toLowerCase();
  return h === e || h.endsWith('.' + e);
}

describe('category: connection-pack apiHosts — schema shape (RFC 0120 §A; invariant connection-pack-api-host-shape)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  const failsWith = (manifest: unknown, keyword: string): ErrorObject[] => {
    const ok = validate(manifest);
    expect(ok).toBe(false);
    return (validate.errors ?? []).filter((e) => e.keyword === keyword);
  };

  it('positive: an openapi-reach provider declaring apiHosts validates', () => {
    expect(
      validate(apiHostsFixture()),
      `connection-packs.md §Manifest item 10: a well-formed apiHosts allow-list MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('conditional MUST (item 13 / §A allOf): an openapi-reach provider that omits apiHosts is rejected', () => {
    const m = apiHostsFixture();
    delete m.provider.apiHosts;
    const errs = failsWith(m, 'required');
    expect(
      errs.some((e) => (e.params as { missingProperty?: string }).missingProperty === 'apiHosts'),
      'connection-packs.md §Manifest item 13: when reach is openapi, apiHosts is REQUIRED (the provider-level allOf)',
    ).toBe(true);
  });

  it('omission OK off the conditional: an mcp-reach provider without apiHosts validates', () => {
    const m = mcpFixture();
    expect(m.provider.apiHosts, 'precondition: the github fixture is mcp-reach and declares no apiHosts').toBeUndefined();
    expect(
      validate(m),
      `connection-packs.md §Manifest item 13: a non-openapi provider MAY omit apiHosts. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('entry shape (item 11): IPv4 literal / wildcard / port / single-label / uppercase entries are each rejected', () => {
    for (const bad of ['127.0.0.1', '10.0.0.1', '*.facebook.com', 'graph.facebook.com:8443', 'facebook', 'Facebook.com']) {
      const m = apiHostsFixture();
      m.provider.apiHosts = [bad];
      const errs = failsWith(m, 'pattern');
      expect(
        errs.length,
        `connection-packs.md §Manifest item 11: "${bad}" MUST be rejected — apiHosts entries are bare, lowercase, alphabetic-TLD registrable hostnames (connection_pack_invalid_api_host)`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('category: connection-pack apiHosts — matching rule (RFC 0120 item 10; invariant connection-pack-egress-host-bound)', () => {
  it('permits the entry host and its subdomains (eTLD+1 floor)', () => {
    expect(matchesApiHost('facebook.com', 'facebook.com'), 'item 10: a request host equal to the entry matches').toBe(true);
    expect(matchesApiHost('graph.facebook.com', 'facebook.com'), 'item 10: a subdomain of the entry matches (eTLD+1 floor)').toBe(true);
    expect(matchesApiHost('api.example.com', 'example.com'), 'item 10: a subdomain matches').toBe(true);
  });

  it('a pack MAY tighten to an exact host without admitting siblings', () => {
    expect(matchesApiHost('googleads.googleapis.com', 'googleads.googleapis.com'), 'item 10: the tighter exact host matches itself').toBe(true);
    expect(
      matchesApiHost('bigquery.googleapis.com', 'googleads.googleapis.com'),
      'item 10: a sibling subdomain MUST NOT match a tighter exact-host entry',
    ).toBe(false);
  });

  it('no substring / suffix / prefix escape — non-matching hosts fail closed', () => {
    for (const evil of ['notexample.com', 'evil.com', 'example.com.evil.com', 'myexample.com']) {
      expect(
        matchesApiHost(evil, 'example.com'),
        `item 10: "${evil}" MUST NOT match "example.com" (dot-anchored containment, never a bare substring)`,
      ).toBe(false);
    }
  });
});

interface EgressResult {
  allowed?: boolean;
  code?: string;
}

async function gate(): Promise<boolean> {
  const connections = await readCapabilityFamily<{ packsSupported?: boolean }>('connections');
  return behaviorGate('connections.packsSupported', connections?.packsSupported === true);
}

describe('connection-pack apiHosts — behavioral egress allow-list (RFC 0120 item 10; capability-gated)', () => {
  it('permits a credential-bearing egress to an apiHosts match; fails closed otherwise (no substring escape)', async () => {
    if (!(await gate())) return;

    const install = await driver.post('/v1/host/sample/connection-packs/install', { manifest: apiHostsFixture() });
    if (install.status === 404 || install.status === 403) return; // seam unwired — soft-skip

    const probe = async (requestHost: string): Promise<EgressResult | undefined> => {
      const res = await driver.post('/v1/host/sample/connection-packs/egress-check', {
        provider: 'meta-ads',
        requestHost,
      });
      if (res.status === 404 || res.status === 403) return undefined; // egress-check seam unwired — soft-skip
      return res.json as EgressResult | undefined;
    };

    const allowed = await probe('graph.facebook.com');
    if (allowed === undefined) return; // soft-skip
    expect(
      allowed.allowed,
      driver.describe('connection-packs.md §Manifest item 10', 'a credential-bearing egress to a host matching apiHosts MUST be permitted'),
    ).toBe(true);

    for (const evil of ['evil.com', 'notfacebook.com', 'facebook.com.evil.com']) {
      const denied = await probe(evil);
      if (denied === undefined) return; // soft-skip
      expect(
        denied.allowed,
        driver.describe('connection-packs.md §Manifest item 10', `egress to "${evil}" (no apiHosts match) MUST fail closed — no credential sent`),
      ).toBe(false);
    }
  });
});
