/**
 * a2a-parts-schemas — RFC 0205 §B, §C and §D, the server-free legs (corpus gate).
 *
 * RFC 0205 mints `schemas/v2/part.schema.json` and `schemas/v2/artifact.schema.json`
 * from A2A v1.0.1, gives both v2 turn defs an optional `parts` array, and widens
 * `exportFormats` to accept lowercase media types beside the reserved aliases.
 * These legs need no host, so they live here and mint their ids into
 * `evidence/corpus-ledger.json` (RFC 0168 §D.1). The behavioural legs are in
 * `src/scenarios/v2-artifact-a2a-shape.test.ts` and
 * `src/scenarios/v2-conversation-turn-parts.test.ts`.
 *
 * Every negative is checked twice: it must fail the schema as shipped, AND it
 * must pass a copy of the schema with exactly the rule under test removed. The
 * second check is the sabotage run inline; a negative refused for an unrelated
 * reason passes the first check and fails the second.
 *
 * Upstream is `fixtures/upstream/a2a-v1.0.1/a2a.proto`, the A2A repository's
 * `specification/a2a.proto` at tag v1.0.1, pinned by SHA-256. The schema's
 * member names are compared with the proto's field names (camelCased, A2A spec
 * §5.5), so a transcription slip, or a re-vendor to a minor that adds a field,
 * fails here (register G7).
 *
 * @see RFCS/0205-run-artifacts-and-turns-speak-a2a-parts.md
 * @see schemas/v2/part.schema.json
 * @see schemas/v2/artifact.schema.json
 */

import { describe, it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, FIXTURES_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
const read = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const V2 = join(SCHEMAS_DIR, 'v2');

const PROTO = join(FIXTURES_DIR, 'upstream', 'a2a-v1.0.1', 'a2a.proto');
/** RFC 0205 §References — `specification/a2a.proto` at tag v1.0.1, fetched 2026-09-22. */
const PROTO_SHA256 = 'e195bf96ab630c69797851970203e1b2b6b19528f2e9803b7d904b91a5104016';

const partSchema = read(join(V2, 'part.schema.json'));
const artifactSchema = read(join(V2, 'artifact.schema.json'));
const turnSchema = read(join(V2, 'conversation-turn.schema.json'));
const eventSchema = read(join(V2, 'conversation-event.schema.json'));
const payloadsSchema = read(join(V2, 'run-event-payloads.schema.json'));
const idsSchema = read(join(V2, 'ids.schema.json'));

type Validate = (doc: unknown) => { ok: boolean; errors: string };

/**
 * Compile `target` with the named-schema neighbourhood it `$ref`s. `overrides`
 * replaces a neighbour by `$id` (the sabotage copies), so a relaxed `part`
 * reaches the turn and artifact defs that reference it.
 */
function compile(target: Json, overrides: Json[] = []): Validate {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const byId = new Map<string, Json>();
  for (const s of [partSchema, idsSchema, eventSchema, turnSchema, artifactSchema, payloadsSchema, ...overrides]) byId.set(String(s['$id']), s);
  const targetId = String(target['$id'] ?? '');
  for (const [id, s] of byId) if (id !== targetId) ajv.addSchema(s);
  const v = ajv.compile(target);
  return (doc) => ({ ok: v(doc) as boolean, errors: ajv.errorsText(v.errors, { separator: '; ' }).slice(0, 600) });
}
function compileDef(host: Json, def: string, overrides: Json[] = []): Validate {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const byId = new Map<string, Json>();
  for (const s of [partSchema, idsSchema, eventSchema, turnSchema, artifactSchema, payloadsSchema, ...overrides]) byId.set(String(s['$id']), s);
  for (const s of byId.values()) ajv.addSchema(s);
  const v = ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: `${String(host['$id'])}#/$defs/${def}` });
  return (doc) => ({ ok: v(doc) as boolean, errors: ajv.errorsText(v.errors, { separator: '; ' }).slice(0, 600) });
}

const part = compile(partSchema);
const artifact = compile(artifactSchema);

