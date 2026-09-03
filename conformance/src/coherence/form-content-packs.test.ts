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
import { req } from '../lib/requirement-ids.js';

const readSchema = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8'));

describe('form-content-packs: contract present in the corpus (RFC 0137, server-free)', () => {
  const registryDoc = V1_DIR ? readFileSync(join(V1_DIR, 'registry-operations.md'), 'utf8') : '';
  const formDoc = V1_DIR ? readFileSync(join(V1_DIR, 'form-content-packs.md'), 'utf8') : '';

  it.skipIf(V1_DIR === null)('registry-operations.md §Validation flow selects the form-content source schema by `kind`', () => {
    expect(
      /form-content[\s\S]{0,160}form-content-pack-manifest\.schema\.json/.test(registryDoc),
      req('openwop.it.form-content-packs.registry-operations-md-validation-flow-selects-the-form-content-source-schema-by', 'registry-operations.md §Validation flow #3', '`kind: "form-content"` validates against its own source schema (RFC 0137)'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('registry-operations.md skips the runtime-support check for form-content', () => {
    expect(
      /declarative[\s\S]{0,200}form-content/.test(registryDoc),
      req('openwop.it.form-content-packs.registry-operations-md-skips-the-runtime-support-check-for-form-content', 'registry-operations.md §Validation flow #7', 'form-content is a declarative kind — the runtime check is skipped'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('registry-operations.md extends the declarative-id denormalization to templateId', () => {
    expect(
      /templates\[\]\.templateId/.test(registryDoc),
      req('openwop.it.form-content-packs.registry-operations-md-extends-the-declarative-id-denormalization-to-templateid', 'registry-operations.md §Type-ID indexing', 'a registry SHOULD denormalize `templates[].templateId` (RFC 0137)'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('form-content-packs.md requires the host to use its NORMAL create path and execute nothing', () => {
    expect(
      /MUST[\s\S]{0,120}normal[\s\S]{0,40}create path/i.test(formDoc),
      req('openwop.it.form-content-packs.form-content-packs-md-requires-the-host-to-use-its-normal-create-path-and-execut', 'form-content-packs.md §Instantiation', 'the host MUST instantiate through its normal create path'),
    ).toBe(true);
    expect(
      /MUST NOT execute anything from the pack/i.test(formDoc),
      req('openwop.it.form-content-packs.form-content-packs-md-requires-the-host-to-use-its-normal-create-path-and-execut', 'form-content-packs.md §Instantiation', 'the host MUST NOT execute anything from the pack — the kind is inert'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('form-content-packs.md carries the F1 trust boundary, incl. "a signature is not content trust"', () => {
    expect(
      /untrusted/i.test(formDoc) && /contentTrust/.test(formDoc),
      req('openwop.it.form-content-packs.form-content-packs-md-carries-the-f1-trust-boundary-incl-a-signature-is-not-cont', 'form-content-packs.md §Trust boundary', 'pack-authored strings are untrusted; prompts propagate meta.contentTrust'),
    ).toBe(true);
    expect(
      /signature proves[\s\S]{0,80}not[\s\S]{0,60}trustworthy|MUST NOT treat pack provenance as content trust/i.test(formDoc),
      req('openwop.it.form-content-packs.form-content-packs-md-carries-the-f1-trust-boundary-incl-a-signature-is-not-cont', 'form-content-packs.md §Trust boundary', 'a signature proves authorship, NOT that the authored bytes are safe'),
    ).toBe(true);
    expect(
      /Length bounds are not a trust boundary/i.test(formDoc),
      req('openwop.it.form-content-packs.form-content-packs-md-carries-the-f1-trust-boundary-incl-a-signature-is-not-cont', 'form-content-packs.md §Trust boundary', 'maxLength is a resource guard, NOT sanitization'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('the spec distinguishes DEGRADE (well-formed extension) from REFUSE (malformed value)', () => {
    expect(
      /Degrade applies to \*extensions\*, not to malformed values/i.test(formDoc),
      req('openwop.it.form-content-packs.the-spec-distinguishes-degrade-well-formed-extension-from-refuse-malformed-value', 'form-content-packs.md §Instantiation', 'MUST-degrade is scoped to vendor.*/x- extensions, not bare unknowns'),
    ).toBe(true);
    expect(
      /MUST NOT collapse these into one rule in either direction/i.test(formDoc),
      req('openwop.it.form-content-packs.the-spec-distinguishes-degrade-well-formed-extension-from-refuse-malformed-value', 
        'form-content-packs.md §Instantiation',
        'refusing a well-formed extension breaks forward compat; degrading a malformed value hides an authoring error',
      ),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('form-content-packs.md forbids minting a second field-type vocabulary', () => {
    expect(
      /MUST NOT\W{0,4}\s*define its own field-type vocabulary/i.test(formDoc),
      req('openwop.it.form-content-packs.form-content-packs-md-forbids-minting-a-second-field-type-vocabulary', 'form-content-packs.md §Field types', 'the kind reuses the RFC 0071 portable subset rather than defining its own'),
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
    expect(props.kind?.enum, req('openwop.it.form-content-packs.form-content-is-in-the-kind-enum-and-templates-is-a-declared-property', 'registry-version-manifest.schema.json', '`form-content` joins the kind enum (RFC 0137)')).toEqual(
      expect.arrayContaining(['node', 'artifact-type', 'connection', 'card', 'form-content']),
    );
    expect(!!props.templates, req('openwop.it.form-content-packs.form-content-is-in-the-kind-enum-and-templates-is-a-declared-property', 'registry-version-manifest.schema.json', '`templates` payload property declared (additionalProperties:false)')).toBe(true);
  });

  it('the `anyOf` payload gate carries a `templates` branch (NECESSARY — enum + property alone are not sufficient)', () => {
    const anyOf = (versionManifestSchema.anyOf ?? []) as Array<{ required?: string[] }>;
    expect(
      anyOf.some((branch) => (branch.required ?? []).includes('templates')),
      req('openwop.it.form-content-packs.the-anyof-payload-gate-carries-a-templates-branch-necessary-enum-property-alone', 'registry-version-manifest.schema.json §anyOf', 'without a `templates` branch every form-content manifest is rejected (RFC 0137 §Proposal 1)'),
    ).toBe(true);
  });

  it('a published form-content version manifest validates (kind + templates, no runtime)', () => {
    const ok = validate({ ...base, kind: 'form-content', templates: [template] });
    expect(ok, req('openwop.it.form-content-packs.a-published-form-content-version-manifest-validates-kind-templates-no-runtime', 'registry-operations.md §Validation flow', 'form-content manifest publishes (RFC 0137)')).toBe(true);
  });

  it('a form-content manifest carrying `runtime` is REJECTED (declarative kinds carry no runtime)', () => {
    const ok = validate({ ...base, kind: 'form-content', templates: [template], runtime: { language: 'javascript' } });
    expect(ok, req('openwop.it.form-content-packs.a-form-content-manifest-carrying-runtime-is-rejected-declarative-kinds-carry-no', 'registry-version-manifest.schema.json §allOf', 'a declarative kind MUST NOT carry runtime')).toBe(false);
  });

  it('an unchanged node version manifest still validates (RFC 0137 is additive)', () => {
    const ok = validate({
      ...base,
      runtime: { language: 'javascript' },
      nodes: [{ typeId: 'core.openwop.x.n', version: '1.0.0', category: 'data', role: 'pure' }],
    });
    expect(ok, req('openwop.it.form-content-packs.an-unchanged-node-version-manifest-still-validates-rfc-0137-is-additive', 'COMPATIBILITY.md §2.1', 'RFC 0137 is additive — node manifests validate unchanged')).toBe(true);
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
    expect(sourceSchema.$schema, req('openwop.it.form-content-packs.schema-discipline-draft-2020-12-canonical-id-closed-objects', 'CONTRIBUTING.md §JSON Schemas', 'draft 2020-12')).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(sourceSchema.$id, req('openwop.it.form-content-packs.schema-discipline-draft-2020-12-canonical-id-closed-objects', 'CONTRIBUTING.md §JSON Schemas', 'canonical $id URL')).toBe(
      'https://openwop.dev/spec/v1/form-content-pack-manifest.schema.json',
    );
    expect(sourceSchema.additionalProperties, req('openwop.it.form-content-packs.schema-discipline-draft-2020-12-canonical-id-closed-objects', 'CONTRIBUTING.md §JSON Schemas', 'additionalProperties:false')).toBe(false);
  });

  it('a well-formed form-content pack validates', () => {
    expect(validate(pack([template()])), req('openwop.it.form-content-packs.a-well-formed-form-content-pack-validates', 'form-content-packs.md §Manifest format', 'the canonical example validates')).toBe(true);
  });

  it('the full portable field-type subset is accepted', () => {
    for (const type of ['text', 'longtext', 'number', 'boolean', 'select', 'multiselect', 'file', 'artifact-ref']) {
      expect(
        validate(pack([template({ fields: [field({ type })] })])),
        req('openwop.it.form-content-packs.the-full-portable-field-type-subset-is-accepted', 'chat-card-packs.md §Input fields', `portable type \`${type}\` is accepted (RFC 0071 G9 subset)`),
      ).toBe(true);
    }
  });

  it('vendor.* and x- host extensions are accepted (other hosts degrade to plain text)', () => {
    for (const type of ['vendor.myndhyve.color', 'x-signature-pad']) {
      expect(
        validate(pack([template({ fields: [field({ type })] })])),
        req('openwop.it.form-content-packs.vendor-and-x-host-extensions-are-accepted-other-hosts-degrade-to-plain-text', 'form-content-packs.md §Field types', `host extension \`${type}\` is accepted`),
      ).toBe(true);
    }
  });

  it('`email` and `textarea` are REJECTED as field types (they are a format and a widget)', () => {
    expect(
      validate(pack([template({ fields: [field({ type: 'email' })] })])),
      req('openwop.it.form-content-packs.email-and-textarea-are-rejected-as-field-types-they-are-a-format-and-a-widget', 'form-content-packs.md §Validation formats are not types', '`email` is a format constraint, not a data kind — use text + format'),
    ).toBe(false);
    expect(
      validate(pack([template({ fields: [field({ type: 'textarea' })] })])),
      req('openwop.it.form-content-packs.email-and-textarea-are-rejected-as-field-types-they-are-a-format-and-a-widget', 'chat-card-packs.md §Input fields', '`textarea` is a widget name — the portable data kind is `longtext`'),
    ).toBe(false);
  });

  it('`format: "email"` on a text field IS accepted (the supported spelling)', () => {
    expect(
      validate(pack([template({ fields: [field({ id: 'email', type: 'text', format: 'email' })] })])),
      req('openwop.it.form-content-packs.format-email-on-a-text-field-is-accepted-the-supported-spelling', 'form-content-packs.md §Validation formats are not types', 'email validation rides `format`, not `type`'),
    ).toBe(true);
  });

  it('a field using `key` instead of `id` is REJECTED (aligns with chat-card InputField.id)', () => {
    const bad = { key: 'guestName', type: 'text', label: 'Your name' };
    expect(
      validate(pack([template({ fields: [bad] })])),
      req('openwop.it.form-content-packs.a-field-using-key-instead-of-id-is-rejected-aligns-with-chat-card-inputfield-id', 'form-content-packs.md §Manifest format', 'the field identifier is `id`, not `key`'),
    ).toBe(false);
  });

  it('an integer `templates[].version` is REJECTED (SemVer axis, not the integer schemaVersion axis)', () => {
    expect(
      validate(pack([template({ version: 3 })])),
      req('openwop.it.form-content-packs.an-integer-templates-version-is-rejected-semver-axis-not-the-integer-schemaversi', 'form-content-packs.md §Manifest format', '`templates[].version` is SemVer 2.0.0'),
    ).toBe(false);
  });

  it('an empty `fields[]` and an empty `templates[]` are REJECTED', () => {
    expect(validate(pack([template({ fields: [] })])), req('openwop.it.form-content-packs.an-empty-fields-and-an-empty-templates-are-rejected', 'form-content-pack-manifest.schema.json', 'a template MUST declare ≥1 field')).toBe(false);
    expect(validate(pack([])), req('openwop.it.form-content-packs.an-empty-fields-and-an-empty-templates-are-rejected', 'form-content-pack-manifest.schema.json', 'a pack MUST declare ≥1 template')).toBe(false);
  });

  it('a `runtime` block is REJECTED at the source manifest too (the kind is inert)', () => {
    expect(
      validate({ ...pack([template()]), runtime: { language: 'javascript' } }),
      req('openwop.it.form-content-packs.a-runtime-block-is-rejected-at-the-source-manifest-too-the-kind-is-inert', 'form-content-packs.md §Pack kind', 'a form-content pack carries no runtime'),
    ).toBe(false);
  });
});

describe('form-content-packs: a template carries NO submission routing (RFC 0137 §F2, invariant)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const sourceSchema = readSchema('form-content-pack-manifest.schema.json') as {
    $defs: { FormTemplate: { properties: Record<string, unknown>; additionalProperties?: boolean } };
  };
  const validate = ajv.compile(sourceSchema);
  const formDoc = V1_DIR ? readFileSync(join(V1_DIR, 'form-content-packs.md'), 'utf8') : '';

  const withTemplateKey = (key: string, value: unknown): Record<string, unknown> => ({
    name: 'core.openwop.forms.starters',
    version: '1.0.0',
    kind: 'form-content',
    engines: { openwop: '>=1.1.0 <2.0.0' },
    templates: [
      {
        templateId: 'core.openwop.form.rsvp',
        version: '1.0.0',
        label: 'RSVP',
        title: 'RSVP',
        fields: [{ id: 'a', type: 'text', label: 'A' }],
        [key]: value,
      },
    ],
  });

  it('FormTemplate declares NO routing-shaped property and is closed', () => {
    const props = Object.keys(sourceSchema.$defs.FormTemplate.properties);
    for (const banned of ['intakeBinding', 'destination', 'webhook', 'webhookUrl', 'listId', 'mailbox', 'crmObject', 'routing', 'submitTo']) {
      expect(props, req('openwop.it.form-content-packs.formtemplate-declares-no-routing-shaped-property-and-is-closed', 'form-content-packs.md §No submission routing', `FormTemplate MUST NOT declare a \`${banned}\` property`)).not.toContain(banned);
    }
    expect(
      sourceSchema.$defs.FormTemplate.additionalProperties,
      req('openwop.it.form-content-packs.formtemplate-declares-no-routing-shaped-property-and-is-closed', 'form-content-packs.md §No submission routing', 'FormTemplate is closed, so an undeclared routing key is rejected'),
    ).toBe(false);
  });

  it('a template attempting to carry routing config is REJECTED', () => {
    for (const [key, value] of [
      ['intakeBinding', { listId: 'abc' }],
      ['destination', 'https://attacker.example/collect'],
      ['webhookUrl', 'https://attacker.example/hook'],
    ] as Array<[string, unknown]>) {
      expect(
        validate(withTemplateKey(key, value)),
        req('openwop.it.form-content-packs.a-template-attempting-to-carry-routing-config-is-rejected', 'form-content-packs.md §No submission routing', `a pack MUST NOT bind a submission destination via \`${key}\``),
      ).toBe(false);
    }
  });

  it.skipIf(V1_DIR === null)('the spec scopes the routing ban to the PACK, leaving operator-configured routing free', () => {
    expect(
      /This constrains the pack, not the host/i.test(formDoc),
      req('openwop.it.form-content-packs.the-spec-scopes-the-routing-ban-to-the-pack-leaving-operator-configured-routing', 'form-content-packs.md §No submission routing', 'a host MAY route wherever its OPERATOR configures; only pack-declared routing is banned'),
    ).toBe(true);
  });

  it.skipIf(V1_DIR === null)('the spec binds FUTURE routing surfaces to operator consent, not pack declaration', () => {
    expect(
      /MUST NOT let a pack bind a destination unilaterally|routing MUST be a host-side decision/i.test(formDoc),
      req('openwop.it.form-content-packs.the-spec-binds-future-routing-surfaces-to-operator-consent-not-pack-declaration', 'form-content-packs.md §No submission routing', 'a later routing RFC MUST keep the decision host-side, behind operator consent'),
    ).toBe(true);
  });
});

describe('form-content-packs: identifier uniqueness + resource bounds (RFC 0137 amendment)', () => {
  const formDoc = V1_DIR ? readFileSync(join(V1_DIR, 'form-content-packs.md'), 'utf8') : '';
  const sourceSchema = readSchema('form-content-pack-manifest.schema.json') as {
    properties: { templates: { maxItems: number } };
    $defs: {
      FormTemplate: { properties: { fields: { maxItems: number } } };
      FormField: { properties: { label: { maxLength: number }; options: { maxItems: number } } };
    };
  };

  it.skipIf(V1_DIR === null)('duplicate `fields[].id` is a normative refusal, framed as data integrity', () => {
    expect(
      /each `fields\[\]\.id` MUST be unique within its template/i.test(formDoc),
      req('openwop.it.form-content-packs.duplicate-fields-id-is-a-normative-refusal-framed-as-data-integrity', 'form-content-packs.md §Unique identifiers', 'duplicate field ids MUST be refused'),
    ).toBe(true);
    expect(
      /silently overwrite/i.test(formDoc),
      req('openwop.it.form-content-packs.duplicate-fields-id-is-a-normative-refusal-framed-as-data-integrity', 'form-content-packs.md §Unique identifiers', 'the rationale is silent data loss, not style'),
    ).toBe(true);
  });

  it('resource bounds admit real-world content (long consent labels, a country list)', () => {
    expect(
      sourceSchema.$defs.FormField.properties.label.maxLength,
      req('openwop.it.form-content-packs.resource-bounds-admit-real-world-content-long-consent-labels-a-country-list', 'form-content-pack-manifest.schema.json', 'a lawful consent label is legitimately long-form'),
    ).toBeGreaterThanOrEqual(1000);
    expect(
      sourceSchema.$defs.FormField.properties.options.maxItems,
      req('openwop.it.form-content-packs.resource-bounds-admit-real-world-content-long-consent-labels-a-country-list', 'form-content-pack-manifest.schema.json', 'a country list is ~195 entries — the cap must clear it'),
    ).toBeGreaterThanOrEqual(250);
  });

  it('outer resource caps exist on both arrays (render-bomb guard, not product policy)', () => {
    expect(sourceSchema.properties.templates.maxItems, req('openwop.it.form-content-packs.outer-resource-caps-exist-on-both-arrays-render-bomb-guard-not-product-policy', 'form-content-pack-manifest.schema.json', 'templates[] carries an outer cap')).toBeGreaterThan(0);
    expect(sourceSchema.$defs.FormTemplate.properties.fields.maxItems, req('openwop.it.form-content-packs.outer-resource-caps-exist-on-both-arrays-render-bomb-guard-not-product-policy', 'form-content-pack-manifest.schema.json', 'fields[] carries an outer cap')).toBeGreaterThan(0);
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
      req('openwop.it.form-content-packs.fields-type-and-inputs-type-share-one-byte-identical-pattern', 
        'form-content-packs.md §Field types',
        'RFC 0137 reuses the RFC 0071 portable subset VERBATIM — two input-collecting declarative kinds MUST agree on what a field type means. If this fails, one kind\'s vocabulary was widened without the other and the wire contract has forked.',
      ),
    ).toBe(cardPattern);
  });

  it('the shared pattern still admits every portable data kind and both extension prefixes', () => {
    const pattern = new RegExp(formSchema.$defs.FormField.properties.type.pattern);
    for (const type of ['text', 'longtext', 'number', 'boolean', 'select', 'multiselect', 'file', 'artifact-ref']) {
      expect(pattern.test(type), req('openwop.it.form-content-packs.the-shared-pattern-still-admits-every-portable-data-kind-and-both-extension-pref', 'chat-card-packs.md §Input fields', `\`${type}\` is in the portable subset`)).toBe(true);
    }
    expect(pattern.test('vendor.acme.rating'), req('openwop.it.form-content-packs.the-shared-pattern-still-admits-every-portable-data-kind-and-both-extension-pref', 'chat-card-packs.md §Input fields', 'vendor.<org>.<kind> extensions are admitted')).toBe(true);
    expect(pattern.test('x-rating'), req('openwop.it.form-content-packs.the-shared-pattern-still-admits-every-portable-data-kind-and-both-extension-pref', 'chat-card-packs.md §Input fields', 'x-<kind> extensions are admitted')).toBe(true);
    expect(pattern.test('textarea'), req('openwop.it.form-content-packs.the-shared-pattern-still-admits-every-portable-data-kind-and-both-extension-pref', 'chat-card-packs.md §Input fields', 'widget names are NOT in the subset')).toBe(false);
  });
});
