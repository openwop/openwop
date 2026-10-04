/**
 * v2 — prompt wire shapes (`schemas/v2/prompt-kind.schema.json`,
 * `prompt-template.schema.json`, `prompt-ref.schema.json`,
 * `prompt-pack-manifest.schema.json`; `spec/v2/core/host-services.md`
 * §`prompts`; RFCs 0027, 0028). The v1 twin is `prompt-template-shape`.
 *
 * Server-free: the four-kind enum; PromptTemplate round-trips and is CLOSED at
 * v2 (an unknown property is rejected, an `x-`/`vendor.`/`openwop-` extension
 * is admitted); a `source: pack` meta without `packName`/`packVersion` is
 * rejected; PromptRef's two forms; and a `kind: "prompt"` pack manifest
 * carries no `nodes[]` or `chains[]` (host-services.md §Library).
 *
 * Live (gated by the presence of the v2 `prompts` record, `inapplicable` when
 * absent): the advertised record validates against the v2 capabilities schema
 * — no `supported` seat, `maxTemplateBytes` ≤ 65536, the closed facet set.
 *
 * @see spec/v2/core/host-services.md §prompts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { familyAdvertised, v2Discovery, v2RefValidator, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'schemas/v2/prompt-template.schema.json';
const ID_KIND = 'openwop.requirement.prompts.prompt-kind-enum';
const ID_TEMPLATE = 'openwop.requirement.prompts.prompt-template-shape';
const ID_CLOSED = 'openwop.requirement.prompts.prompt-template-closed';
const ID_REF = 'openwop.requirement.prompts.prompt-ref-forms';
const ID_PACK = 'openwop.requirement.prompts.prompt-pack-manifest-shape';
const ID_RECORD = 'openwop.requirement.prompts.capability-record-shape';
const HTTP_SKIP = !process.env['OPENWOP_BASE_URL'];

const template = v2Validator('prompt-template');
const ref = v2Validator('prompt-ref');
const manifest = v2Validator('prompt-pack-manifest');
const record = v2RefValidator('capabilities.schema.json#/properties/prompts');
const minimal = { templateId: 'writer-system', version: '1.0.0', kind: 'system', text: 'You are a careful editorial writer.' };

describe('v2 prompt shapes: PromptKind and PromptTemplate (server-free)', () => {
  it('prompt-kind is a string enum of exactly the four kinds', () => {
    const k = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'prompt-kind.schema.json'), 'utf8')) as { type?: unknown; enum?: unknown };
    expect(k.type, req(ID_KIND, 'schemas/v2/prompt-kind.schema.json', 'prompt-kind MUST be type string')).toBe('string');
    expect(k.enum, req(ID_KIND, 'schemas/v2/prompt-kind.schema.json', 'prompt-kind MUST be exactly system, user, few-shot, schema-hint')).toEqual(['system', 'user', 'few-shot', 'schema-hint']);
  });

  it('a minimal and a full PromptTemplate validate; a missing text, a non-SemVer version, a bad templateId or kind, or a dashed variable name is rejected', () => {
    expect(template(minimal).ok, req(ID_TEMPLATE, DOC, `a minimal PromptTemplate MUST validate: ${template(minimal).errors}`)).toBe(true);
    const full = {
      templateId: 'writer-user', version: '1.2.3', kind: 'user', text: 'Write about: {{topic}}\nTone: {{tone}}', name: 'Writer', description: 'Two variables.',
      variables: [{ name: 'topic', type: 'string', required: true, source: 'input' }, { name: 'tone', type: 'string', required: false, source: 'input', defaultValue: 'neutral' }],
      modelHints: { modelClass: 'writing', temperature: 0.7 }, tags: ['editorial'], meta: { author: 'openwop-conformance', createdAt: '2026-05-20T10:00:00Z', source: 'host' },
    };
    expect(template(full).ok, req(ID_TEMPLATE, DOC, `a full PromptTemplate MUST validate: ${template(full).errors}`)).toBe(true);
    const { text: _t, ...noText } = minimal;
    expect(template(noText).ok, req(ID_TEMPLATE, DOC, 'text is REQUIRED')).toBe(false);
    expect(template({ ...minimal, version: 'v1' }).ok, req(ID_TEMPLATE, DOC, 'version MUST be SemVer')).toBe(false);
    // v2 templateId is the author-minted ids.schema.json grammar `^[A-Za-z0-9._~:-]{1,128}$` (v1 rejected upper case; v2 does not).
    expect(template({ ...minimal, templateId: 'writer/system' }).ok, req(ID_TEMPLATE, 'schemas/v2/ids.schema.json §templateId', 'templateId MUST match the templateId grammar (no /)')).toBe(false);
    expect(template({ ...minimal, kind: 'made-up-kind' }).ok, req(ID_TEMPLATE, DOC, 'kind MUST be one of the four')).toBe(false);
    expect(template({ ...minimal, variables: [{ name: 'has-dash', type: 'string', required: true }] }).ok, req(ID_TEMPLATE, DOC, 'a variable name MUST be a templating identifier (no dashes)')).toBe(false);
  });

  it('PromptTemplate is closed: an unknown property is rejected, an extension-prefixed one admitted, and a pack meta must carry its stamps', () => {
    expect(template({ ...minimal, unknownExtra: 'x' }).ok, req(ID_CLOSED, DOC, 'an unknown top-level property MUST be rejected')).toBe(false);
    expect(template({ ...minimal, 'x-acme-note': 'ok' }).ok, req(ID_CLOSED, `${DOC} patternProperties (RFC 0138)`, 'an x- extension property MUST be admitted')).toBe(true);
    expect(template({ ...minimal, variables: [{ name: 'topic', type: 'string', required: true, extra: 1 }] }).ok, req(ID_CLOSED, DOC, 'PromptVariable is closed')).toBe(false);
    expect(template({ ...minimal, meta: { source: 'pack' } }).ok, req(ID_CLOSED, 'host-services.md §Library', 'a pack template MUST carry meta.packName and meta.packVersion')).toBe(false);
    expect(template({ ...minimal, meta: { source: 'pack', packName: 'vendor.openwop.prompt-sample', packVersion: '1.0.0' } }).ok, req(ID_CLOSED, DOC, 'a stamped pack template MUST validate')).toBe(true);
  });
});

describe('v2 prompt shapes: PromptRef (server-free)', () => {
  it('the string and object forms validate; a missing prefix, a non-SemVer version, a missing templateId or an unknown property is rejected', () => {
    for (const ok of ['prompt:writer-system', 'prompt:writer-system@1.2.3', 'prompt:vendor.acme.writer.v2@2.0.0']) {
      expect(ref(ok).ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', `${ok} MUST validate`)).toBe(true);
    }
    expect(ref({ templateId: 'writer-system' }).ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', 'the object form with templateId alone MUST validate')).toBe(true);
    expect(ref({ libraryId: 'vendor.acme.editorial-prompts', templateId: 'writer-system', version: '1.0.0', variableOverrides: { tone: 'formal' } }).ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', 'the full object form MUST validate')).toBe(true);
    expect(ref('writer-system').ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', 'a string ref MUST start with prompt:')).toBe(false);
    expect(ref('prompt:writer-system@latest').ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', 'a string ref version MUST be SemVer')).toBe(false);
    expect(ref({ version: '1.0.0' }).ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', 'the object form MUST carry templateId')).toBe(false);
    expect(ref({ templateId: 'writer-system', unknownExtra: true }).ok, req(ID_REF, 'schemas/v2/prompt-ref.schema.json', 'the object form is closed')).toBe(false);
  });
});

describe('v2 prompt shapes: the prompt pack manifest (server-free)', () => {
  it('a kind prompt pack validates and carries no nodes or chains', () => {
    const good = { name: 'vendor.openwop.prompt-sample', version: '1.0.0', kind: 'prompt', engines: { openwop: '>=2.0.0' }, prompts: [minimal] };
    expect(manifest(good).ok, req(ID_PACK, 'schemas/v2/prompt-pack-manifest.schema.json', `a conforming prompt pack MUST validate: ${manifest(good).errors}`)).toBe(true);
    expect(manifest({ ...good, nodes: [] }).ok, req(ID_PACK, 'host-services.md §Library', 'a kind prompt pack MUST NOT carry nodes[]')).toBe(false);
    expect(manifest({ ...good, chains: [] }).ok, req(ID_PACK, 'host-services.md §Library', 'a kind prompt pack MUST NOT carry chains[]')).toBe(false);
    expect(manifest({ ...good, kind: 'node' }).ok, req(ID_PACK, 'schemas/v2/prompt-pack-manifest.schema.json', 'kind MUST be prompt')).toBe(false);
    expect(manifest({ ...good, prompts: [] }).ok, req(ID_PACK, 'schemas/v2/prompt-pack-manifest.schema.json', 'a prompt pack MUST ship at least one template')).toBe(false);
  });
});

describe('v2 prompt shapes: the advertised prompts record (live)', () => {
  it('the prompts record, when advertised, validates against the v2 capabilities schema', async () => {
    if (HTTP_SKIP) return softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset');
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0');
    const prompts = await familyAdvertised('prompts');
    if (prompts === null) return softSkip('inapplicable', 'the host does not advertise prompts');
    const v = record(prompts);
    expect(v.ok, req(ID_RECORD, 'schemas/v2/capabilities.schema.json §prompts', `the prompts record MUST validate (closed, no supported seat, maxTemplateBytes ≤ 65536): ${v.errors}`)).toBe(true);
  });
});
