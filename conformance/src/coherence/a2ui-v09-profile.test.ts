/**
 * a2ui-v09-profile — RFC 0209 §A–§B and §D.14, the server-free legs (corpus gate).
 *
 * `ui.a2ui-surface` at per-kind schema version 2 is an ordered run of A2UI v0.9
 * server-to-client messages restricted to a closed OpenWOP profile of the basic
 * catalog. These legs need no host, so they live here and mint their ids into
 * `evidence/corpus-ledger.json` (RFC 0168 §D.1); the seam-gated legs are in
 * `src/scenarios/v2-a2ui-v09-surface.test.ts`.
 *
 * Every negative is checked twice. It must fail the profile, AND it must pass a
 * copy of the profile with exactly the restriction under test removed. The
 * second check is what makes the row able to fail: a negative that the profile
 * refuses for some unrelated reason (a typo in the fixture, a missing required
 * field) passes the first check and fails the second. Where the RFC says
 * upstream A2UI accepts a negative, that is asserted too — it is the evidence
 * that the profile, not A2UI, is doing the refusing.
 *
 * Upstream is the three a2ui.org files vendored under
 * `fixtures/upstream/a2ui-v0.9/`, pinned by SHA-256 (RFC 0209 §References).
 *
 * @see RFCS/0209-v2-a2ui-surfaces-are-a2ui-v0-9.md
 * @see spec/v2/ext/a2uiSurface/README.md
 * @see schemas/v2/envelopes/ui.a2ui-surface.schema.json
 */

import { describe, it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, FIXTURES_DIR, SPEC_V2_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

type Json = Record<string, unknown>;
const read = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

const UP_DIR = join(FIXTURES_DIR, 'upstream', 'a2ui-v0.9');
const FX_DIR = join(FIXTURES_DIR, 'a2ui-v09');
const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
/** RFC 0209 §References — the served a2ui.org bytes, fetched 2026-09-22. */
const PINS: Record<string, string> = {
  'server_to_client.json': '77080edd7d15077e5d345682c7bedec27b59c6df13ed3a72fd3de66318acb2d6',
  'catalog.json': '8cc94d0a482e67048f9fc989964ca5da56fe42f531d919315a508989fb22e13e',
  'common_types.json': 'ac79788e95e5bdf0a39808953593a53c1bc9fcdcdb55480f4610613c6591e94c',
};
const UNIVERSAL_KINDS = ['clarification.request', 'schema.request', 'schema.response', 'error'];

const surfaceSchema = read(join(SCHEMAS_DIR, 'v2', 'envelopes', 'ui.a2ui-surface.schema.json'));
const v1Schema = read(join(SCHEMAS_DIR, 'envelopes', 'ui.a2ui-surface.schema.json'));

/** A standalone schema for one branch of the v2 kind schema (the `$defs` travel with it). */
function branch(schema: Json, def: 'payloadV1' | 'payloadV2'): Json {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: `#/$defs/${def}`, $defs: (schema as { $defs: Json }).$defs };
}
function compile(schema: Json): (doc: unknown) => { ok: boolean; errors: string } {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const v = ajv.compile(schema);
  return (doc) => ({ ok: v(doc) as boolean, errors: ajv.errorsText(v.errors, { separator: '; ' }).slice(0, 600) });
}
const profile = compile(branch(surfaceSchema, 'payloadV2'));
const v1Branch = compile(branch(surfaceSchema, 'payloadV1'));

/** The profile with one restriction removed — the sabotage each negative must survive. */
function relaxed(mutate: (defs: Json) => void): (doc: unknown) => { ok: boolean; errors: string } {
  const s = clone(surfaceSchema);
  mutate((s as { $defs: Json }).$defs);
  return compile(branch(s, 'payloadV2'));
}

/** Upstream A2UI v0.9 server_to_client.json with the basic catalog and common types bound. */
function upstream(): (doc: unknown) => { ok: boolean; errors: string } {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const catalog = read(join(UP_DIR, 'catalog.json'));
  ajv.addSchema(read(join(UP_DIR, 'common_types.json')));
  ajv.addSchema(catalog);
  // server_to_client.json's `catalog.json` $ref resolves next to its own $id; bind it to the basic catalog.
  ajv.addSchema({ ...clone(catalog), $id: 'https://a2ui.org/specification/v0_9/catalog.json' });
  const v = ajv.compile(read(join(UP_DIR, 'server_to_client.json')));
  return (doc) => ({ ok: v(doc) as boolean, errors: ajv.errorsText(v.errors, { separator: '; ' }).slice(0, 600) });
}
const up = upstream();