describe('RFC 0205 §D — part.schema.json and artifact.schema.json are A2A v1.0.1', () => {
  it('part.schema.json and artifact.schema.json are the fields and rules of a2a.proto v1.0.1; every negative fails only by its rule', () => {
    { // the vendored a2a.proto is the pinned bytes, and each schema names exactly the fields of its proto message
    const bytes = readFileSync(PROTO);
    expect(createHash('sha256').update(bytes).digest('hex'), req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §References', `fixtures/upstream/a2a-v1.0.1/a2a.proto MUST be the pinned v1.0.1 bytes (sha256 ${PROTO_SHA256})`)).toBe(PROTO_SHA256);
    const proto = bytes.toString('utf8');
    const fields = (message: string): string[] => {
      const m = new RegExp(`^message ${message} \\{([\\s\\S]*?)^\\}`, 'm').exec(proto);
      expect(m, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `a2a.proto MUST declare message ${message}`)).not.toBeNull();
      const body = (m as RegExpExecArray)[1] as string;
      return [...body.matchAll(/^\s*(?:repeated\s+)?[\w.]+\s+(\w+)\s*=\s*\d+/gm)].map((f) => (f[1] as string).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())).sort();
    };
    const props = (s: Json): string[] => Object.keys(s['properties'] as Json).sort();
    expect(props(partSchema), req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', 'part.schema.json properties MUST be the camelCased fields of a2a.proto message Part (A2A spec §5.5)')).toEqual(fields('Part'));
    expect(props(artifactSchema), req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', 'artifact.schema.json properties MUST be the camelCased fields of a2a.proto message Artifact')).toEqual(fields('Artifact'));
    const oneof = /oneof content \{([\s\S]*?)\}/.exec(/^message Part \{[\s\S]*?^\}/m.exec(proto)?.[0] ?? '')?.[1] ?? '';
    const members = [...oneof.matchAll(/^\s*[\w.]+\s+(\w+)\s*=/gm)].map((f) => f[1]).sort();
    const branches = ((partSchema['oneOf'] as Json[]) ?? []).map((b) => (b['required'] as string[]).join(',')).sort();
    expect(branches, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', 'part.schema.json oneOf MUST have one required-branch per member of a2a.proto `oneof content`')).toEqual(members);
    expect((artifactSchema['required'] as string[]).slice().sort(), req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', 'artifact.schema.json requires exactly the two REQUIRED fields of message Artifact')).toEqual(['artifactId', 'parts']);
    }
    { // the A2A §14 "Current Pattern" parts validate; two members, none, the v0.3 kind form and an unknown key are refused, each only by its rule
    const positives: Json[] = [
      { text: 'Hello, world!' },
      { raw: 'iVBORw0KGgo=', filename: 'diagram.png', mediaType: 'image/png' },
      { data: { approve: true }, mediaType: 'application/json' },
      { data: null },
      { url: 'https://example.com/a.pdf', mediaType: 'application/pdf' },
    ];
    for (const p of positives) {
      const r = part(p);
      expect(r.ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `${JSON.stringify(p)} MUST validate against part.schema.json: ${r.errors}`)).toBe(true);
    }
    for (const ex of (partSchema['examples'] as Json[])) expect(part(ex).ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `part.schema.json examples[] MUST validate: ${JSON.stringify(ex)}`)).toBe(true);

    const noOneOf = clone(partSchema); delete noOneOf['oneOf'];
    const open = clone(partSchema); open['additionalProperties'] = true;
    const cases: Array<{ doc: Json; why: string; relaxed: Json }> = [
      { doc: { text: 'a', raw: 'YQ==' }, why: 'two content members (the member-presence discriminator admits exactly one)', relaxed: noOneOf },
      { doc: {}, why: 'no content member', relaxed: noOneOf },
      { doc: { kind: 'text', text: 'a' }, why: 'the v0.3 legacy `kind` member', relaxed: open },
      { doc: { text: 'a', extra: 1 }, why: 'an undeclared member', relaxed: open },
    ];
    for (const c of cases) {
      expect(part(c.doc).ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `${JSON.stringify(c.doc)} MUST fail part.schema.json: ${c.why}`)).toBe(false);
      const l = compile(c.relaxed)(c.doc);
      expect(l.ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `${JSON.stringify(c.doc)} MUST pass part.schema.json with only the rule under test removed (else it is refused for another reason): ${l.errors}`)).toBe(true);
    }
    }
    { // artifact.schema.json requires artifactId and at least one part, and is closed
    const ex = (artifactSchema['examples'] as Json[])[0] as Json;
    expect(artifact(ex).ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `artifact.schema.json examples[0] MUST validate: ${artifact(ex).errors}`)).toBe(true);
    const zeroOk = clone(artifactSchema); (zeroOk['properties'] as { parts: Json }).parts['minItems'] = 0;
    const noReq = clone(artifactSchema); noReq['required'] = ['parts'];
    const open = clone(artifactSchema); open['additionalProperties'] = true;
    const noId = clone(ex); delete noId['artifactId'];
    const cases: Array<{ doc: Json; why: string; relaxed: Json }> = [
      { doc: { ...clone(ex), parts: [] }, why: 'parts is empty (a2a.proto: "Must contain at least one part")', relaxed: zeroOk },
      { doc: noId, why: 'artifactId is absent (a2a.proto: REQUIRED)', relaxed: noReq },
      { doc: { ...clone(ex), taskId: 't-1' }, why: 'an unknown top-level member', relaxed: open },
    ];
    for (const c of cases) {
      expect(artifact(c.doc).ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `MUST fail artifact.schema.json: ${c.why}`)).toBe(false);
      const l = compile(c.relaxed)(c.doc);
      expect(l.ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', `MUST pass artifact.schema.json with only that rule removed (${c.why}): ${l.errors}`)).toBe(true);
    }
    const badPart = { ...clone(ex), parts: [{ text: 'a', raw: 'YQ==' }] };
    expect(artifact(badPart).ok, req('openwop.requirement.0205.part-schema-upstream', 'RFC 0205 §D', 'artifact.schema.json parts[] MUST be part.schema.json (a two-member part fails)')).toBe(false);
    }
  });
});

