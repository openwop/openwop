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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json');
// In-repo example pack — proves the schema validates a non-trivial
// real-world-shaped manifest (closes RFC 0013 Phase 4 in-tree path).
// Resolved relative to the repo root (V1_DIR is non-null in the repo
// layout AND in any in-tree mirror; null under the published-tarball
// layout where examples/ isn't bundled). Skipped cleanly when unavailable.
const REPO_ROOT = V1_DIR ? dirname(dirname(V1_DIR)) : null;
const EXAMPLE_PACK_PATH = REPO_ROOT
  ? join(REPO_ROOT, 'examples/packs/workflow-chain-sample/pack.json')
  : null;

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
      req('openwop.it.workflow-chain-pack-manifest-validation.positive-a-valid-workflow-chain-pack-manifest-validates-cleanly', 'workflow-chain-packs.md', `Positive sample MUST validate against workflow-chain-pack-manifest.schema.json — got:\n${errs}`),
    ).toBe(true);
  });

  it('positive: a FragmentEdge condition takes the top-level EdgeCondition shape (RFC 0013 safety-fix 2026-07-03)', () => {
    // §edges: "Same shape as in a top-level workflow definition." An edge
    // condition therefore MUST be the EdgeCondition object {type,left,right},
    // not a bare string — this is what lets a chain express content routing.
    const conditionalChain = {
      name: 'vendor.acme.router',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '>=1.0.0' },
      chains: [
        {
          chainId: 'vendor.acme.route',
          version: '1.0.0',
          label: 'Route',
          description: 'Router with a conditional branch.',
          parameters: { type: 'object', properties: {} },
          dag: {
            nodes: [
              { id: 'route', typeId: 'core.flow.router' },
              { id: 'urgent', typeId: 'core.identity' },
            ],
            edges: [
              { from: 'route', to: 'urgent', condition: { type: 'contains', left: 'branches', right: 'urgent' } },
            ],
          },
        },
      ],
    };
    const ok = validate(conditionalChain);
    const errs = (validate.errors ?? []).map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`).join('\n');
    expect(ok, req('openwop.it.workflow-chain-pack-manifest-validation.positive-a-fragmentedge-condition-takes-the-top-level-edgecondition-shape-rfc-00', 'RFC 0013', `Object-shaped edge condition MUST validate — got:\n${errs}`)).toBe(true);
  });

  it('negative: a bare-string FragmentEdge condition is rejected (the pre-2026-07-03 shape)', () => {
    const stringCondition = {
      name: 'vendor.acme.legacy',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '>=1.0.0' },
      chains: [
        {
          chainId: 'vendor.acme.legacy',
          version: '1.0.0',
          label: 'Legacy',
          description: 'x',
          parameters: { type: 'object', properties: {} },
          dag: {
            nodes: [
              { id: 'a', typeId: 'core.identity' },
              { id: 'b', typeId: 'core.identity' },
            ],
            edges: [{ from: 'a', to: 'b', condition: 'output.approved == true' }],
          },
        },
      ],
    };
    expect(validate(stringCondition), req('openwop.it.workflow-chain-pack-manifest-validation.negative-a-bare-string-fragmentedge-condition-is-rejected-the-pre-2026-07-03-sha', 'workflow-chain-packs.md', 'A string edge condition MUST NOT validate under the corrected schema')).toBe(false);
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
      req('openwop.it.workflow-chain-pack-manifest-validation.negative-manifest-mixing-chains-and-nodes-is-rejected-pack-kind-invalid', 'workflow-chain-packs.md', 'Manifest with both nodes[] and chains[] MUST fail workflow-chain schema validation (pack_kind_invalid at the registry surface).'),
    ).toBe(false);
    const hasAdditionalPropertiesErr = (validate.errors ?? []).some(
      (e: ErrorObject) => e.keyword === 'additionalProperties',
    );
    expect(
      hasAdditionalPropertiesErr,
      req('openwop.it.workflow-chain-pack-manifest-validation.negative-manifest-mixing-chains-and-nodes-is-rejected-pack-kind-invalid', 'workflow-chain-packs.md', 'Expected an `additionalProperties` violation flagging the unexpected `nodes` field.'),
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
      req('openwop.it.workflow-chain-pack-manifest-validation.negative-chain-entry-with-invalid-chainid-is-rejected-pattern-violation', 'workflow-chain-packs.md', 'Manifest with invalid chainId MUST fail workflow-chain schema validation.'),
    ).toBe(false);
    const hasPatternErr = (validate.errors ?? []).some(
      (e: ErrorObject) =>
        e.keyword === 'pattern' && (e.instancePath ?? '').includes('chainId'),
    );
    expect(
      hasPatternErr,
      req('openwop.it.workflow-chain-pack-manifest-validation.negative-chain-entry-with-invalid-chainid-is-rejected-pattern-violation', 'workflow-chain-packs.md', 'Expected a `pattern` violation on the chains[].chainId field.'),
    ).toBe(true);
  });

  it('positive: the in-repo example pack at examples/packs/workflow-chain-sample/ validates against the schema', () => {
    if (!EXAMPLE_PACK_PATH || !existsSync(EXAMPLE_PACK_PATH)) {
      // Published-tarball layout doesn't ship examples/; skip cleanly.
      return softSkip('blocked', 'precondition not met — `!EXAMPLE_PACK_PATH || !existsSync(EXAMPLE_PACK_PATH)` returned early (Published-tarball layout doesn\'t ship examples/; skip cleanly.) (seam, prior step, or fixture unavailable)');
    }
    const manifest = JSON.parse(readFileSync(EXAMPLE_PACK_PATH, 'utf8'));
    const ok = validate(manifest);
    const errs = (validate.errors ?? [])
      .map((e: ErrorObject) => `${e.instancePath || '/'}: ${e.message}`)
      .join('\n');
    expect(
      ok,
      req('openwop.it.workflow-chain-pack-manifest-validation.positive-the-in-repo-example-pack-at-examples-packs-workflow-chain-sample-valida', 'workflow-chain-packs.md', `examples/packs/workflow-chain-sample/pack.json MUST validate against workflow-chain-pack-manifest.schema.json (closes RFC 0013 Phase 4 in-tree path). Errors:\n${errs}`),
    ).toBe(true);
    // Spot-check the structural claims the example README makes:
    expect(manifest.kind, req('openwop.it.workflow-chain-pack-manifest-validation.positive-the-in-repo-example-pack-at-examples-packs-workflow-chain-sample-valida', 'workflow-chain-packs.md', 'example pack MUST declare kind: "workflow-chain"')).toBe(
      'workflow-chain',
    );
    expect(
      Array.isArray(manifest.chains) && manifest.chains.length === 2,
      req('openwop.it.workflow-chain-pack-manifest-validation.positive-the-in-repo-example-pack-at-examples-packs-workflow-chain-sample-valida', 'workflow-chain-packs.md', 'example pack MUST ship exactly 2 chains (1-node + 2-node shapes) per its README contract'),
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
      req('openwop.it.workflow-chain-pack-manifest-validation.negative-omitting-kind-field-rejects-kind-is-required', 'workflow-chain-packs.md', 'Manifest without kind: "workflow-chain" MUST fail this schema (the other path is node-pack-manifest.schema.json).'),
    ).toBe(false);
  });
});
