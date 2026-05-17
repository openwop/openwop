/**
 * Workflow-chain pack manifest validation — `workflow-chain-packs.md` §Manifest format
 * + `schemas/workflow-chain-pack-manifest.schema.json` (closes RFC 0013 Phase 1).
 *
 * Server-free schema-validation scenario. Exercises the new
 * `workflow-chain-pack-manifest.schema.json` with a positive sample and
 * two negative samples derived from the RFC's Negative examples:
 *
 *   1. Positive: a valid `kind: "workflow-chain"` manifest with a single
 *      `chains[]` entry validates cleanly.
 *   2. Negative — kind/contents mismatch: a manifest carrying BOTH
 *      `chains[]` AND `nodes[]` is rejected. Surface-level outcome at
 *      the registry HTTP API is `pack_kind_invalid` per the spec;
 *      schema-level outcome is an `additionalProperties` violation on
 *      `nodes` (the workflow-chain schema does not declare that field).
 *   3. Negative — invalid `chainId`: a chain entry whose `chainId` does
 *      not match the reverse-DNS pattern is rejected with a `pattern`
 *      violation.
 *
 * Capability-gated scenarios for end-to-end expansion
 * (`workflow-chain-expansion.test.ts`) and signature verification
 * (`workflow-chain-pack-signature-verification.test.ts`) are deferred
 * to Phase 2/3 per the RFC.
 *
 * @see spec/v1/workflow-chain-packs.md
 * @see schemas/workflow-chain-pack-manifest.schema.json
 * @see RFCS/0013-workflow-chain-packs.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { SCHEMAS_DIR } from '../lib/paths.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json');

describe('category: workflow-chain-pack manifest validation', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  it('positive: a valid workflow-chain pack manifest validates cleanly', () => {
    const manifest = {
      name: 'vendor.acme.editor-presets',
      version: '1.0.0',
      kind: 'workflow-chain',
      description: 'Author-time editor presets.',
      engines: { openwop: '>=1.0.0 <2.0.0' },
      chains: [
        {
          chainId: 'vendor.acme.generatePRD',
          version: '1.0.0',
          label: 'Generate PRD',
          description: 'Single-node AI call with PRD authoring prompt.',
          parameters: {
            type: 'object',
            required: ['productIdea'],
            properties: {
              productIdea: { type: 'string' },
              targetAudience: { type: 'string', default: '' },
            },
          },
          dag: {
            nodes: [
              {
                id: 'prd-call',
                typeId: 'core.ai.callPrompt',
                config: {
                  systemPrompt: 'Write a PRD for: {{params.productIdea}}',
                  envelopeType: 'prd.create',
                  provider: 'anthropic',
                },
              },
            ],
            edges: [],
          },
          outputs: {
            prdId: { type: 'string', description: 'Created PRD artifact id.' },
          },
          capabilities: ['side-effectful'],
        },
      ],
    };
    const ok = validate(manifest);
    const errs = (validate.errors ?? [])
      .map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
      .join('\n');
    expect(
      ok,
      `Positive sample MUST validate against workflow-chain-pack-manifest.schema.json — got:\n${errs}`,
    ).toBe(true);
  });

  it('negative: manifest mixing chains[] AND nodes[] is rejected (pack_kind_invalid)', () => {
    // Per workflow-chain-packs.md §Pack kind discriminator: "Manifests MUST
    // have exactly one of nodes[] (kind=node) OR chains[] (kind=workflow-chain).
    // Manifests containing both MUST be rejected at manifest validation with
    // error code pack_kind_invalid." The schema-level enforcement is via
    // additionalProperties: false (the workflow-chain schema does not declare
    // a `nodes` property, so its presence triggers the violation).
    const manifest = {
      name: 'vendor.acme.mixed',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '>=1.0.0' },
      nodes: [
        { typeId: 'vendor.acme.foo', version: '1.0.0', category: 'data', role: 'pure' },
      ],
      chains: [
        {
          chainId: 'vendor.acme.bar',
          version: '1.0.0',
          label: 'Bar',
          description: 'x',
          parameters: {},
          dag: { nodes: [{ id: 'n', typeId: 'core.identity' }], edges: [] },
        },
      ],
    };
    const ok = validate(manifest);
    expect(
      ok,
      'Manifest with both nodes[] and chains[] MUST fail workflow-chain schema validation (pack_kind_invalid at the registry surface).',
    ).toBe(false);
    const hasAdditionalPropertiesErr = (validate.errors ?? []).some(
      (e: ErrorObject) => e.keyword === 'additionalProperties',
    );
    expect(
      hasAdditionalPropertiesErr,
      'Expected an `additionalProperties` violation flagging the unexpected `nodes` field.',
    ).toBe(true);
  });

  it('negative: chain entry with invalid chainId is rejected (pattern violation)', () => {
    // Per workflow-chain-packs.md §Chain entry shape: chainId MUST match the
    // reverse-DNS pattern `^[a-z][a-zA-Z0-9._-]*$`. An empty string, leading
    // digit, or any other shape violating the pattern fails validation.
    const manifest = {
      name: 'vendor.acme.editor-presets',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '>=1.0.0' },
      chains: [
        {
          // INVALID — leading digit, contains uppercase that breaks the
          // first-char rule, AND a slash that no chainId is allowed to carry.
          chainId: '9Bad/Id',
          version: '1.0.0',
          label: 'Bad',
          description: 'x',
          parameters: {},
          dag: { nodes: [{ id: 'n', typeId: 'core.identity' }], edges: [] },
        },
      ],
    };
    const ok = validate(manifest);
    expect(
      ok,
      'Manifest with invalid chainId MUST fail workflow-chain schema validation.',
    ).toBe(false);
    const hasPatternErr = (validate.errors ?? []).some(
      (e: ErrorObject) =>
        e.keyword === 'pattern' && (e.instancePath ?? '').includes('chainId'),
    );
    expect(
      hasPatternErr,
      'Expected a `pattern` violation on the chains[].chainId field.',
    ).toBe(true);
  });

  it('negative: omitting kind field rejects (kind is required)', () => {
    // Defensive — the workflow-chain schema makes `kind` REQUIRED so a
    // node-pack-shape manifest can't accidentally validate against it.
    const manifest = {
      name: 'vendor.acme.editor-presets',
      version: '1.0.0',
      engines: { openwop: '>=1.0.0' },
      chains: [
        {
          chainId: 'vendor.acme.x',
          version: '1.0.0',
          label: 'X',
          description: 'x',
          parameters: {},
          dag: { nodes: [{ id: 'n', typeId: 'core.identity' }], edges: [] },
        },
      ],
    };
    const ok = validate(manifest);
    expect(
      ok,
      'Manifest without kind: "workflow-chain" MUST fail this schema (the other path is node-pack-manifest.schema.json).',
    ).toBe(false);
  });
});