const validTurn = (): Json => ({ messageId: 'c-1:1:agent', from: 'host:agent-a', content: 'hello', ts: 1718900000000, role: 'agent', turnIndex: 1, speakerId: 'host:agent-a' });

describe('RFC 0205 §B — both v2 turn defs carry an optional Part[] `parts`', () => {
  const defs: Array<{ name: string; v: Validate; relax: (s: Json) => Validate }> = [
    {
      name: 'conversation-turn.schema.json',
      v: compile(turnSchema),
      relax: (p) => compile(turnSchema, [p]),
    },
    {
      name: 'conversation-event.schema.json#/$defs/ConversationTurn',
      v: compileDef(eventSchema, 'ConversationTurn'),
      relax: (p) => compileDef(eventSchema, 'ConversationTurn', [p]),
    },
  ];

  it('both v2 turn defs and conversation.exchanged accept a valid Part[] parts and refuse a bad one; the v1 turn is unchanged', () => {
    { // a turn with valid parts, and a turn without parts, validate; empty parts and a two-member part fail both defs
    const noOneOf = clone(partSchema); delete noOneOf['oneOf'];
    for (const d of defs) {
      const R = (why: string) => req('openwop.requirement.0205.turn-parts-shape', 'RFC 0205 §B.5', `${d.name}: ${why}`);
      const withParts = d.v({ ...validTurn(), parts: [{ text: 'hello' }, { data: { a: 1 }, mediaType: 'application/json' }] });
      expect(withParts.ok, R(`a turn carrying parts [{text},{data}] MUST validate: ${withParts.errors}`)).toBe(true);
      expect(d.v(validTurn()).ok, R('a turn without parts MUST still validate (§B.7)')).toBe(true);
      expect(d.v({ ...validTurn(), parts: [] }).ok, R('parts: [] MUST fail (non-empty array)')).toBe(false);
      const two = { ...validTurn(), parts: [{ text: 'a', raw: 'YQ==' }] };
      expect(d.v(two).ok, R('parts: [{text, raw}] MUST fail (items are part.schema.json)')).toBe(false);
      expect(d.relax(noOneOf)(two).ok, R('the two-member part MUST pass once part.schema.json loses its oneOf — so the refusal is the Part rule, not another')).toBe(true);
      expect(d.v({ ...validTurn(), parts: 'hello' }).ok, R('parts MUST be an array')).toBe(false);
    }
    }
    { // conversation.exchanged inherits parts through its `turn` $ref
    const ex = compileDef(payloadsSchema, 'conversationExchanged');
    const good = { conversationId: 'c-1', turnIndex: 1, turn: { ...validTurn(), parts: [{ text: 'hello' }] } };
    const r = ex(good);
    expect(r.ok, req('openwop.requirement.0205.turn-parts-shape', 'RFC 0205 §B.5', `a conversation.exchanged payload whose turn carries parts MUST validate against run-event-payloads#/$defs/conversationExchanged: ${r.errors}`)).toBe(true);
    const bad = { ...good, turn: { ...good.turn, parts: [{ kind: 'text', text: 'hello' }] } };
    expect(ex(bad).ok, req('openwop.requirement.0205.turn-parts-shape', 'RFC 0205 §B.5', 'a conversation.exchanged turn carrying a v0.3 `kind` part MUST fail — the payload def reaches part.schema.json')).toBe(false);
    }
    { // the v1 turn schema is unchanged: it declares no parts (§B.8)
    const v1 = read(join(SCHEMAS_DIR, 'conversation-turn.schema.json'));
    expect(Object.keys(v1['properties'] as Json), req('openwop.requirement.0205.turn-parts-shape', 'RFC 0205 §B.8', 'schemas/conversation-turn.schema.json (v1) MUST NOT declare parts — the open v1 def would newly reject an undeclared parts key of another shape')).not.toContain('parts');
    }
  });

  it('the two v2 turn defs carry deep-equal parts subschemas', () => {
    const a = (turnSchema['properties'] as Json)['parts'];
    const b = (((eventSchema['$defs'] as Json)['ConversationTurn'] as Json)['properties'] as Json)['parts'];
    expect(a, req('openwop.requirement.0205.turn-mirror-sync', 'RFC 0205 §B.5', 'conversation-turn.schema.json MUST declare parts')).toBeDefined();
    expect(b, req('openwop.requirement.0205.turn-mirror-sync', 'RFC 0205 §B.5', 'conversation-event.schema.json#/$defs/ConversationTurn MUST declare parts')).toBeDefined();
    expect(b, req('openwop.requirement.0205.turn-mirror-sync', 'RFC 0205 §B.5', 'the two parts subschemas MUST be deep-equal (kept in sync)')).toEqual(a);
    expect(turnSchema['x-openwop-seeded-from'], req('openwop.requirement.0205.turn-mirror-sync', 'RFC 0205 Implementation notes', 'conversation-turn.schema.json MUST NOT carry x-openwop-seeded-from — it is no longer re-seeded from the open v1 def')).toBeUndefined();
  });
});

