/**
 * prompt-template-shape — RFC 0027 §A + §B + §C wire-shape conformance.
 *
 * Asserts:
 *   1. `schemas/prompt-kind.schema.json` is Ajv2020-compileable as a
 *      `type: string` enum with the four canonical values.
 *   2. `schemas/prompt-template.schema.json` compiles AND its `kind`
 *      cross-ref to `prompt-kind.schema.json` resolves via Ajv's
 *      schema registry.
 *   3. `schemas/prompt-ref.schema.json` compiles AND accepts both
 *      stringy and object forms; rejects malformed strings.
 *   4. A positive PromptTemplate fixture round-trips; negative
 *      fixtures (missing required fields, bad templateId pattern,
 *      bad SemVer) reject.
 *   5. `capabilities.prompts` block advertisement (when present)
 *      conforms to the optional shape per RFC 0027 §D.
 *
 * NOT capability-gated — schema-shape compilation always runs.
 * Discovery-doc advertisement check soft-skips when no live host is
 * configured.
 *
 * @see RFCS/0027-prompt-templates.md
 * @see spec/v1/prompts.md
 * @see schemas/prompt-template.schema.json
 * @see schemas/prompt-ref.schema.json
 * @see schemas/prompt-kind.schema.json
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

const PROMPT_KIND_VALUES = ['system', 'user', 'few-shot', 'schema-hint'] as const;

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
      templateKinds?: unknown;
      variableSources?: unknown;
      maxTemplateBytes?: unknown;
      observability?: unknown;
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function loadSchema(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, rel), 'utf8')) as Record<string, unknown>;
}

// Pre-load the three RFC 0027 schemas into a shared Ajv instance so
// cross-schema `$ref`s (prompt-template → prompt-kind) resolve when
// validating. Mirrors the `agent-ref` / `agent-manifest` pre-load
// pattern in fixtures-valid.test.ts.
function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // Parse prompt-kind once so the second alias key shares the same
  // object reference — Ajv's `_checkUnique` allows duplicate registration
  // of the same schema instance but throws when two distinct objects
  // declare the same `$id` (see fixtures-valid.test.ts §"prompt-kind via
  // ./ relative URI" for the canonical pattern).
  const promptKindSchema = loadSchema('prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, 'prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, './prompt-kind.schema.json');
  // Do NOT pre-register prompt-template / prompt-ref here. Each
  // describe block calls `ajv.compile(loadSchema(...))` with a freshly
  // parsed object; pre-registering causes `_checkUnique` to throw on
  // the duplicate `$id`. prompt-kind stays pre-registered because
  // prompt-template `$ref`s it relatively and needs it resolvable.
  return ajv;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe('prompt-template-shape: schema compile (RFC 0027 §A)', () => {
  const ajv = makeAjv();

  it('prompt-kind.schema.json compiles and is a string enum of the four canonical kinds', () => {
    const schema = loadSchema('prompt-kind.schema.json');
    // Reuse the already-registered validator when present — Ajv refuses
    // to re-`compile` a schema whose `$id` it already knows.
    const validate = ajv.getSchema(schema['$id'] as string) ?? ajv.compile(schema);
    expect(validate, 'RFC 0027 §A: prompt-kind.schema.json MUST compile').toBeTypeOf('function');
    expect(schema.type, 'prompt-kind MUST be type: string').toBe('string');
    expect(
      schema.enum,
      driver.describe(
        'RFC 0027 §A',
        'prompt-kind enum MUST contain exactly the four canonical values',
      ),
    ).toEqual(PROMPT_KIND_VALUES);
  });

  it('prompt-template.schema.json compiles with cross-ref to prompt-kind', () => {
    const schema = loadSchema('prompt-template.schema.json');
    const validate = ajv.compile(schema);
    expect(validate, 'RFC 0027 §A: prompt-template.schema.json MUST compile').toBeTypeOf('function');
  });

  it('prompt-ref.schema.json compiles', () => {
    const schema = loadSchema('prompt-ref.schema.json');
    const validate = ajv.compile(schema);
    expect(validate, 'RFC 0027 §B: prompt-ref.schema.json MUST compile').toBeTypeOf('function');
  });
});

describe('prompt-template-shape: PromptTemplate round-trip (RFC 0027 §A)', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(loadSchema('prompt-template.schema.json'));

  it('accepts a minimal positive PromptTemplate fixture', () => {
    const positive = {
      templateId: 'writer-system',
      version: '1.0.0',
      kind: 'system',
      text: 'You are a careful editorial writer.',
    };
    const ok = validate(positive);
    expect(
      ok,
      `RFC 0027 §A: minimal PromptTemplate MUST validate; errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('accepts a PromptTemplate with typed variables + modelHints + meta', () => {
    const positive = {
      templateId: 'writer-user',
      version: '1.2.3',
      kind: 'user',
      text: 'Write about: {{topic}}\nTone: {{tone}}',
      name: 'Writer (user template)',
      description: 'Two-variable user template.',
      variables: [
        { name: 'topic', type: 'string', required: true, source: 'input' },
        { name: 'tone', type: 'string', required: false, source: 'input', defaultValue: 'neutral' },
      ],
      modelHints: { modelClass: 'writing', temperature: 0.7 },
      tags: ['editorial', 'writing'],
      meta: {
        author: 'openwop-conformance',
        createdAt: '2026-05-20T10:00:00Z',
        source: 'host',
      },
    };
    const ok = validate(positive);
    expect(
      ok,
      `RFC 0027 §A: full PromptTemplate MUST validate; errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('rejects a PromptTemplate missing required `text`', () => {
    const negative = {
      templateId: 'writer-system',
      version: '1.0.0',
      kind: 'system',
      // text omitted
    };
    expect(
      validate(negative),
      driver.describe(
        'RFC 0027 §A',
        'PromptTemplate MUST require text field',
      ),
    ).toBe(false);
  });

  it('rejects a PromptTemplate with non-SemVer version', () => {
    const negative = {
      templateId: 'writer-system',
      version: 'v1',
      kind: 'system',
      text: 'x',
    };
    expect(
      validate(negative),
      driver.describe(
        'RFC 0027 §A',
        'PromptTemplate.version MUST match SemVer 2.0.0 pattern',
      ),
    ).toBe(false);
  });

  it('rejects a PromptTemplate with invalid templateId (uppercase letter)', () => {
    const negative = {
      templateId: 'Writer-System',
      version: '1.0.0',
      kind: 'system',
      text: 'x',
    };
    expect(
      validate(negative),
      driver.describe(
        'RFC 0027 §A',
        'PromptTemplate.templateId MUST match ^[a-z0-9][a-z0-9._-]{0,127}$',
      ),
    ).toBe(false);
  });

  it('rejects a PromptTemplate with kind not in the prompt-kind enum', () => {
    const negative = {
      templateId: 'writer-system',
      version: '1.0.0',
      kind: 'made-up-kind',
      text: 'x',
    };
    expect(
      validate(negative),
      driver.describe(
        'RFC 0027 §A',
        'PromptTemplate.kind MUST be one of the four canonical values',
      ),
    ).toBe(false);
  });

  it('rejects an unknown top-level property (additionalProperties:false)', () => {
    const negative = {
      templateId: 'writer-system',
      version: '1.0.0',
      kind: 'system',
      text: 'x',
      unknownExtra: 'should reject',
    };
    expect(
      validate(negative),
      driver.describe(
        'RFC 0027 §A',
        'PromptTemplate top-level additionalProperties:false MUST reject unknown fields',
      ),
    ).toBe(false);
  });

  it('rejects a PromptVariable with bad name pattern (dash)', () => {
    const negative = {
      templateId: 'writer-system',
      version: '1.0.0',
      kind: 'user',
      text: 'x',
      variables: [{ name: 'has-dash', type: 'string', required: true }],
    };
    expect(
      validate(negative),
      driver.describe(
        'RFC 0027 §A',
        'PromptVariable.name MUST match common-templating identifier pattern (no dashes)',
      ),
    ).toBe(false);
  });
});

describe('prompt-template-shape: PromptRef round-trip (RFC 0027 §B)', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(loadSchema('prompt-ref.schema.json'));

  it('accepts stringy form without version', () => {
    expect(validate('prompt:writer-system')).toBe(true);
  });

  it('accepts stringy form with version', () => {
    expect(validate('prompt:writer-system@1.2.3')).toBe(true);
  });

  it('accepts stringy form with vendor-prefixed templateId', () => {
    expect(validate('prompt:vendor.acme.writer.v2@2.0.0')).toBe(true);
  });

  it('accepts object form with templateId only', () => {
    expect(validate({ templateId: 'writer-system' })).toBe(true);
  });

  it('accepts object form with libraryId, version, and variableOverrides', () => {
    expect(
      validate({
        libraryId: 'vendor.acme.editorial-prompts',
        templateId: 'writer-system',
        version: '1.0.0',
        variableOverrides: { tone: 'formal' },
      }),
    ).toBe(true);
  });

  it('rejects stringy form without `prompt:` prefix', () => {
    expect(
      validate('writer-system'),
      driver.describe('RFC 0027 §B', 'stringy PromptRef MUST start with prompt:'),
    ).toBe(false);
  });

  it('rejects stringy form with non-SemVer version', () => {
    expect(
      validate('prompt:writer-system@latest'),
      driver.describe('RFC 0027 §B', 'stringy PromptRef version MUST be SemVer'),
    ).toBe(false);
  });

  it('rejects object form missing required templateId', () => {
    expect(
      validate({ version: '1.0.0' }),
      driver.describe('RFC 0027 §B', 'object PromptRef MUST require templateId'),
    ).toBe(false);
  });

  it('rejects object form with unknown additional property', () => {
    expect(
      validate({ templateId: 'writer-system', unknownExtra: true }),
      driver.describe(
        'RFC 0027 §B',
        'object PromptRef additionalProperties:false MUST reject unknown fields',
      ),
    ).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('prompt-template-shape: capabilities.prompts advertisement (RFC 0027 §D)', () => {
  it('capabilities.prompts (when present) carries the optional shape per RFC 0027 §D', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const prompts = d.capabilities?.prompts;
    if (prompts === undefined) return; // optional block; host MAY omit
    expect(
      typeof prompts.supported,
      driver.describe(
        'RFC 0027 §D',
        'capabilities.prompts.supported MUST be boolean when block is advertised',
      ),
    ).toBe('boolean');
    if (prompts.templateKinds !== undefined) {
      expect(Array.isArray(prompts.templateKinds), 'templateKinds MUST be an array').toBe(true);
      for (const k of prompts.templateKinds as unknown[]) {
        expect((PROMPT_KIND_VALUES as readonly string[]).includes(String(k))).toBe(true);
      }
    }
    if (prompts.variableSources !== undefined) {
      expect(Array.isArray(prompts.variableSources), 'variableSources MUST be an array').toBe(true);
      for (const s of prompts.variableSources as unknown[]) {
        expect(['input', 'variable', 'secret', 'context']).toContain(String(s));
      }
    }
    if (prompts.observability !== undefined) {
      expect(['off', 'hashed', 'full']).toContain(String(prompts.observability));
    }
    if (prompts.maxTemplateBytes !== undefined) {
      expect(typeof prompts.maxTemplateBytes, 'maxTemplateBytes MUST be integer').toBe('number');
      expect((prompts.maxTemplateBytes as number) > 0).toBe(true);
      expect((prompts.maxTemplateBytes as number) <= 65536).toBe(true);
    }
  });
});
