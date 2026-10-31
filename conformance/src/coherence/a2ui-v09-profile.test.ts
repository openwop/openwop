/**
 * a2ui-v09-profile — the closed A2UI v0.9 profile an interrupt form carries
 * (RFC 0255 §E, `interrupt.md` §Forms), server-free legs (corpus gate).
 *
 * The `ui.a2ui-surface` envelope kind that first defined this profile (RFC 0209)
 * is deleted from v2 (RFC 0255 §A). The profile survives in
 * `schemas/v2/interrupt-form.schema.json`, so these legs judge that file. They
 * need no host, so they mint their ids into `evidence/corpus-ledger.json`
 * (RFC 0168 §D.1); the host legs are in `src/scenarios/v2-interrupt-form-rules.test.ts`.
 *
 * Every negative is checked twice. It must fail the form schema, AND it must pass
 * a copy of the schema with exactly the restriction under test removed. The
 * second check is what makes the row able to fail: a negative that the schema
 * refuses for some unrelated reason (a typo in the fixture, a missing required
 * field) passes the first check and fails the second. Where upstream A2UI
 * accepts a negative, that is asserted too — it is the evidence that the
 * profile, not A2UI, is doing the refusing.
 *
 * Upstream is the three a2ui.org files vendored under
 * `fixtures/upstream/a2ui-v0.9/`, pinned by SHA-256 (RFC 0209 §References).
 *
 * @see RFCS/0255-delete-the-ai-envelope.md §E
 * @see schemas/v2/interrupt-form.schema.json
 */

import { describe, it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, FIXTURES_DIR, V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

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

const formSchema = read(join(SCHEMAS_DIR, 'v2', 'interrupt-form.schema.json'));
function compile(schema: Json): (doc: unknown) => { ok: boolean; errors: string } {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const v = ajv.compile(schema);
  return (doc) => ({ ok: v(doc) as boolean, errors: ajv.errorsText(v.errors, { separator: '; ' }).slice(0, 600) });
}
const form = compile(formSchema);

/** The form schema with one restriction removed — the sabotage each negative must survive. */
function relaxedForm(mutate: (defs: Json) => void): (doc: unknown) => { ok: boolean; errors: string } {
  const s = clone(formSchema);
  mutate((s as { $defs: Json }).$defs);
  return compile(s);
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
const NOT_A_CHECKOUT = 'not a spec checkout — this corpus gate reads the repository tree';

const positives = readdirSync(FX_DIR).filter((f) => f.startsWith('positive-') && f.endsWith('.json')).sort();
const neg = (name: string): Json => read(join(FX_DIR, `negative-${name}.json`));
const messagesOf = (p: Json): Json[] => (p['messages'] as Json[]);
/** The one message of a negative that carries the mutation (index into messages[]). */
function upstreamVerdict(p: Json, index: number): boolean { return up(messagesOf(p)[index]).ok; }

describe('RFC 0255 §E — the form profile is a subset of upstream A2UI v0.9', () => {
  it('the vendored upstream files are the pinned bytes; every positive is a valid form and each of its messages against upstream', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    for (const [file, sha] of Object.entries(PINS)) {
      const got = createHash('sha256').update(readFileSync(join(UP_DIR, file))).digest('hex');
      expect(got, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `fixtures/upstream/a2ui-v0.9/${file} MUST be the pinned a2ui.org bytes (sha256 ${sha})`)).toBe(sha);
    }
    expect((read(join(UP_DIR, 'catalog.json')))['$id'], req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'the vendored basic catalog $id IS the catalogId the profile pins')).toBe(BASIC_CATALOG);
    expect(positives.length, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'fixtures/a2ui-v09/ MUST carry at least one positive surface')).toBeGreaterThan(0);
    for (const f of positives) {
      const p = read(join(FX_DIR, f));
      const r = form(p);
      expect(r.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `${f} MUST validate against interrupt-form.schema.json: ${r.errors}`)).toBe(true);
      messagesOf(p).forEach((m, i) => {
        const u = up(m);
        expect(u.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `${f} messages[${i}] (${Object.keys(m).find((k) => k !== 'version')}) MUST validate against upstream A2UI v0.9 server_to_client.json: ${u.errors}`)).toBe(true);
      });
    }
  });
});

