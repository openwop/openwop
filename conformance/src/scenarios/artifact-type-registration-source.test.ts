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
 * LEG B (RFC 0145 G1) closes the gap this file originally carried open. It asserts a host's
 * advertised `registrationSource` matches what it emits on `artifact.created` (requirement 3).
 * It was deliberately NOT built at first: against a corpus where no host advertised the facet
 * it would have gone green by finding nothing. A host now advertises it, so the leg has
 * something real to compare and can no longer pass vacuously.
 *
 * PROFILE = 'openwop-artifact-type-store' is shared with RFC 0142 ON PURPOSE — see the gating
 * note on leg B for why this leg deliberately does NOT add its own advertise-and-skip gate.
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
import { driver } from '../lib/driver.js';
import { behaviorGatePresent } from '../lib/behavior-gate.js';
import { readArtifactTypesCap } from '../lib/artifactTypes.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
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

    expect(props.registrationSource, req('openwop.it.artifact-type-registration-source.a1-the-per-type-entry-declares-registrationsource-as-an-optional-pack-host-enum', '§artifactTypes.types', 'facet is declared')).toBeDefined();
    expect(
      props.registrationSource.enum,
      req('openwop.it.artifact-type-registration-source.a1-the-per-type-entry-declares-registrationsource-as-an-optional-pack-host-enum', '§artifactTypes.types', 'enum is exactly [pack, host]'),
    ).toEqual(['pack', 'host']);
    expect(
      (entry.required as string[] | undefined)?.includes('registrationSource') ?? false,
      req('openwop.it.artifact-type-registration-source.a1-the-per-type-entry-declares-registrationsource-as-an-optional-pack-host-enum', '§artifactTypes.types', 'facet is OPTIONAL — absent ⇒ unspecified provenance, not a default'),
    ).toBe(false);
  });

  it('A2 — a valid provenance validates; an out-of-enum value does NOT', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(perTypeEntry());

    expect(
      validate({ validated: true, registrationSource: 'host', schemaVersion: 1 }),
      req('openwop.it.artifact-type-registration-source.a2-a-valid-provenance-validates-an-out-of-enum-value-does-not', '§artifactTypes.types', `"host" validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    expect(
      validate({ validated: true, registrationSource: 'pack' }),
      req('openwop.it.artifact-type-registration-source.a2-a-valid-provenance-validates-an-out-of-enum-value-does-not', '§artifactTypes.types', `"pack" validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    // Absent stays legal — requirement 2.
    expect(
      validate({ validated: true }),
      req('openwop.it.artifact-type-registration-source.a2-a-valid-provenance-validates-an-out-of-enum-value-does-not', '§artifactTypes.types', `absent validates: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
    // A third provenance is a wire error, NOT a hint to ignore. This is where the facet
    // parts company with RFC 0136's `format`, and the reason is in the docblock.
    expect(
      validate({ validated: true, registrationSource: 'registry' }),
      req('openwop.it.artifact-type-registration-source.a2-a-valid-provenance-validates-an-out-of-enum-value-does-not', '§artifactTypes.types', 'an undefined provenance is REJECTED'),
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
      req('openwop.it.artifact-type-registration-source.a3-the-facet-mirrors-the-vocabulary-artifact-created-already-carries', 'RFC 0145 req 3', 'discovery enum matches artifact.created enum'),
    ).toEqual(eventProps.registrationSource.enum);
  });

  it.skipIf(V1_DIR === null)('A4 — both prose sites list the facet, so schema and normative surface cannot drift', () => {
    // The RFC 0144 defect, restated: a wire field with no prose behind it is exactly what
    // this corpus keeps producing. Two docs carry the per-type facet list; both must name it.
    for (const name of ['artifact-type-packs.md', 'host-capabilities.md']) {
      const facetList = readDoc(name).match(
        /validated, validation, schemaVersion, store, render, export[^}]*}/,
      );
      expect(facetList, req('openwop.it.artifact-type-registration-source.a4-both-prose-sites-list-the-facet-so-schema-and-normative-surface-cannot-drift', `${name} §"Per-type facets"`, 'per-type facet list present')).not.toBeNull();
      expect(
        facetList?.[0].includes('registrationSource'),
        req('openwop.it.artifact-type-registration-source.a4-both-prose-sites-list-the-facet-so-schema-and-normative-surface-cannot-drift', `${name} §"Per-type facets"`, 'facet list names registrationSource'),
      ).toBe(true);
    }
  });

  it.skipIf(V1_DIR === null)('A5 — the spec states the MUST/SHOULD asymmetry the facet exists to disclose', () => {
    const doc = readDoc('artifact-type-packs.md');
    expect(
      /Serving is a MUST for host-registered/.test(doc),
      req('openwop.it.artifact-type-registration-source.a5-the-spec-states-the-must-should-asymmetry-the-facet-exists-to-disclose', '§Schema distribution', 'serving is a MUST for no-pack types'),
    ).toBe(true);
    expect(
      /serving stays a SHOULD for them/.test(doc),
      req('openwop.it.artifact-type-registration-source.a5-the-spec-states-the-must-should-asymmetry-the-facet-exists-to-disclose', '§Schema distribution', 'serving stays a SHOULD for pack-backed types'),
    ).toBe(true);
  });
});

const PROFILE = 'openwop-artifact-type-store';

/** True when this type emits at all — `store` at per-type scope, else the capability default. */
function emitsForType(cap: Record<string, unknown> | null, id: string): boolean {
  if (!cap) return false;
  const entry = (cap['types'] as Record<string, unknown> | undefined)?.[id];
  if (entry && typeof entry === 'object' && 'store' in (entry as Record<string, unknown>)) {
    return (entry as Record<string, unknown>)['store'] === true;
  }
  return cap['store'] === true;
}

/**
 * First per-type id advertising `registrationSource` AND emitting, else null.
 *
 * BOTH conditions are required, and the second is the subtle one: `registrationSource` is
 * meaningful on a type the host never emits for (a consumer still learns which schema-resolution
 * regime applies), but requirement 3 is a statement about AGREEMENT BETWEEN TWO SURFACES, and a
 * type with no emission has only one. Asserting against it would red a host that is telling the
 * truth on every surface it actually has.
 */
function comparableType(cap: Record<string, unknown> | null): { id: string; advertised: string } | null {
  const types = cap?.['types'];
  if (!types || typeof types !== 'object') return null;
  for (const [id, t] of Object.entries(types as Record<string, unknown>)) {
    if (!t || typeof t !== 'object') continue;
    const advertised = (t as Record<string, unknown>)['registrationSource'];
    if (typeof advertised !== 'string') continue;
    if (!emitsForType(cap, id)) continue;
    return { id, advertised };
  }
  return null;
}

describe('artifact-type-registration-source: the advert agrees with the event (RFC 0145 leg B, requirement 3)', () => {
  it('the emitted registrationSource equals the advertised one for that type', async () => {
    const cap = await readArtifactTypesCap();
    const target = comparableType(cap);
    // INAPPLICABLE, not gated. `registrationSource` is OPTIONAL (requirement 2) and strict mode
    // must not coerce a host into advertising it — the same call RFC 0142 makes for `store`.
    if (target === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `target === null` returned early (INAPPLICABLE, not gated. `registrationSource` is OPTIONAL (requirement 2) and strict mode must not coerce a host into advertis…');

    const started = await driver.post('/v1/host/sample/artifacttypes/runproduce', {
      artifactTypeId: target.id,
    });
    // DELIBERATELY NOT a behaviorGate on seam presence. Reaching here means the type advertises
    // `store`, so `store: true` + no seam is ALREADY strict-red under RFC 0142 leg B — the
    // scenario that owns that enforcement. Gating again here would double-report one defect,
    // and gating on the seam for a 0145 advert would coerce hosts into wiring 0142's host-sample
    // surface in order to advertise a facet that has nothing to do with it.
    if (started.status === 404 || started.status === 405) return softSkip('blocked', 'precondition not met — `started.status === 404 || started.status === 405` returned early (seam absent — 0142 reports it) (seam, prior step, or fixture unavailable)'); // seam absent — 0142 reports it
    expect(
      started.status >= 200 && started.status < 300,
      req('openwop.it.artifact-type-registration-source.the-emitted-registrationsource-equals-the-advertised-one-for-that-type', 'coverage.md §"Open seams"', 'runproduce starts a real run producing one artifact of the requested registered type'),
    ).toBe(true);
    const runId = (started.json as Record<string, unknown> | undefined)?.['runId'];
    if (!behaviorGatePresent(PROFILE, typeof runId === 'string' ? runId : null)) return;

    const events = await driver.get(`/v1/runs/${runId}/events/poll?timeout=5`);
    expect(
      events.status,
      req('openwop.it.artifact-type-registration-source.the-emitted-registrationsource-equals-the-advertised-one-for-that-type', 'run-events surface', 'the run event log is readable over the standard poll endpoint'),
    ).toBe(200);
    const list = ((events.json as Record<string, unknown>)?.['events'] ?? []) as Array<Record<string, unknown>>;
    const created = list.filter((e) => e['type'] === 'artifact.created');
    // Emission itself is RFC 0142's MUST, reported by its own leg. Reaching here without an
    // event means that leg is already red; don't restate its finding as a 0145 failure.
    if (created.length === 0) return softSkip('blocked', 'precondition not met — `created.length === 0` returned early (Emission itself is RFC 0142\'s MUST, reported by its own leg. Reaching here without an event means that leg is already red; don\'t restate its finding as a 0…');

    const payload = (created[0]?.['payload'] ?? created[0]?.['data'] ?? {}) as Record<string, unknown>;
    expect(
      payload['registrationSource'],
      req('openwop.it.artifact-type-registration-source.the-emitted-registrationsource-equals-the-advertised-one-for-that-type', 
        'RFC 0145 requirement 3',
        `the host advertises registrationSource: "${target.advertised}" for ${target.id}, so that is the value it MUST emit — an advert of one provenance against an event carrying another (or carrying none, which asserts UNSPECIFIED provenance and therefore disagrees) is a false advertisement, not a permitted divergence`,
      ),
    ).toBe(target.advertised);
  });
});
