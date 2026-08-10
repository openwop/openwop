/**
 * `registrationSource` as a per-type artifact capability facet (RFC 0145).
 *
 * Always-on corpus legs only. The facet discloses which §"Schema distribution" regime a
 * registered artifact type falls under: serving the canonical schema URL is a MUST for
 * host-registered (no-pack) types and only a SHOULD for pack-backed ones, so the two carry
 * different resolution guarantees — and before this RFC nothing in discovery said which.
 *
 * WHY THE ENUM IS LOAD-BEARING HERE, UNLIKE RFC 0136's `format`. `format` is deliberately
 * NOT an enum: it is an advisory hint on a client-submitted closed shape, so an
 * unrecognised value must degrade to plain text rather than fail a POST. `registrationSource`
 * is the opposite on both axes — it has exactly two meanings, it appears on a SERVER-emitted
 * discovery document, and a third value is not a hint to ignore but a host claiming a
 * provenance the protocol does not define. Leg A2 pins that asymmetry.
 *
 * NOT BUILT (carried as RFC 0145 G1): a leg asserting a host's advertised
 * `registrationSource` matches what it emits on `artifact.created` (requirement 3). It needs
 * a host that advertises the facet AND emits a matching artifact; against a host advertising
 * nothing it would be vacuously green, which is the failure mode this suite keeps finding.
 *
 * @see schemas/capabilities.schema.json §artifactTypes.types
 * @see spec/v1/artifact-type-packs.md §"Per-type facets" + §"Schema distribution"
 * @see RFCS/0145-registration-source-per-type-facet.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;
const CAPS = join(SCHEMAS_DIR, 'capabilities.schema.json');
const EVENT_PAYLOADS = join(SCHEMAS_DIR, 'run-event-payloads.schema.json');
const readDoc = (name: string): string => (V1_DIR ? readFileSync(join(V1_DIR, name), 'utf8') : '');

function loadSchema(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** The per-type entry subschema — `artifactTypes.types.additionalProperties`. */
function perTypeEntry(): Record<string, unknown> {
  const caps = loadSchema(CAPS);
  const props = caps.properties as Record<string, Record<string, unknown>>;
  const types = (props.artifactTypes.properties as Record<string, Record<string, unknown>>).types;
  return types.additionalProperties as Record<string, unknown>;
}

describe('artifact-type-registration-source (RFC 0145, always-on)', () => {
  it('A1 — the per-type entry declares `registrationSource` as an OPTIONAL pack|host enum', () => {
    const entry = perTypeEntry();
    const props = entry.properties as Record<string, Record<string, unknown>>;

    expect(props.registrationSource, why('§artifactTypes.types', 'facet is declared')).toBeDefined();
    expect(
      props.registrationSource.enum,
      why('§artifactTypes.types', 'enum is exactly [pack, host]'),
    ).toEqual(['pack', 'host']);
    expect(
      (entry.required as string[] | undefined)?.includes('registrationSource') ?? false,
      why('§artifactTypes.types', 'facet is OPTIONAL — absent ⇒ unspecified provenance, not a default'),
    ).toBe(false);
  });

  it('A2 — a valid provenance validates; an out-of-enum value does NOT', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(perTypeEntry());

    expect(
      validate({ validated: true, registrationSource: 'host', schemaVersion: 1 }),
      why('§artifactTypes.types', `"host" validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    expect(
      validate({ validated: true, registrationSource: 'pack' }),
      why('§artifactTypes.types', `"pack" validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    // Absent stays legal — requirement 2.
    expect(
      validate({ validated: true }),
      why('§artifactTypes.types', `absent validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    // A third provenance is a wire error, NOT a hint to ignore. This is where the facet
    // parts company with RFC 0136's `format`, and the reason is in the docblock.
    expect(
      validate({ validated: true, registrationSource: 'registry' }),
      why('§artifactTypes.types', 'an undefined provenance is REJECTED'),
    ).toBe(false);
  });

  it('A3 — the facet mirrors the vocabulary `artifact.created` already carries', () => {
    const payloads = loadSchema(EVENT_PAYLOADS);
    const defs = payloads.$defs as Record<string, Record<string, unknown>>;
    const eventProps = defs.artifactCreated.properties as Record<string, Record<string, unknown>>;
    const entryProps = perTypeEntry().properties as Record<string, Record<string, unknown>>;

    // Requirement 3 says the two surfaces MUST NOT disagree. They cannot even be compared
    // unless they share a vocabulary, so pin that first — a drift here would let a host
    // advertise a provenance it could never emit.
    expect(
      entryProps.registrationSource.enum,
      why('RFC 0145 req 3', 'discovery enum matches artifact.created enum'),
    ).toEqual(eventProps.registrationSource.enum);
  });

  it.skipIf(V1_DIR === null)('A4 — both prose sites list the facet, so schema and normative surface cannot drift', () => {
    // The RFC 0144 defect, restated: a wire field with no prose behind it is exactly what
    // this corpus keeps producing. Two docs carry the per-type facet list; both must name it.
    for (const name of ['artifact-type-packs.md', 'host-capabilities.md']) {
      const facetList = readDoc(name).match(
        /validated, validation, schemaVersion, store, render, export[^}]*}/,
      );
      expect(facetList, why(`${name} §"Per-type facets"`, 'per-type facet list present')).not.toBeNull();
      expect(
        facetList?.[0].includes('registrationSource'),
        why(`${name} §"Per-type facets"`, 'facet list names registrationSource'),
      ).toBe(true);
    }
  });

  it.skipIf(V1_DIR === null)('A5 — the spec states the MUST/SHOULD asymmetry the facet exists to disclose', () => {
    const doc = readDoc('artifact-type-packs.md');
    expect(
      /Serving is a MUST for host-registered/.test(doc),
      why('§Schema distribution', 'serving is a MUST for no-pack types'),
    ).toBe(true);
    expect(
      /serving stays a SHOULD for them/.test(doc),
      why('§Schema distribution', 'serving stays a SHOULD for pack-backed types'),
    ).toBe(true);
  });
});