/** RFC 0205 §C.10 — the alias table, verified against the IANA registry 2026-09-22. */
const ALIASES: Record<string, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown',
  html: 'text/html',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  png: 'image/png',
  svg: 'image/svg+xml',
  jpeg: 'image/jpeg',
  step: 'model/step',
  stl: 'model/stl',
  dxf: 'image/vnd.dxf',
};

function manifest(exportFormats: string[]): Json {
  return {
    kind: 'artifact-type',
    name: 'vendor.acme.cad',
    version: '1.0.0',
    engines: { openwop: '>=1.1 <3.0.0' },
    artifactTypes: [{ artifactTypeId: 'vendor.acme.cad.model', schemaVersion: 1, schemaRef: 'schemas/cad-model.schema.json', exportFormats }],
  };
}
/** Compile a manifest schema; the v2 one `$ref`s `ids.schema.json` (v1 has none). */
function manifestValidator(s: Json): Validate {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  if (String(s['$id']).includes('/spec/v2/')) ajv.addSchema(idsSchema);
  const v = ajv.compile(s);
  return (doc) => ({ ok: v(doc) as boolean, errors: ajv.errorsText(v.errors, { separator: '; ' }).slice(0, 600) });
}
const exportItems = (s: Json): Json => ((((s['$defs'] as Json)['ArtifactType'] as Json)['properties'] as Json)['exportFormats'] as Json);

