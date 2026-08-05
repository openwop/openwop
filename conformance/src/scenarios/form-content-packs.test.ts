/**
 * Form-content packs (RFC 0137, `Active`).
 *
 * A form-content pack (`kind: "form-content"`) distributes FORM TEMPLATES — a
 * named, versioned, ordered set of typed input fields a host instantiates into
 * an ordinary, fully editable form through its normal create path. It is the
 * sixth declarative pack kind under RFC 0107 and is purely inert: no `runtime`,
 * no entry point, no handler, no submission surface the host would not
 * otherwise accept.
 *
 * Always-on + server-free. Three parts:
 *
 *   PART 1 — contract present. `form-content-packs.md` carries the
 *   instantiation rules + the F1 trust boundary; `registry-operations.md`
 *   §"Validation flow" selects the per-kind source schema for `form-content`
 *   and skips the runtime check for it. Guards against the requirement being
 *   silently dropped.
 *
 *   PART 2 — the version-manifest schema admits the kind and still rejects
 *   malformed ones. Includes an explicit leg for the `anyOf` payload gate:
 *   extending the `kind` enum and declaring `templates` is NECESSARY BUT NOT
 *   SUFFICIENT — without a `templates` branch in `anyOf`, every form-content
 *   manifest is rejected. That omission is believed to be the second face of
 *   the CI failure that motivated RFC 0137, so it gets its own assertion.
 *
 *   PART 3 — the field vocabulary is SHARED, not forked. `fields[].type` in
 *   `form-content-pack-manifest.schema.json` MUST be byte-identical to
 *   `InputField.type` in `chat-card-pack-manifest.schema.json`. Two declarative
 *   kinds that both collect typed user input, rendered by the same host
 *   machinery, MUST agree on what a field type means. This is the regression
 *   guard for RFC 0137 R2: it fails the moment either kind's vocabulary is
 *   widened alone.
 *
 * @see spec/v1/form-content-packs.md
 * @see spec/v1/chat-card-packs.md §"Input fields — a closed portable subset"
 * @see spec/v1/registry-operations.md §"Validation flow"
 * @see schemas/form-content-pack-manifest.schema.json
 * @see RFCS/0137-form-content-packs.md, RFCS/0107-publishable-declarative-pack-kinds.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

const readSchema = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8'));

describe('form-content-packs: contract present in the corpus (RFC 0137, server-free)', () => {
  const registryDoc = V1_DIR ? readFileSync(join(V1_DIR, 'registry-operations.md'), 'utf8') : '';
  const formDoc = V1_DIR ? readFileSync(join(V1_DIR, 'form-content-packs.md'), 'utf8') : '';

  it.skipIf(V1_DIR === null)('registry-operations.md §Validation flow selects the form-content source schema by `kind`', () => {
    expect(
      /form-content[\s\S]{0,160}form-content-pack-manifest\.schema\.json/.test(registryDoc),
      why('registry-operations.md §Validation flow #3', '`kind: "form-content"` validates against its own source schema (RFC 0137)'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('registry-operations.md skips the runtime-support check for form-content', () => {
    expect(
      /declarative[\s\S]{0,200}form-content/.test(registryDoc),
      why('registry-operations.md §Validation flow #7', 'form-content is a declarative kind — the runtime check is skipped'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('registry-operations.md extends the declarative-id denormalization to templateId', () => {
    expect(
      /templates\[\]\.templateId/.test(registryDoc),
      why('registry-operations.md §Type-ID indexing', 'a registry SHOULD denormalize `templates[].templateId` (RFC 0137)'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('form-content-packs.md requires the host to use its NORMAL create path and execute nothing', () => {
    expect(
      /MUST[\s\S]{0,120}normal[\s\S]{0,40}create path/i.test(formDoc),
      why('form-content-packs.md §Instantiation', 'the host MUST instantiate through its normal create path'),
    ).toBe(true);
    expect(
      /MUST NOT execute anything from the pack/i.test(formDoc),
      why('form-content-packs.md §Instantiation', 'the host MUST NOT execute anything from the pack — the kind is inert'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('form-content-packs.md carries the F1 trust boundary, incl. "a signature is not content trust"', () => {
    expect(
      /untrusted/i.test(formDoc) && /contentTrust/.test(formDoc),
      why('form-content-packs.md §Trust boundary', 'pack-authored strings are untrusted; prompts propagate meta.contentTrust'),
    ).toBe(true);
    expect(
      /signature proves[\s\S]{0,80}not[\s\S]{0,60}trustworthy|MUST NOT treat pack provenance as content trust/i.test(formDoc),
      why('form-content-packs.md §Trust boundary', 'a signature proves authorship, NOT that the authored bytes are safe'),
    ).toBe(true);
    expect(
      /Length bounds are not a trust boundary/i.test(formDoc),
      why('form-content-packs.md §Trust boundary', 'maxLength is a resource guard, NOT sanitization'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('form-content-packs.md forbids minting a second field-type vocabulary', () => {
    expect(
      /MUST NOT\W{0,4}\s*define its own field-type vocabulary/i.test(formDoc),
      why('form-content-packs.md §Field types', 'the kind reuses the RFC 0071 portable subset rather than defining its own'),
    ).toBe(true);
  });
});

describe('form-content-packs: version-manifest schema admits the kind (RFC 0137, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const versionManifestSchema = readSchema('registry-version-manifest.schema.json');
  const validate = ajv.compile(versionManifestSchema);

  const base = { name: 'core.openwop.forms', version: '1.0.0', engines: { openwop: '>=1.0.0' }, integrity: 'sha256-abc=' };
  const template = {
    templateId: 'core.openwop.form.rsvp',
    version: '1.0.0',
    label: 'RSVP',
    title: 'Will you be joining us?',
    fields: [{ id: 'guestName', type: 'text', label: 'Your name' }],
  };

  it('`form-content` is in the kind enum and `templates` is a declared property', () => {
    const props = (versionManifestSchema.properties ?? {}) as Record<string, { enum?: string[] }>;
    expect(props.kind?.enum, why('registry-version-manifest.schema.json', '`form-content` joins the kind enum (RFC 0137)')).toEqual(
      expect.arrayContaining(['node', 'artifact-type', 'connection', 'card', 'form-content']),
    );
    expect(!!props.templates, why('registry-version-manifest.schema.json', '`templates` payload property declared (additionalProperties:false)')).toBe(true);
  });

  it('the `anyOf` payload gate carries a `templates` branch (NECESSARY — enum + property alone are not sufficient)', () => {
    const anyOf = (versionManifestSchema.anyOf ?? []) as Array<{ required?: string[] }>;
    expect(
      anyOf.some((branch) => (branch.required ?? []).includes('templates')),
      why('registry-version-manifest.schema.json §anyOf', 'without a `templates` branch every form-content manifest is rejected (RFC 0137 §Proposal 1)'),
    ).toBe(true);
  });

  it('a published form-content version manifest validates (kind + templates, no runtime)', () => {
    const ok = validate({ ...base, kind: 'form-content', templates: [template] });
    expect(ok, why('registry-operations.md §Validation flow', 'form-content manifest publishes (RFC 0137)')).toBe(true);
  });

  it('a form-content manifest carrying `runtime` is REJECTED (declarative kinds carry no runtime)', () => {
    const ok = validate({ ...base, kind: 'form-content', templates: [template], runtime: { language: 'javascript' } });
    expect(ok, why('registry-version-manifest.schema.json §allOf', 'a declarative kind MUST NOT carry runtime')).toBe(false);
  });

  it('an unchanged node version manifest still validates (RFC 0137 is additive)', () => {
    const ok = validate({
      ...base,
      runtime: { language: 'javascript' },
      nodes: [{ typeId: 'core.openwop.x.n', version: '1.0.0', category: 'data', role: 'pure' }],
    });
    expect(ok, why('COMPATIBILITY.md §2.1', 'RFC 0137 is additive — node manifests validate unchanged')).toBe(true);
  });
});

describe('form-content-packs: source manifest contract (RFC 0137, server-free)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const sourceSchema = readSchema('form-content-pack-manifest.schema.json');
  const validate = ajv.compile(sourceSchema);

  const pack = (templates: unknown[]): Record<string, unknown> => ({
    name: 'core.openwop.forms.starters',
    version: '1.0.0',
    kind: 'form-content',
    engines: { openwop: '>=1.1.0 <2.0.0' },
    templates,
  });
  const field = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'guestName',
    type: 'text',
    label: 'Your name',
    ...over,
  });
  const template = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    templateId: 'core.openwop.form.rsvp',
    version: '1.0.0',
    label: 'RSVP',
    title: 'Will you be joining us?',
    fields: [field()],
    ...over,
  });

  it('schema discipline: draft 2020-12, canonical $id, closed objects', () => {
    expect(sourceSchema.$schema, why('CONTRIBUTING.md §JSON Schemas', 'draft 2020-12')).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(sourceSchema.$id, why('CONTRIBUTING.md §JSON Schemas', 'canonical $id URL')).toBe(
      'https://openwop.dev/spec/v1/form-content-pack-manifest.schema.json',
    );
    expect(sourceSchema.additionalProperties, why('CONTRIBUTING.md §JSON Schemas', 'additionalProperties:false')).toBe(false);
  });

  it('a well-formed form-content pack validates', () => {
    expect(validate(pack([template()])), why('form-content-packs.md §Manifest format', 'the canonical example validates')).toBe(true);
  });

  it('the full portable field-type subset is accepted', () => {
    for (const type of ['text', 'longtext', 'number', 'boolean', 'select', 'multiselect', 'file', 'artifact-ref']) {
      expect(
        validate(pack([template({ fields: [field({ type })] })])),
        why('chat-card-packs.md §Input fields', `portable type \`${type}\` is accepted (RFC 0071 G9 subset)`),
      ).toBe(true);
    }
  });

  it('vendor.* and x- host extensions are accepted (other hosts degrade to plain text)', () => {
    for (const type of ['vendor.myndhyve.color', 'x-signature-pad']) {
      expect(
        validate(pack([template({ fields: [field({ type })] })])),
        why('form-content-packs.md §Field types', `host extension \`${type}\` is accepted`),
      ).toBe(true);
    }
  });

  it('`email` and `textarea` are REJECTED as field types (they are a format and a widget)', () => {
    expect(
      validate(pack([template({ fields: [field({ type: 'email' })] })])),
      why('form-content-packs.md §Validation formats are not types', '`email` is a format constraint, not a data kind — use text + format'),
    ).toBe(false);
    expect(
      validate(pack([template({ fields: [field({ type: 'textarea' })] })])),
      why('chat-card-packs.md §Input fields', '`textarea` is a widget name — the portable data kind is `longtext`'),
    ).toBe(false);
  });

  it('`format: "email"` on a text field IS accepted (the supported spelling)', () => {
    expect(
      validate(pack([template({ fields: [field({ id: 'email', type: 'text', format: 'email' })] })])),
      why('form-content-packs.md §Validation formats are not types', 'email validation rides `format`, not `type`'),
    ).toBe(true);
  });

  it('a field using `key` instead of `id` is REJECTED (aligns with chat-card InputField.id)', () => {
    const bad = { key: 'guestName', type: 'text', label: 'Your name' };
    expect(
      validate(pack([template({ fields: [bad] })])),
      why('form-content-packs.md §Manifest format', 'the field identifier is `id`, not `key`'),
    ).toBe(false);
  });

  it('an integer `templates[].version` is REJECTED (SemVer axis, not the integer schemaVersion axis)', () => {
    expect(
      validate(pack([template({ version: 3 })])),
      why('form-content-packs.md §Manifest format', '`templates[].version` is SemVer 2.0.0'),
    ).toBe(false);
  });

  it('an empty `fields[]` and an empty `templates[]` are REJECTED', () => {
    expect(validate(pack([template({ fields: [] })])), why('form-content-pack-manifest.schema.json', 'a template MUST declare ≥1 field')).toBe(false);
    expect(validate(pack([])), why('form-content-pack-manifest.schema.json', 'a pack MUST declare ≥1 template')).toBe(false);
  });

  it('a `runtime` block is REJECTED at the source manifest too (the kind is inert)', () => {
    expect(
      validate({ ...pack([template()]), runtime: { language: 'javascript' } }),
      why('form-content-packs.md §Pack kind', 'a form-content pack carries no runtime'),
    ).toBe(false);
  });
});

describe('form-content-packs: the field vocabulary is SHARED with chat-card packs, not forked (RFC 0137 R2)', () => {
  const formSchema = readSchema('form-content-pack-manifest.schema.json') as {
    $defs: { FormField: { properties: { type: { pattern: string } } } };
  };
  const cardSchema = readSchema('chat-card-pack-manifest.schema.json') as {
    $defs: { InputField: { properties: { type: { pattern: string } } } };
  };

  it('`fields[].type` and `inputs[].type` share one byte-identical pattern', () => {
    const formPattern = formSchema.$defs.FormField.properties.type.pattern;
    const cardPattern = cardSchema.$defs.InputField.properties.type.pattern;
    expect(
      formPattern,
      why(
        'form-content-packs.md §Field types',
        'RFC 0137 reuses the RFC 0071 portable subset VERBATIM — two input-collecting declarative kinds MUST agree on what a field type means. If this fails, one kind\'s vocabulary was widened without the other and the wire contract has forked.',
      ),
    ).toBe(cardPattern);
  });

  it('the shared pattern still admits every portable data kind and both extension prefixes', () => {
    const pattern = new RegExp(formSchema.$defs.FormField.properties.type.pattern);
    for (const type of ['text', 'longtext', 'number', 'boolean', 'select', 'multiselect', 'file', 'artifact-ref']) {
      expect(pattern.test(type), why('chat-card-packs.md §Input fields', `\`${type}\` is in the portable subset`)).toBe(true);
    }
    expect(pattern.test('vendor.acme.rating'), why('chat-card-packs.md §Input fields', 'vendor.<org>.<kind> extensions are admitted')).toBe(true);
    expect(pattern.test('x-rating'), why('chat-card-packs.md §Input fields', 'x-<kind> extensions are admitted')).toBe(true);
    expect(pattern.test('textarea'), why('chat-card-packs.md §Input fields', 'widget names are NOT in the subset')).toBe(false);
  });
});