describe('RFC 0255 §E — a form action is the server-event arm, resume only', () => {
  it('a functionCall action (openUrl) and an event.name outside the allowlist are refused, and only because of $defs/action', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const loose = relaxedForm((d) => { d['action'] = { anyOf: [{ type: 'object', required: ['event'], properties: { event: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, context: { type: 'object' } } } } }, { type: 'object', required: ['functionCall'] }] }; });
    for (const name of ['functioncall-openurl', 'event-name-deleteall']) {
      const p = neg(name);
      expect(form(p).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `negative-${name} MUST fail interrupt-form.schema.json (interrupt-form-action-confinement)`)).toBe(false);
      const l = loose(p);
      expect(l.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `negative-${name} MUST pass the form once $defs/action admits upstream's Action arms — otherwise it fails for another reason and witnesses nothing: ${l.errors}`)).toBe(true);
      expect(upstreamVerdict(p, 1), req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `upstream A2UI accepts negative-${name} — the refusal is the profile's`)).toBe(true);
    }
  });
});

describe('RFC 0255 §E — no secret input', () => {
  it('TextField.variant "obscured" is refused, and only because the variant enum excludes it', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const p = neg('textfield-obscured');
    expect(form(p).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'negative-textfield-obscured MUST fail interrupt-form.schema.json (interrupt-form-no-secret-input)')).toBe(false);
    const loose = relaxedForm((d) => { ((((d['TextField'] as Json)['properties'] as Json)['variant']) as { enum: string[] }).enum.push('obscured'); });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `negative-textfield-obscured MUST pass once "obscured" is restored to the variant enum: ${l.errors}`)).toBe(true);
    expect(upstreamVerdict(p, 1), req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'upstream A2UI accepts an obscured TextField — the refusal is the profile\'s')).toBe(true);
  });
});

describe('RFC 0255 §E — no egress-bearing components', () => {
  it('Image and theme.iconUrl are refused, each only because of its exclusion; no URL-fetching component is in the profile', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    {
    const p = neg('image-component');
    expect(form(p).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'negative-image-component MUST fail interrupt-form.schema.json (interrupt-form-no-network-egress)')).toBe(false);
    const loose = relaxedForm((d) => {
      d['Image'] = { type: 'object', additionalProperties: false, required: ['id', 'component', 'url'], properties: { id: { $ref: '#/$defs/componentId' }, component: { type: 'string', enum: ['Image'] }, url: { type: 'string' } } };
      ((d['component'] as { anyOf: Json[] }).anyOf).push({ $ref: '#/$defs/Image' });
    });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `negative-image-component MUST pass once Image joins the component anyOf: ${l.errors}`)).toBe(true);
    expect(upstreamVerdict(p, 1), req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'upstream A2UI accepts an Image component — the refusal is the profile\'s')).toBe(true);
    }
    {
    const p = neg('theme-iconurl');
    expect(form(p).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'negative-theme-iconurl MUST fail interrupt-form.schema.json')).toBe(false);
    const loose = relaxedForm((d) => { const theme = ((((d['createSurface'] as Json)['properties'] as Json)['createSurface'] as Json)['properties'] as Json)['theme'] as Json; (theme['properties'] as Json)['iconUrl'] = { type: 'string' }; });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `negative-theme-iconurl MUST pass once theme admits iconUrl: ${l.errors}`)).toBe(true);
    expect(upstreamVerdict(p, 0), req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'upstream A2UI accepts theme.iconUrl — the refusal is the profile\'s')).toBe(true);
    }
    const names = ((formSchema['$defs'] as Json)['component'] as { anyOf: Array<{ $ref: string }> }).anyOf.map((b) => b.$ref.replace('#/$defs/', ''));
    for (const excluded of ['Image', 'Video', 'AudioPlayer', 'Icon']) {
      expect(names, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `${excluded} MUST NOT be a member of $defs/component`)).not.toContain(excluded);
    }
  });
});

describe('RFC 0255 §E — the catalog is pinned', () => {
  it('a foreign catalogId is refused, and only because catalogId is an enum', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const p = neg('foreign-catalog');
    expect(form(p).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'negative-foreign-catalog MUST fail interrupt-form.schema.json — catalogId is the host-pinned set, never a free string')).toBe(false);
    const loose = relaxedForm((d) => { d['catalogId'] = { type: 'string' }; });
    const l = loose(p);
    expect(l.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `negative-foreign-catalog MUST pass once catalogId is a free string: ${l.errors}`)).toBe(true);
    expect(((formSchema['$defs'] as Json)['catalogId'] as { enum: string[] }).enum, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'the pinned set is exactly the basic catalog today')).toEqual([BASIC_CATALOG]);
  });
});