const positives = readdirSync(FX_DIR).filter((f) => f.startsWith('positive-') && f.endsWith('.json')).sort();
const neg = (name: string): Json => read(join(FX_DIR, `negative-${name}.json`));
const messagesOf = (p: Json): Json[] => (p['messages'] as Json[]);
/** The one message of a negative that carries the mutation (index into messages[]). */
function upstreamVerdict(p: Json, index: number): boolean { return up(messagesOf(p)[index]).ok; }

describe('RFC 0209 §B.4 — the profile is a subset of upstream A2UI v0.9', () => {
  it('the vendored upstream files are the pinned bytes; every positive validates against payloadV2 and each of its messages against upstream', () => {
    for (const [file, sha] of Object.entries(PINS)) {
      const got = createHash('sha256').update(readFileSync(join(UP_DIR, file))).digest('hex');
      expect(got, req('openwop.requirement.0209.profile-subset-of-upstream', 'RFC 0209 §References', `fixtures/upstream/a2ui-v0.9/${file} MUST be the pinned a2ui.org bytes (sha256 ${sha})`)).toBe(sha);
    }
    expect((read(join(UP_DIR, 'catalog.json')))['$id'], req('openwop.requirement.0209.profile-subset-of-upstream', 'RFC 0209 §A.2', 'the vendored basic catalog $id IS the catalogId the profile pins')).toBe(BASIC_CATALOG);
    expect(positives.length, req('openwop.requirement.0209.profile-subset-of-upstream', 'RFC 0209 §B.4', 'fixtures/a2ui-v09/ MUST carry at least one positive surface')).toBeGreaterThan(0);
    for (const f of positives) {
      const p = read(join(FX_DIR, f));
      const r = profile(p);
      expect(r.ok, req('openwop.requirement.0209.profile-subset-of-upstream', 'RFC 0209 §A.2', `${f} MUST validate against $defs/payloadV2: ${r.errors}`)).toBe(true);
      messagesOf(p).forEach((m, i) => {
        const u = up(m);
        expect(u.ok, req('openwop.requirement.0209.profile-subset-of-upstream', 'RFC 0209 §B.4', `${f} messages[${i}] (${Object.keys(m).find((k) => k !== 'version')}) MUST validate against upstream A2UI v0.9 server_to_client.json: ${u.errors}`)).toBe(true);
      });
    }
  });
});

describe('RFC 0209 §B.7 — actions are the server-event arm, resume | exchange only', () => {
  it('a functionCall action (openUrl) and an event.name outside the allowlist are refused, and only because of $defs/action', () => {
    const loose = relaxed((d) => { d['action'] = { anyOf: [{ type: 'object', required: ['event'], properties: { event: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, context: { type: 'object' } } } } }, { type: 'object', required: ['functionCall'] }] }; });
    for (const name of ['functioncall-openurl', 'event-name-deleteall']) {
      const p = neg(name);
      expect(profile(p).ok, req('openwop.requirement.0209.action-confined', 'RFC 0209 §B.7', `negative-${name} MUST fail $defs/payloadV2 (a2ui-action-confinement)`)).toBe(false);
      const l = loose(p);
      expect(l.ok, req('openwop.requirement.0209.action-confined', 'RFC 0209 §B.7', `negative-${name} MUST pass the profile once $defs/action admits upstream's Action arms — otherwise it fails for another reason and witnesses nothing: ${l.errors}`)).toBe(true);
      expect(upstreamVerdict(p, 1), req('openwop.requirement.0209.action-confined', 'RFC 0209 §Examples', `upstream A2UI accepts negative-${name} — the refusal is the profile's`)).toBe(true);
    }
  });
});

describe('RFC 0209 §B.8 — no secret input', () => {
  it('TextField.variant "obscured" is refused, and only because the variant enum excludes it', () => {
    const p = neg('textfield-obscured');
    expect(profile(p).ok, req('openwop.requirement.0209.no-secret-input', 'RFC 0209 §B.8', 'negative-textfield-obscured MUST fail $defs/payloadV2 (a2ui-surface-no-secret-input)')).toBe(false);
    const loose = relaxed((d) => { ((((d['TextField'] as Json)['properties'] as Json)['variant']) as { enum: string[] }).enum.push('obscured'); });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0209.no-secret-input', 'RFC 0209 §B.8', `negative-textfield-obscured MUST pass once "obscured" is restored to the variant enum: ${l.errors}`)).toBe(true);
    expect(upstreamVerdict(p, 1), req('openwop.requirement.0209.no-secret-input', 'RFC 0209 §Examples', 'upstream A2UI accepts an obscured TextField — the refusal is the profile\'s')).toBe(true);
  });
});

