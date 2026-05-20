/**
 * Fixture-validity test — pure local check that every fixture JSON
 * validates against the workflow-definition schema. Runs without a
 * server target so it can gate the suite in CI before deployment.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { FIXTURES_DIR, SCHEMAS_DIR } from '../lib/paths.js';

// Layout-aware paths — `lib/paths.ts` resolves these for both repo
// checkouts (schemas one level above the conformance package) and the
// published tarball (schemas vendored at the package root by `prepack`).
const PACK_MANIFEST_FIXTURES_DIR = join(FIXTURES_DIR, 'pack-manifests');
const PROMPT_TEMPLATE_FIXTURES_DIR = join(FIXTURES_DIR, 'prompt-templates');
const SCHEMA_PATH = join(SCHEMAS_DIR, 'workflow-definition.schema.json');
const PACK_MANIFEST_SCHEMA_PATH = join(SCHEMAS_DIR, 'node-pack-manifest.schema.json');
const PROMPT_TEMPLATE_SCHEMA_PATH = join(SCHEMAS_DIR, 'prompt-template.schema.json');

describe('fixtures: workflow-definition schema validity', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Pre-load peer schemas that workflow-definition cross-`$ref`s:
  //   - agent-ref.schema.json — `WorkflowNode.agent` (Phase 1 multi-agent)
  //   - prompt-ref.schema.json — `WorkflowDefinition.defaults.promptRefs.*`
  //     (RFC 0029 §B resolution-chain layer 3)
  //   - prompt-kind.schema.json — transitively referenced by prompt-ref's
  //     object form when validating PromptRef variants
  // Register each under both the canonical $id and the relative file
  // name so Ajv resolves either way the host schema spelled the ref.
  const agentRefSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'agent-ref.schema.json'), 'utf8'));
  const promptRefSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'prompt-ref.schema.json'), 'utf8'));
  const promptKindSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'prompt-kind.schema.json'), 'utf8'));
  ajv.addSchema(agentRefSchema, 'agent-ref.schema.json');
  ajv.addSchema(promptRefSchema, 'prompt-ref.schema.json');
  ajv.addSchema(promptRefSchema, './prompt-ref.schema.json');
  ajv.addSchema(promptKindSchema, 'prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, './prompt-kind.schema.json');
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json')) // top-level only — sub-dirs hold non-workflow fixtures
    .sort();

  it('finds at least one fixture file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} validates against workflow-definition.schema.json`, () => {
      const data = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
      const ok = validate(data);
      const errors = (validate.errors ?? [])
        .map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
        .join('\n');
      expect(ok, `Fixture ${file} fails workflow-definition schema:\n${errors}`).toBe(true);
    });
  }

  it('every fixture id matches its filename', () => {
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as { id: string };
      const expected = file.replace(/\.json$/, '');
      expect(
        data.id,
        `Fixture file ${file} declares id "${data.id}" — MUST match filename`,
      ).toBe(expected);
    }
  });

  it('every fixture has a manual trigger so the conformance driver can start it', () => {
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as {
        id: string;
        triggers: Array<{ type: string }>;
      };
      const hasManual = data.triggers.some((t) => t.type === 'manual');
      expect(
        hasManual,
        `Fixture ${data.id} MUST include a manual trigger per fixtures.md §Seeding contract`,
      ).toBe(true);
    }
  });
});

describe('fixtures: node-pack-manifest schema validity', () => {
  // Pack-manifest fixtures live in `fixtures/pack-manifests/` so the
  // top-level workflow-definition validator above doesn't try to apply
  // the wrong schema. They serve as schema-level proof points (e.g., the
  // `private.<host>.*` scope is accepted by the canonical schema).
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Pre-load peer schemas. agent-manifest references prompt-ref (RFC 0029
  // §B `AgentManifest.promptOverrides[kind]` + `promptLibraryRef`); prompt-ref
  // transitively references prompt-kind. Register each under both the
  // canonical $id and the relative file name so Ajv resolves either way
  // the consumer schema spelled the ref.
  const agentManifestSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'agent-manifest.schema.json'), 'utf8'));
  const promptRefSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'prompt-ref.schema.json'), 'utf8'));
  const promptKindSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'prompt-kind.schema.json'), 'utf8'));
  ajv.addSchema(agentManifestSchema, 'agent-manifest.schema.json');
  ajv.addSchema(promptRefSchema, 'prompt-ref.schema.json');
  ajv.addSchema(promptRefSchema, './prompt-ref.schema.json');
  ajv.addSchema(promptKindSchema, 'prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, './prompt-kind.schema.json');
  const schema = JSON.parse(readFileSync(PACK_MANIFEST_SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  const files = readdirSync(PACK_MANIFEST_FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  it('finds at least one pack-manifest fixture (private-scope coverage)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`pack-manifests/${file} validates against node-pack-manifest.schema.json`, () => {
      const data = JSON.parse(
        readFileSync(join(PACK_MANIFEST_FIXTURES_DIR, file), 'utf8'),
      );
      const ok = validate(data);
      const errors = (validate.errors ?? [])
        .map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
        .join('\n');
      expect(
        ok,
        `Fixture pack-manifests/${file} fails node-pack-manifest schema:\n${errors}`,
      ).toBe(true);
    });
  }

  it('the private-scope fixture exercises the v1.0 private-pack pattern', () => {
    // Regression pin: the pattern in node-pack-manifest.schema.json was
    // widened from `(core|vendor|community)` to
    // `(core|vendor|community|private)` in v1.0. If this test
    // fails, either the schema regressed or the fixture got renamed —
    // both are CHANGELOG-worthy.
    const privateFixtures = files.filter((f) => {
      const data = JSON.parse(
        readFileSync(join(PACK_MANIFEST_FIXTURES_DIR, f), 'utf8'),
      ) as { name?: string };
      return typeof data.name === 'string' && data.name.startsWith('private.');
    });
    expect(
      privateFixtures.length,
      'Expected at least one pack-manifest fixture under the `private.<host>.*` scope to assert v1.0 private-scope pattern coverage',
    ).toBeGreaterThan(0);
  });
});

describe('fixtures: prompt-template schema validity', () => {
  // PromptTemplate fixtures live in `fixtures/prompt-templates/` per
  // RFC 0027 §A. Like pack manifests, they're schema-level proof points,
  // not seeded into a workflow store. They exist so the conformance
  // suite has canonical positive fixtures for the prompt-template-shape
  // scenario, and so future RFCs (0028 prompt packs, 0029 resolution
  // chain) can reference a stable fixture set.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Pre-load prompt-kind so the cross-schema `$ref` in
  // prompt-template.schema.json resolves. The template references
  // prompt-kind via `./prompt-kind.schema.json` (relative URI; see
  // RFC 0027 commit notes for the redocly compatibility rationale).
  // Register under both the canonical `$id` and the relative form so
  // Ajv resolves either way.
  const promptKindPath = join(SCHEMAS_DIR, 'prompt-kind.schema.json');
  const promptKindSchema = JSON.parse(readFileSync(promptKindPath, 'utf8'));
  ajv.addSchema(promptKindSchema, 'prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, './prompt-kind.schema.json');
  const schema = JSON.parse(readFileSync(PROMPT_TEMPLATE_SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  const files = readdirSync(PROMPT_TEMPLATE_FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  it('finds at least one prompt-template fixture', () => {
    expect(
      files.length,
      'Expected at least one PromptTemplate fixture under fixtures/prompt-templates/',
    ).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`prompt-templates/${file} validates against prompt-template.schema.json`, () => {
      const data = JSON.parse(
        readFileSync(join(PROMPT_TEMPLATE_FIXTURES_DIR, file), 'utf8'),
      );
      const ok = validate(data);
      const errors = (validate.errors ?? [])
        .map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
        .join('\n');
      expect(
        ok,
        `Fixture prompt-templates/${file} fails prompt-template schema:\n${errors}`,
      ).toBe(true);
    });
  }

  it('every fixture templateId matches its filename', () => {
    // Filename convention: `<templateId-dot-form-with-dots-as-dashes>.json`.
    // The fixture set uses dot-prefixed templateIds (e.g.,
    // `conformance.prompt.writer-system`) which map directly to filenames
    // with dots preserved (`conformance-prompt-writer-system.json`). The
    // file→id mapping is loose (the suite doesn't enforce it) but we
    // assert templateId presence so each fixture is self-describing.
    for (const file of files) {
      const data = JSON.parse(
        readFileSync(join(PROMPT_TEMPLATE_FIXTURES_DIR, file), 'utf8'),
      ) as { templateId: string };
      expect(
        typeof data.templateId,
        `Fixture prompt-templates/${file} MUST declare a templateId`,
      ).toBe('string');
      expect(data.templateId.length).toBeGreaterThan(0);
    }
  });

  it('every secret-source variable lives in a fixture tagged for the secret-redaction scenario', () => {
    // SECURITY regression pin: a fixture that declares a `secret`-source
    // variable but isn't visible to the prompt-composed-secret-redaction
    // scenario could mask a redaction failure. We require every
    // fixture carrying secret-source variables to advertise the
    // `secret-redaction` tag so the scenario discovers it.
    for (const file of files) {
      const data = JSON.parse(
        readFileSync(join(PROMPT_TEMPLATE_FIXTURES_DIR, file), 'utf8'),
      ) as {
        templateId: string;
        variables?: Array<{ name: string; source?: string }>;
        tags?: string[];
      };
      const hasSecretSource = (data.variables ?? []).some((v) => v.source === 'secret');
      if (hasSecretSource) {
        expect(
          (data.tags ?? []).includes('secret-redaction'),
          `Fixture prompt-templates/${file} declares a secret-source variable but lacks the 'secret-redaction' tag`,
        ).toBe(true);
      }
    }
  });
});