describe('RFC 0255 §E — closed components, no FunctionCall values', () => {
  it('an extra component property and a formatString text value are refused (the second is accepted upstream)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    for (const name of ['extra-property', 'formatstring-label']) {
      expect(form(neg(name)).ok, req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'interrupt.md §Forms', `negative-${name} MUST fail interrupt-form.schema.json`)).toBe(false);
    }
    const loose = relaxedForm((d) => { (d['dynString'] as { anyOf: Json[] }).anyOf.push({ type: 'object', required: ['call'] }); });
    expect(loose(neg('formatstring-label')).ok, req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'interrupt.md §Forms', 'negative-formatstring-label MUST pass once dynString admits a FunctionCall')).toBe(true);
    expect(upstreamVerdict(neg('formatstring-label'), 1), req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'interrupt.md §Forms', 'upstream A2UI accepts a formatString text value — the refusal is the profile\'s')).toBe(true);
    expect(upstreamVerdict(neg('extra-property'), 1), req('openwop.it.a2ui-v09-profile.closed-components-no-function-values', 'interrupt.md §Forms', 'upstream A2UI also refuses an extra property (unevaluatedProperties: false)')).toBe(false);
  });
});

/**
 * RFC 0255 §E — the declarative form on a `clarification` interrupt
 * (`interrupt.md` §Forms) carries the same closed profile in its own file,
 * `schemas/v2/interrupt-form.schema.json`, so the deletion of the envelope kind
 * cannot take the closed catalog, the action confinement or the secret-input
 * exclusion with it. Its action is tighter: `resume` only.
 */
const INPUTS = new Set(['TextField', 'CheckBox', 'ChoicePicker', 'DateTimeInput', 'field.text', 'field.date', 'field.select', 'field.checkbox']);
/** Every input component id in a form, in either version. */
function inputIds(f: Json): string[] {
  const comps: Json[] = [];
  const v1 = f['surface'] as { components?: Json[] } | undefined;
  if (v1?.components) comps.push(...v1.components);
  const v2s = Array.isArray(f['surfaces']) ? (f['surfaces'] as Json[]) : f['messages'] ? [f] : [];
  for (const s of v2s) for (const m of (s['messages'] as Json[])) comps.push(...(((m['updateComponents'] as Json | undefined)?.['components'] as Json[] | undefined) ?? []));
  return comps.filter((c) => INPUTS.has(String(c['component']))).map((c) => String(c['id']));
}
const fixtureNode = (id: string): { questions: Array<{ id: string }>; form: Json } => (read(join(FIXTURES_DIR, `${id}.json`)) as unknown as { nodes: Array<{ config: { questions: Array<{ id: string }>; form: Json } }> }).nodes[0]!.config;