describe('RFC 0209 §B.5–§B.6 — no egress-bearing components', () => {
  it('Image and theme.iconUrl are refused, each only because of its exclusion; no URL-fetching component is in the profile', () => {
    {
    const p = neg('image-component');
    expect(profile(p).ok, req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §B.6', 'negative-image-component MUST fail $defs/payloadV2 (a2ui-surface-no-network-egress)')).toBe(false);
    const loose = relaxed((d) => {
      d['Image'] = { type: 'object', additionalProperties: false, required: ['id', 'component', 'url'], properties: { id: { $ref: '#/$defs/componentId' }, component: { type: 'string', enum: ['Image'] }, url: { type: 'string' } } };
      ((d['component'] as { anyOf: Json[] }).anyOf).push({ $ref: '#/$defs/Image' });
    });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §B.6', `negative-image-component MUST pass once Image joins the component anyOf: ${l.errors}`)).toBe(true);
    expect(upstreamVerdict(p, 1), req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §Examples', 'upstream A2UI accepts an Image component — the refusal is the profile\'s')).toBe(true);
    }
    {
    const p = neg('theme-iconurl');
    expect(profile(p).ok, req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §B.5', 'negative-theme-iconurl MUST fail $defs/payloadV2')).toBe(false);
    const loose = relaxed((d) => { const theme = ((((d['createSurface'] as Json)['properties'] as Json)['createSurface'] as Json)['properties'] as Json)['theme'] as Json; (theme['properties'] as Json)['iconUrl'] = { type: 'string' }; });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §B.5', `negative-theme-iconurl MUST pass once theme admits iconUrl: ${l.errors}`)).toBe(true);
    expect(upstreamVerdict(p, 0), req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §Examples', 'upstream A2UI accepts theme.iconUrl — the refusal is the profile\'s')).toBe(true);
    }
    const names = ((surfaceSchema['$defs'] as Json)['component'] as { anyOf: Array<{ $ref: string }> }).anyOf.map((b) => b.$ref.replace('#/$defs/', ''));
    for (const excluded of ['Image', 'Video', 'AudioPlayer', 'Icon']) {
      expect(names, req('openwop.requirement.0209.no-egress-components', 'RFC 0209 §B.6', `${excluded} MUST NOT be a member of $defs/component`)).not.toContain(excluded);
    }
  });
});

describe('RFC 0209 §A.2 — the catalog is pinned', () => {
  it('a foreign catalogId is refused, and only because catalogId is an enum', () => {
    const p = neg('foreign-catalog');
    expect(profile(p).ok, req('openwop.requirement.0209.catalog-pinned', 'RFC 0209 §A.2', 'negative-foreign-catalog MUST fail $defs/payloadV2 — catalogId is the host-pinned set, never a free string')).toBe(false);
    const loose = relaxed((d) => { d['catalogId'] = { type: 'string' }; });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0209.catalog-pinned', 'RFC 0209 §A.2', `negative-foreign-catalog MUST pass once catalogId is a free string: ${l.errors}`)).toBe(true);
    expect(((surfaceSchema['$defs'] as Json)['catalogId'] as { enum: string[] }).enum, req('openwop.requirement.0209.catalog-pinned', 'RFC 0209 §A.2', 'the pinned set is exactly the basic catalog today')).toEqual([BASIC_CATALOG]);
  });
});

describe('RFC 0209 §B.6 — closed components, no FunctionCall values', () => {
  it('an extra component property and a formatString text value are refused (the second is accepted upstream)', () => {
    for (const name of ['extra-property', 'formatstring-label']) {
      expect(profile(neg(name)).ok, req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'RFC 0209 §B.6', `negative-${name} MUST fail $defs/payloadV2`)).toBe(false);
    }
    const loose = relaxed((d) => { (d['dynString'] as { anyOf: Json[] }).anyOf.push({ type: 'object', required: ['call'] }); });
    expect(loose(neg('formatstring-label')).ok, req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'RFC 0209 §B.6', 'negative-formatstring-label MUST pass once dynString admits a FunctionCall')).toBe(true);
    expect(upstreamVerdict(neg('formatstring-label'), 1), req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'RFC 0209 §Examples', 'upstream A2UI accepts a formatString text value — the refusal is the profile\'s')).toBe(true);
    expect(upstreamVerdict(neg('extra-property'), 1), req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'RFC 0209 §Examples', 'upstream A2UI also refuses an extra property (unevaluatedProperties: false)')).toBe(false);
  });
});