describe('RFC 0205 §C — exportFormats accepts lowercase media types beside the reserved aliases', () => {
  const schemas: Array<{ name: string; path: string }> = [
    { name: 'schemas/v2/artifact-type-pack-manifest.schema.json', path: join(V2, 'artifact-type-pack-manifest.schema.json') },
    { name: 'schemas/artifact-type-pack-manifest.schema.json', path: join(SCHEMAS_DIR, 'artifact-type-pack-manifest.schema.json') },
  ];

  it('exportFormats accepts the aliases and lowercase media types, the alias table is the IANA-verified fifteen, and PPTX / Application/PDF / parameters are refused', () => {
    { // every alias and every alias-table media type validates; media types beyond the table validate
    for (const s of schemas) {
      const v = manifestValidator(read(s.path));
      const R = (why: string) => req('openwop.requirement.0205.export-media-type', 'RFC 0205 §C.9', `${s.name}: ${why}`);
      const pos = v(manifest(['application/pdf', 'model/step', ALIASES['pptx'] as string]));
      expect(pos.ok, R(`['application/pdf','model/step','<pptx media type, 73 chars>'] MUST validate: ${pos.errors}`)).toBe(true);
      for (const [alias, mt] of Object.entries(ALIASES)) {
        expect(v(manifest([alias])).ok, R(`the reserved alias ${alias} MUST still validate`)).toBe(true);
        expect(v(manifest([mt])).ok, R(`the alias table media type ${mt} MUST validate`)).toBe(true);
      }
      expect(v(manifest(['vendor.acme.step-ap242', 'x-glb'])).ok, R('vendor.* and x- identifiers MUST still validate')).toBe(true);
    }
    }
    { // the alias table in artifact-type-packs.md is exactly the IANA-verified fifteen
    const doc = V1_DIR === null ? null : readFileSync(join(V1_DIR, 'artifact-type-packs.md'), 'utf8');
    expect(doc, req('openwop.requirement.0205.export-media-type', 'RFC 0205 §C.12', 'the corpus gate reads the alias table from spec/v1/artifact-type-packs.md')).not.toBeNull();
    const md = doc as string;
    const sec = /^### Export-format aliases$([\s\S]*?)^### /m.exec(md)?.[1] ?? '';
    const rows = [...sec.matchAll(/^\| `([a-z0-9]+)` \| `([^`]+)` \|/gm)].map((m) => [m[1] as string, m[2] as string]);
    expect(Object.fromEntries(rows), req('openwop.requirement.0205.export-media-type', 'RFC 0205 §C.10', 'artifact-type-packs.md §"Export-format aliases" MUST map each reserved alias to exactly the RFC 0205 §C.10 media type')).toEqual(ALIASES);
    }
    { // PPTX, Application/PDF and a parameterized media type are refused — the first by the pre-0205 rule, the second only by lowercase
    for (const s of schemas) {
      const schema = read(s.path);
      const v = manifestValidator(schema);
      const R = (why: string) => req('openwop.requirement.0205.export-media-type', 'RFC 0205 §C.9', `${s.name}: ${why}`);
      for (const bad of ['PPTX', 'Application/PDF', 'text/csv; charset=utf-8', 'application/', '/pdf']) {
        expect(v(manifest([bad])).ok, R(`'${bad}' MUST fail exportFormats`)).toBe(false);
      }
      const items = exportItems(schema)['items'] as Json;
      const mixedCase = clone(schema);
      const mi = exportItems(mixedCase)['items'] as Json;
      mi['pattern'] = String(items['pattern']).replace('|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126})$', () => '|[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126})$');
      expect(mi['pattern'], R('the media-type alternative MUST be the RFC 0205 §C.9 lowercase restricted-name form')).not.toBe(items['pattern']);
      expect(manifestValidator(mixedCase)(manifest(['Application/PDF'])).ok, R('Application/PDF MUST pass once the media-type alternative admits uppercase — so lowercase is what refuses it')).toBe(true);
      const short = clone(schema);
      (exportItems(short)['items'] as Json)['maxLength'] = 64;
      expect(manifestValidator(short)(manifest([ALIASES['pptx'] as string])).ok, R('the 73-char pptx media type MUST fail at maxLength 64 — so the length widening is load-bearing')).toBe(false);
      expect(items['maxLength'], R('maxLength MUST be 255')).toBe(255);
    }
    }
  });
});
