/**
 * workflow-primary-output-annotation — RFC 0065 schema shape conformance.
 *
 * Server-free schema assertions that the optional `outputRole` field on
 * `WorkflowNode` is exactly that — optional, additive, and a closed enum:
 *   1. A WorkflowDefinition with one node declaring `outputRole: "primary"`
 *      and another declaring `outputRole: "secondary"` validates.
 *   2. A WorkflowDefinition with the field absent (legacy shape) still
 *      validates — preserves the additive promise.
 *   3. An unknown `outputRole` value is rejected by the closed enum.
 *   4. The field set to a non-string is rejected.
 *
 * Always runs (pure on-disk Ajv2020 validation; no host involvement —
 * the field has no engine-observable effect by design).
 *
 * @see RFCS/0065-workflow-node-primary-output-annotation.md
 * @see schemas/workflow-definition.schema.json ($defs.WorkflowNode.outputRole)
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';

function compileWorkflowDefinition(): ReturnType<Ajv2020['compile']> {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // Register cross-file `$ref` targets — same pattern as
  // `fixtures-valid.test.ts`. Without these, Ajv throws
  // `missingRef` when compiling `workflow-definition.schema.json`
  // because it references agent-ref + prompt-ref by URL.
  const agentRefSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'agent-ref.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  const promptRefSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'prompt-ref.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  const promptKindSchema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'prompt-kind.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  ajv.addSchema(agentRefSchema, 'agent-ref.schema.json');
  ajv.addSchema(promptRefSchema, 'prompt-ref.schema.json');
  ajv.addSchema(promptRefSchema, './prompt-ref.schema.json');
  ajv.addSchema(promptKindSchema, 'prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, './prompt-kind.schema.json');
  const compensationPolicySchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'compensation-policy.schema.json'), 'utf8'));
  ajv.addSchema(compensationPolicySchema, 'compensation-policy.schema.json');
  ajv.addSchema(compensationPolicySchema, './compensation-policy.schema.json');
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'workflow-definition.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  return ajv.compile(schema);
}

/** Build the minimal-required shape of a WorkflowDefinition. Tests
 *  inject per-case node overrides via the `nodes` arg. */
function baseDefinition(nodes: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'wf-test',
    name: 'Test',
    version: '1.0.0',
    nodes,
    edges: [],
    triggers: [],
    variables: [],
    metadata: { createdAt: '2026-05-25T00:00:00Z' },
    settings: {},
  };
}

function baseNode(id: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    typeId: 'core.test.noop',
    name: id,
    position: { x: 0, y: 0 },
    config: {},
    inputs: {},
    ...extras,
  };
}

describe('workflow-primary-output-annotation: outputRole shape (RFC 0065)', () => {
  const validate = compileWorkflowDefinition();

  it('accepts a workflow with one node declaring outputRole="primary"', () => {
    const def = baseDefinition([
      baseNode('a', { outputRole: 'primary' }),
      baseNode('b'),
    ]);
    const ok = validate(def);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('accepts primary AND secondary annotations on different nodes', () => {
    const def = baseDefinition([
      baseNode('a', { outputRole: 'primary' }),
      baseNode('b', { outputRole: 'secondary' }),
      baseNode('c'),
    ]);
    const ok = validate(def);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('accepts a workflow with the field absent (additive promise)', () => {
    const def = baseDefinition([
      baseNode('a'),
      baseNode('b'),
    ]);
    const ok = validate(def);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('rejects an unknown outputRole enum value', () => {
    const def = baseDefinition([
      baseNode('a', { outputRole: 'tertiary' }),
    ]);
    const ok = validate(def);
    expect(ok).toBe(false);
    expect(validate.errors).toBeTruthy();
  });

  it('rejects outputRole set to a non-string', () => {
    const def = baseDefinition([
      baseNode('a', { outputRole: 1 }),
    ]);
    const ok = validate(def);
    expect(ok).toBe(false);
  });

  it('permits multiple nodes declaring outputRole="primary" (tooling decides)', () => {
    // The schema doesn't reject multiple primaries — tooling MAY pick
    // any (lexicographic node id is the RFC's recommended tiebreaker).
    // This test pins that the schema-layer doesn't enforce uniqueness,
    // matching the RFC's "schema permits N primaries" promise.
    const def = baseDefinition([
      baseNode('a', { outputRole: 'primary' }),
      baseNode('b', { outputRole: 'primary' }),
    ]);
    const ok = validate(def);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