describe('RFC 0209 §A.1 — the version-1 branch is the seeded tree, unchanged', () => {
  it('$defs/payloadV1 equals the v1 kind schema (only `component` renamed), and the two branches are disjoint', () => {
    const v1Defs = clone(v1Schema['$defs'] as Json);
    const renamed = JSON.parse(JSON.stringify(v1Defs).split('"#/$defs/component"').join('"#/$defs/componentV1"')) as Json;
    renamed['componentV1'] = renamed['component']; delete renamed['component'];
    const v2Defs = surfaceSchema['$defs'] as Json;
    for (const [k, v] of Object.entries(renamed)) {
      expect(v2Defs[k], req('openwop.it.a2ui-v09-profile.v1-branch-unchanged', 'RFC 0209 §A.1', `$defs/${k} MUST equal the v1 schema's definition byte for byte in content`)).toEqual(v);
    }
    const pv1 = v2Defs['payloadV1'] as Json;
    for (const k of ['type', 'required', 'additionalProperties', 'properties']) {
      expect(pv1[k], req('openwop.it.a2ui-v09-profile.v1-branch-unchanged', 'RFC 0209 §A.1', `$defs/payloadV1.${k} MUST equal the v1 root's ${k}`)).toEqual(v1Schema[k]);
    }
    const v1 = { catalogVersion: '0.9.1', surface: { title: 'Kickoff', components: [{ component: 'heading', text: 'Kickoff', level: 2 }, { component: 'field.text', id: 'name', label: 'Name', required: true }, { component: 'action.button', id: 'go', label: 'Go', action: { target: 'resume' } }] } };
    expect(v1Branch(v1).ok, req('openwop.it.a2ui-v09-profile.v1-branch-unchanged', 'RFC 0209 §A.1', 'a version-1 surface MUST validate against $defs/payloadV1')).toBe(true);
    expect(profile(v1).ok, req('openwop.it.a2ui-v09-profile.v1-branch-unchanged', 'RFC 0209 §A.1', 'a version-1 surface MUST NOT validate against $defs/payloadV2 — the branches are disjoint')).toBe(false);
    const v2 = read(join(FX_DIR, positives[0] ?? 'positive-approve-brief.json'));
    expect(v1Branch(v2).ok, req('openwop.it.a2ui-v09-profile.v1-branch-unchanged', 'RFC 0209 §A.1', 'a version-2 surface MUST NOT validate against $defs/payloadV1')).toBe(false);
  });
});

describe('RFC 0209 §D.14 — the ui.* / media.* kind carve-out', () => {
  it('every v2 envelope kind is universal or ui.* / media.*, and events.md states the carve-out', () => {
    if (V1_DIR === null || SPEC_V2_DIR === null) return softSkip('inapplicable', 'not a spec checkout — spec/v2/core/events.md is absent from this layout');
    const kinds = readdirSync(join(SCHEMAS_DIR, 'v2', 'envelopes')).filter((f) => f.endsWith('.schema.json')).map((f) => f.replace(/\.schema\.json$/, ''));
    const orphaned = kinds.filter((k) => !UNIVERSAL_KINDS.includes(k) && !/^(ui|media)\./.test(k));
    expect(orphaned, req('openwop.requirement.0209.kind-carve-out', 'RFC 0209 §D.14', `every kind under schemas/v2/envelopes/ MUST be universal or in ui.* / media.* (orphaned: ${orphaned.join(', ')})`)).toEqual([]);
    const events = readFileSync(join(SPEC_V2_DIR, 'core', 'events.md'), 'utf8');
    expect(events.includes('universal kinds and the core content-primitive families `ui.*` and `media.*` excepted'), req('openwop.requirement.0209.kind-carve-out', 'RFC 0209 §D.14', 'events.md §"AI envelopes" MUST except the ui.* and media.* families from the <org>. namespacing rule, or no v2 host could advertise a kind v2 ships')).toBe(true);
  });
});
