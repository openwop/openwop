/**
 * v2 — the `artifact.created` payload, statically
 * (`spec/v2/core/artifact-type-packs.md` §Registration;
 * `schemas/v2/run-event-payloads.schema.json#/$defs/artifactCreated`; RFCs
 * 0071, 0075, 0138, 0145, 0185). The v1 twins are the schema halves of
 * `artifact-type-store-emission` and `artifact-type-registration-source`;
 * their fixture-run legs are not ported here.
 *
 *   type        `artifact.created` is a registered v2 event type;
 *   required    `artifactId` and `artifactType` are REQUIRED (the RFC 0138
 *               replay correction reads the type from the event);
 *   provenance  `registrationSource` is `pack` or `host` ("pack-registered …
 *               `registrationSource: "pack"`, host-registered … `"host"`"),
 *               and the discovery per-type seat carries the same vocabulary,
 *               so the two surfaces cannot disagree on a value;
 *   registered  `registered` is a boolean;
 *   closed      an unknown key is rejected; a vendor key under the RFC 0185
 *               hatch (`x-`, `vendor.`, `openwop-`) is carried.
 *
 * A corpus gate (`conformance.md` §Two products): it reads only the corpus, runs in
 * the spec repo's CI, and never reaches a host bundle. Moved from src/scenarios/ in 2.45.18.
 *
 * @see spec/v2/core/artifact-type-packs.md §Registration
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { v2RefValidator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';

const DOC = 'artifact-type-packs.md §Registration';
const ID_TYPE = 'openwop.requirement.artifact-types.created-event-type-registered';
const ID_REQUIRED = 'openwop.requirement.artifact-types.created-requires-artifact-type';
const ID_PROVENANCE = 'openwop.requirement.artifact-types.created-registration-source-enum';
const ID_REGISTERED = 'openwop.requirement.artifact-types.created-registered-boolean';
const ID_CLOSED = 'openwop.requirement.artifact-types.created-payload-closed';

const GOOD = { artifactId: 'art_1', artifactType: 'vendor.acme.prd', nodeId: 'n1', registered: true, registrationSource: 'host' } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function enumAt(root: unknown, path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of path) cur = isRecord(cur) ? cur[k] : undefined;
  return isRecord(cur) ? cur['enum'] : undefined;
}

describe('v2 artifact.created payload (artifact-type-packs.md §Registration)', () => {
  const validate = v2RefValidator('run-event-payloads.schema.json#/$defs/artifactCreated');

  it('artifact.created is a registered v2 run-event type', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const r = v2RefValidator('run-event.schema.json#/properties/type')('artifact.created');
    expect(r.ok, req(ID_TYPE, DOC, `artifact.created MUST be accepted by the v2 run-event type union (${r.errors})`)).toBe(true);
  });

  it('accepts a well-formed payload, with either provenance or none', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const { registrationSource: _src, ...noSource } = GOOD;
    for (const p of [GOOD, { ...GOOD, registrationSource: 'pack' }, noSource]) {
      const r = validate(p);
      expect(r.ok, req(ID_PROVENANCE, DOC, `artifact.created ${JSON.stringify(p)} MUST validate (${r.errors})`)).toBe(true);
    }
  });

  it.each(['artifactId', 'artifactType'])('rejects a payload without %s', (field) => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const p: Record<string, unknown> = { ...GOOD };
    delete p[field];
    expect(validate(p).ok, req(ID_REQUIRED, DOC, `artifact.created without ${field} MUST be rejected`)).toBe(false);
  });

  it('rejects a registrationSource outside pack | host', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(validate({ ...GOOD, registrationSource: 'vendor' }).ok, req(ID_PROVENANCE, DOC, 'registrationSource MUST be pack or host')).toBe(false);
  });

  it('the discovery per-type registrationSource carries the same vocabulary as the event', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const payloads: unknown = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'run-event-payloads.schema.json'), 'utf8'));
    const caps: unknown = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8'));
    const event = enumAt(payloads, ['$defs', 'artifactCreated', 'properties', 'registrationSource']);
    const advert = enumAt(caps, ['properties', 'artifactTypes', 'properties', 'types', 'additionalProperties', 'properties', 'registrationSource']);
    expect(event, req(ID_PROVENANCE, DOC, 'artifact.created.registrationSource MUST be the pack | host enum')).toEqual(['pack', 'host']);
    expect(advert, req(ID_PROVENANCE, 'capabilities.schema.json §artifactTypes.types', 'the advertised per-type registrationSource MUST use the vocabulary artifact.created carries')).toEqual(event);
  });

  it('rejects a non-boolean registered', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(validate({ ...GOOD, registered: 'true' }).ok, req(ID_REGISTERED, DOC, 'registered MUST be a boolean')).toBe(false);
  });

  it('rejects an unknown key, and carries a vendor key under the RFC 0185 hatch', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(validate({ ...GOOD, payload: { secret: 1 } }).ok, req(ID_CLOSED, DOC, 'an unknown key on artifact.created MUST be rejected')).toBe(false);
    const r = validate({ ...GOOD, 'x-acme-trace': 'abc', 'vendor.acme.note': 'n' });
    expect(r.ok, req(ID_CLOSED, 'run-event-payloads.schema.json §artifactCreated (RFC 0185)', `a vendor-prefixed key MUST be carried (${r.errors})`)).toBe(true);
  });
});
