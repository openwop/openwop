/**
 * `x-openwop-form` vendor-extension shape validation — `node-packs.md`
 * §"`x-openwop-form` UX hints" (RFC 0066).
 *
 * Server-free, no host-advertisement gate: `x-openwop-form` is a
 * CONSUMER-SIDE rendering hint that a pack author places on `configSchema`
 * properties. Hosts do not advertise it; the contract is purely the shape a
 * pack author targets. This scenario asserts the two shape-level guarantees
 * the RFC's §Conformance pins:
 *
 *   1. A pack `configSchema` carrying `x-openwop-form` annotations remains a
 *      VALID JSON Schema 2020-12 document — the annotation is an ignored
 *      vendor keyword, so a schema validator (Ajv2020) compiles it without
 *      error. This is the load-bearing additive promise: a consumer that
 *      doesn't understand the keyword still validates config against the
 *      schema unchanged.
 *   2. The annotation OBJECT itself matches the §A vocabulary shape: `kind`
 *      is REQUIRED and a string; the documented sub-fields (`dependsOn`,
 *      `promptKind`, `provider`, `credentialProvider`) are optional strings.
 *
 * Forward-compat (RFC §A + §B, both `MUST`): an UNKNOWN `kind` value is still
 * a structurally valid annotation — a renderer MUST treat it as if the hint
 * were absent rather than reject it. So the shape schema accepts any string
 * `kind`, NOT a closed enum; the four reserved kinds
 * (`prompt-picker`/`provider-picker`/`model-picker`/`credential-picker`) are
 * a renderer-routing vocabulary, not a validation constraint.
 *
 * NOTE: the renderer behavior matrix (which picker each `kind` produces, the
 * `dependsOn` sibling-resolution + graceful fallback) is a reference-FRONTEND
 * concern unit-tested in the workflow-engine sample, NOT a protocol wire
 * shape — it is intentionally out of scope for this server-free scenario.
 *
 * @see spec/v1/node-packs.md §"`x-openwop-form` UX hints"
 * @see RFCS/0066-x-openwop-form-vendor-extension.md
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { req } from '../lib/requirement-ids.js';

/** The §A `x-openwop-form` annotation shape. `kind` is the only required
 *  field; it is an OPEN string (unknown kinds are valid per the forward-compat
 *  MUST), with the documented sub-fields typed as optional strings. */
const X_OPENWOP_FORM_SHAPE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['kind'],
  properties: {
    kind: { type: 'string' },
    dependsOn: { type: 'string' },
    promptKind: { type: 'string' },
    provider: { type: 'string' },
    credentialProvider: { type: 'string' },
  },
  additionalProperties: false,
} as const;

/** A pack `configSchema` annotated for picker UX — the RFC §A positive
 *  example (`core.ai.chatCompletion`-style): provider/model/credential/prompt
 *  pickers with a `dependsOn` cascade. */
function annotatedConfigSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        'x-openwop-form': { kind: 'provider-picker' },
      },
      model: {
        type: 'string',
        'x-openwop-form': { kind: 'model-picker', dependsOn: 'provider' },
      },
      credential: {
        type: 'string',
        'x-openwop-form': { kind: 'credential-picker', dependsOn: 'provider' },
      },
      systemPrompt: {
        type: 'string',
        'x-openwop-form': { kind: 'prompt-picker', promptKind: 'system' },
      },
      temperature: { type: 'number', minimum: 0, maximum: 2 },
    },
    additionalProperties: false,
  };
}

describe('category: x-openwop-form pack-manifest shape (RFC 0066)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateShape = ajv.compile<Record<string, unknown>>(X_OPENWOP_FORM_SHAPE);

  const shapeFailsWith = (annotation: unknown, keyword: string): ErrorObject[] => {
    const ok = validateShape(annotation);
    expect(ok).toBe(false);
    return (validateShape.errors ?? []).filter((e) => e.keyword === keyword);
  };

  it('positive: a configSchema carrying x-openwop-form remains a valid JSON Schema 2020-12 document', () => {
    // The annotation is an ignored vendor keyword — compiling MUST NOT throw,
    // and the schema MUST still validate/reject instance config normally.
    let validateConfig: ReturnType<typeof ajv.compile> | undefined;
    expect(() => {
      validateConfig = ajv.compile(annotatedConfigSchema());
    }, req('openwop.it.x-openwop-form-pack-manifest.positive-a-configschema-carrying-x-openwop-form-remains-a-valid-json-schema-2020', 'node-packs.md', 'node-packs.md §x-openwop-form: an annotated configSchema MUST remain a valid 2020-12 schema')).not.toThrow();
    // The annotations do not alter schema semantics: valid config passes…
    expect(
      validateConfig!({ provider: 'anthropic', model: 'claude', temperature: 1 }),
      req('openwop.it.x-openwop-form-pack-manifest.positive-a-configschema-carrying-x-openwop-form-remains-a-valid-json-schema-2020', 'node-packs.md', 'x-openwop-form is advisory — it MUST NOT change what the schema accepts'),
    ).toBe(true);
    // …and a type violation on an annotated field still rejects.
    expect(validateConfig!({ provider: 123 })).toBe(false);
  });

  it('positive: each documented x-openwop-form annotation matches the §A shape', () => {
    const cfg = annotatedConfigSchema();
    for (const [name, prop] of Object.entries(cfg.properties)) {
      const ann = (prop as Record<string, unknown>)['x-openwop-form'];
      if (ann === undefined) continue;
      expect(
        validateShape(ann),
        req('openwop.it.x-openwop-form-pack-manifest.positive-each-documented-x-openwop-form-annotation-matches-the-a-shape', 'node-packs.md', `node-packs.md §x-openwop-form: the annotation on "${name}" MUST match the §A shape. Errors: ${JSON.stringify(validateShape.errors)}`),
      ).toBe(true);
    }
  });

  it('forward-compat: an unknown kind is a structurally valid annotation (renderer falls back per the §A MUST)', () => {
    expect(
      validateShape({ kind: 'unknown-future-picker' }),
      req('openwop.it.x-openwop-form-pack-manifest.forward-compat-an-unknown-kind-is-a-structurally-valid-annotation-renderer-falls', 'node-packs.md', 'node-packs.md §x-openwop-form: an unknown kind MUST validate (kind is an open string, not a closed enum) so future vocabulary is forward-compatible'),
    ).toBe(true);
  });

  it('negative: an annotation missing kind is rejected', () => {
    expect(
      shapeFailsWith({ dependsOn: 'provider' }, 'required').length,
      req('openwop.it.x-openwop-form-pack-manifest.negative-an-annotation-missing-kind-is-rejected', 'node-packs.md', 'node-packs.md §x-openwop-form: kind is the one REQUIRED sub-field'),
    ).toBeGreaterThan(0);
  });

  it('negative: a non-string kind is rejected', () => {
    expect(
      shapeFailsWith({ kind: 42 }, 'type').length,
      req('openwop.it.x-openwop-form-pack-manifest.negative-a-non-string-kind-is-rejected', 'node-packs.md', 'node-packs.md §x-openwop-form: kind MUST be a string'),
    ).toBeGreaterThan(0);
  });

  it('negative: a non-string dependsOn is rejected', () => {
    expect(
      shapeFailsWith({ kind: 'model-picker', dependsOn: ['provider'] }, 'type').length,
      req('openwop.it.x-openwop-form-pack-manifest.negative-a-non-string-dependson-is-rejected', 'node-packs.md', 'node-packs.md §x-openwop-form: dependsOn names a sibling property — it MUST be a string'),
    ).toBeGreaterThan(0);
  });
});
