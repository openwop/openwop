/**
 * v2 — the export bundle, the `import.applied` payload and the `portability`
 * record's `import ⇒ dryRun` rule, statically (`spec/v2/core/portability.md`;
 * RFC 0098; invariant `export-bundle-no-credential-material`). The v1 twin is
 * the server-free half of `export-bundle-portability`; its import-seam leg is
 * not ported (v2 defines no import route).
 *
 *   version     a bundle carries `bundleVersion: "2"`. This FLIPS the v1 leg:
 *               at v1 `"1"` was good and `"2"` rejected; at v2 `"1"` is
 *               rejected;
 *   shape       an unknown item kind and an item without `ref` are rejected;
 *   no-cred     no credential-named field is admitted at the bundle root or
 *               under `source` ("A bundle MUST NOT contain credential values");
 *   applied     `import.applied` is a registered v2 event type, and its payload
 *               is counts and references only, never item payloads;
 *   dryRun      the capabilities seat refuses `import: true` without
 *               `dryRun: true` ("A host advertising `import` MUST advertise
 *               `dryRun: true`"). At v2 that `if/then` sits in the record's
 *               `allOf`, so it is witnessed by validation, not by reading
 *               `portability.if`.
 *
 * Host-free: every leg runs with no OPENWOP_BASE_URL.
 *
 * @see spec/v2/core/portability.md
 * @see schemas/v2/export-bundle.schema.json
 */

import { describe, it, expect } from 'vitest';
import { v2RefValidator, v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'portability.md §The export bundle';
const ID_VERSION = 'openwop.requirement.portability.bundle-version-2';
const ID_SHAPE = 'openwop.requirement.portability.bundle-item-shape';
const ID_NO_CRED = 'openwop.requirement.portability.bundle-no-credential-field';
const ID_APPLIED = 'openwop.requirement.portability.import-applied-content-free';
const ID_DRY_RUN = 'openwop.requirement.portability.import-dry-run-schema-rule';

const CRED_NAMES = ['clientSecret', 'client_secret', 'apiKey', 'api_key', 'accessToken', 'refreshToken', 'password', 'privateKey'] as const;

const GOOD = {
  bundleVersion: '2',
  source: { origin: 'https://host-a.example', exportedAt: '2026-10-04T00:00:00Z' },
  items: [
    { kind: 'prompt-template', ref: 'tpl-1', payload: { templateId: 'welcome', version: '1.0.0' } },
    { kind: 'connection-ref', ref: 'conn-1', dependsOn: ['tpl-1'], payload: { provider: 'slack', credentialRef: 'cred:abc' } },
  ],
} as const;

describe('v2 export bundle (portability.md §The export bundle)', () => {
  const validate = v2Validator('export-bundle');

  it('accepts a conforming bundle at bundleVersion "2"', () => {
    const r = validate(GOOD);
    expect(r.ok, req(ID_VERSION, DOC, `a conforming v2 bundle MUST validate (${r.errors})`)).toBe(true);
  });

  it('rejects the v1 bundleVersion "1" and a missing bundleVersion', () => {
    expect(validate({ ...GOOD, bundleVersion: '1' }).ok, req(ID_VERSION, DOC, 'a v2 bundle MUST carry bundleVersion "2"; "1" MUST be rejected')).toBe(false);
    const { bundleVersion: _gone, ...rest } = GOOD;
    expect(validate(rest).ok, req(ID_VERSION, DOC, 'a bundle without bundleVersion MUST be rejected')).toBe(false);
  });

  it('rejects an unknown item kind and an item without ref', () => {
    expect(validate({ ...GOOD, items: [{ kind: 'workflow', ref: 'x', payload: {} }] }).ok, req(ID_SHAPE, DOC, 'an unknown item kind MUST be rejected')).toBe(false);
    expect(validate({ ...GOOD, items: [{ kind: 'agent', payload: {} }] }).ok, req(ID_SHAPE, DOC, 'an item without a ref MUST be rejected')).toBe(false);
  });

  it.each(CRED_NAMES)('admits no %s field at the bundle root or under source', (name) => {
    expect(validate({ ...GOOD, [name]: 'xxx' }).ok, req(ID_NO_CRED, DOC, `a "${name}" field at the bundle root MUST NOT validate`)).toBe(false);
    expect(validate({ ...GOOD, source: { ...GOOD.source, [name]: 'xxx' } }).ok, req(ID_NO_CRED, DOC, `a "${name}" field under source MUST NOT validate`)).toBe(false);
  });
});

describe('v2 import.applied (portability.md §The import.applied event)', () => {
  const applied = v2RefValidator('run-event-payloads.schema.json#/$defs/importApplied');
  const ADOC = 'portability.md §The import.applied event';

  it('import.applied is a registered v2 run-event type', () => {
    const r = v2RefValidator('run-event.schema.json#/properties/type')('import.applied');
    expect(r.ok, req(ID_APPLIED, ADOC, `import.applied MUST be accepted by the v2 run-event type union (${r.errors})`)).toBe(true);
  });

  it('a counts-and-refs payload validates; one carrying item payloads does not', () => {
    const r = applied({ bundleOrigin: 'https://host-a.example', counts: { created: 2, skipped: 1 }, secretsToRebind: ['anthropic'] });
    expect(r.ok, req(ID_APPLIED, ADOC, `a content-free import.applied MUST validate (${r.errors})`)).toBe(true);
    expect(applied({ bundleOrigin: 'h', counts: { created: 1 }, items: [{ payload: {} }] }).ok, req(ID_APPLIED, ADOC, 'import.applied MUST NOT carry item payloads')).toBe(false);
    expect(applied({ bundleOrigin: 'h', counts: { created: 1, leaked: 1 } }).ok, req(ID_APPLIED, ADOC, 'import.applied counts MUST be the four outcome tallies only')).toBe(false);
  });
});

describe('v2 portability record: import ⇒ dryRun (portability.md §The portability record)', () => {
  const record = v2RefValidator('capabilities.schema.json#/properties/portability');
  const PDOC = 'portability.md §The portability record';
  const base = { status: 'experimental', since: '2.0', until: '2099-01-01', witness: 'witnessable-gated', export: true } as const;

  it('import: true with dryRun: true validates; import: false needs no dryRun', () => {
    for (const r of [{ ...base, import: true, dryRun: true }, { ...base, import: false }, { ...base }]) {
      const v = record(r);
      expect(v.ok, req(ID_DRY_RUN, PDOC, `a portability record ${JSON.stringify(r)} MUST validate (${v.errors})`)).toBe(true);
    }
  });

  it('import: true without dryRun, or with dryRun: false, is rejected', () => {
    expect(record({ ...base, import: true }).ok, req(ID_DRY_RUN, PDOC, 'import: true without dryRun MUST be rejected')).toBe(false);
    expect(record({ ...base, import: true, dryRun: false }).ok, req(ID_DRY_RUN, PDOC, 'import: true with dryRun: false MUST be rejected')).toBe(false);
  });
});