describe('RFC 0255 §E — the interrupt form carries the closed profile', () => {
  it('every positive surface is a valid form, every negative is refused, and the form refuses an exchange target', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    for (const f of positives) {
      const r = form(read(join(FX_DIR, f)));
      expect(r.ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `${f} MUST validate against interrupt-form.schema.json: ${r.errors}`)).toBe(true);
    }
    for (const f of readdirSync(FX_DIR).filter((n) => n.startsWith('negative-')).sort()) {
      expect(form(read(join(FX_DIR, f))).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `${f} MUST fail interrupt-form.schema.json`)).toBe(false);
    }
    const exchange = clone(read(join(FX_DIR, positives[0] ?? 'positive-approve-brief.json')));
    const comps = ((messagesOf(exchange)[1]!['updateComponents'] as Json)['components'] as Json[]);
    const button = comps.find((c) => c['component'] === 'Button')!;
    (button['action'] as { event: { name: string } }).event.name = 'exchange';
    const withExchange = relaxedForm((d) => { (((((d['action'] as Json)['properties'] as Json)['event'] as Json)['properties'] as Json)['name'] as { enum: string[] }).enum.push('exchange'); });
    expect(withExchange(exchange).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'control: the form admits an exchange action once `exchange` joins the event name enum')).toBe(true);
    expect(form(exchange).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'a form action MUST resolve only its own interrupt — `exchange` is refused')).toBe(false);
    const obscured = neg('textfield-obscured');
    const loose = relaxedForm((d) => { ((((d['TextField'] as Json)['properties'] as Json)['variant']) as { enum: string[] }).enum.push('obscured'); });
    expect(loose(obscured).ok, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', 'negative-textfield-obscured MUST pass the form once "obscured" is restored — the variant enum alone refuses it')).toBe(true);
    const names = ((formSchema['$defs'] as Json)['component'] as { anyOf: Array<{ $ref: string }> }).anyOf.map((b) => b.$ref.replace('#/$defs/', ''));
    for (const excluded of ['Image', 'Video', 'AudioPlayer', 'Icon']) {
      expect(names, req('openwop.requirement.0255.interrupt-form-profile', 'interrupt.md §Forms', `${excluded} MUST NOT be a form component`)).not.toContain(excluded);
    }
  });

  it('a form can appear only on a clarification, so it can never resolve an approval', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const defs = read(join(SCHEMAS_DIR, 'v2', 'suspend-request.schema.json'))['$defs'] as Record<string, { properties?: Json }>;
    const carriers = Object.entries(defs).filter(([, d]) => d.properties && 'form' in d.properties).map(([k]) => k);
    expect(carriers, req('openwop.requirement.0255.interrupt-form-never-resolves-approval', 'interrupt.md §Forms', 'ClarificationData MUST be the only interrupt data shape carrying `form`')).toEqual(['ClarificationData']);
    expect(((defs['ClarificationData']!.properties!['form'] as Json)['$ref']), req('openwop.requirement.0255.interrupt-form-never-resolves-approval', 'interrupt.md §Forms', 'ClarificationData.form MUST be the interrupt-form schema')).toBe('interrupt-form.schema.json');
    const v1Target = (((((formSchema['$defs'] as Json)['actionButton'] as Json)['properties'] as Json)['action'] as Json)['properties'] as Json)['target'] as { enum: string[] };
    const v2Name = ((((((formSchema['$defs'] as Json)['action'] as Json)['properties'] as Json)['event'] as Json)['properties'] as Json)['name']) as { enum: string[] };
    expect([v1Target.enum, v2Name.enum], req('openwop.requirement.0255.interrupt-form-never-resolves-approval', 'interrupt.md §Forms', 'the only form action in either version MUST be `resume`')).toEqual([['resume'], ['resume']]);
  });

  it('the form fixtures bind their inputs to questions, and each probe is refused for exactly one reason', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const ok = fixtureNode('conformance-interrupt-form');
    expect(form(ok.form).ok, req('openwop.requirement.0255.interrupt-form-bound-to-questions', 'interrupt.md §Forms', `conformance-interrupt-form MUST carry a valid form: ${form(ok.form).errors}`)).toBe(true);
    expect(inputIds(ok.form), req('openwop.requirement.0255.interrupt-form-bound-to-questions', 'interrupt.md §Forms', 'every input id MUST be a questions[].id')).toEqual(ok.questions.map((q) => q.id));
    const refused = fixtureNode('conformance-interrupt-form-refused');
    const loose = relaxedForm((d) => { ((((d['TextField'] as Json)['properties'] as Json)['variant']) as { enum: string[] }).enum.push('obscured'); });
    expect([form(refused.form).ok, loose(refused.form).ok], req('openwop.requirement.0255.interrupt-form-bound-to-questions', 'interrupt.md §Forms', '-refused MUST fail the form schema, and only because of the obscured variant')).toEqual([false, true]);
    expect(inputIds(refused.form), req('openwop.requirement.0255.interrupt-form-bound-to-questions', 'interrupt.md §Forms', '-refused MUST otherwise bind to its questions')).toEqual(refused.questions.map((q) => q.id));
    const unbound = fixtureNode('conformance-interrupt-form-unbound');
    expect(form(unbound.form).ok, req('openwop.requirement.0255.interrupt-form-bound-to-questions', 'interrupt.md §Forms', `-unbound MUST be schema-valid, so only the binding rule refuses it: ${form(unbound.form).errors}`)).toBe(true);
    expect(inputIds(unbound.form).filter((id) => !unbound.questions.some((q) => q.id === id)), req('openwop.requirement.0255.interrupt-form-bound-to-questions', 'interrupt.md §Forms', '-unbound MUST carry an input bound to no question')).toEqual(['q2']);
  });
});
