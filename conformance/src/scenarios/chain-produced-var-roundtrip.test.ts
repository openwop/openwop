/**
 * Produced (run-scoped) variables — round-trip + closed-world (RFC 0133 §2).
 *
 * Server-free scenario. Exercises `emitProducedVariables` + `validateVariableReads`
 * in the reference library against a chain that declares `producedVariables` a
 * downstream node reads via a `{ type:"variable", variableName }` input binding.
 * Asserts the normative contract from `workflow-chain-packs.md`
 * §"Produced (run-scoped) variables (RFC 0133)":
 *
 *   - §2.3: declared `producedVariables` are emitted into the expanded
 *     `WorkflowDefinition.variables[]` as run-scoped entries (name + type,
 *     NO author-time value — distinct from `parameters`).
 *   - §2.2: a `{ type:"variable" }` read of a DECLARED name validates.
 *   - §2.2: a `{ type:"variable" }` read of an UNDECLARED name fails closed with
 *     `variable_undeclared` (the closed-world guard — "reads a value nothing
 *     produces").
 *   - a read of a MATERIALIZED PARAMETER name (RFC 0124 deferred mode) validates
 *     even without a `producedVariables` entry (params + produced vars compose).
 *
 * @see spec/v1/workflow-chain-packs.md §"Produced (run-scoped) variables (RFC 0133)"
 * @see conformance/src/lib/workflow-chain-expansion.ts (emitProducedVariables, validateVariableReads)
 * @see RFCS/0133-workflow-chain-composition.md
 */

import { describe, it, expect } from 'vitest';
import {
  emitProducedVariables,
  validateVariableReads,
  VariableUndeclaredError,
  ProducedVarProducerUnknownError,
  type WorkflowChain,
} from '../lib/workflow-chain-expansion.js';
import { req } from '../lib/requirement-ids.js';
const SPEC = 'workflow-chain-packs.md §"Produced (run-scoped) variables (RFC 0133)"';

/** `generate` writes `plan`; `decompose` reads it via a variable binding. */
const PLAN_GEN: WorkflowChain = {
  chainId: 'kicktodo.plan-generation',
  version: '1.0.0',
  label: 'Plan generation',
  description: 'generate writes plan; decompose reads it.',
  parameters: {},
  producedVariables: [
    { name: 'plan', producedBy: 'generate', type: 'object', description: 'the generated plan' },
  ],
  dag: {
    nodes: [
      { id: 'generate', typeId: 'core.ai.callPrompt', config: { systemPrompt: 'Generate a plan.' } },
      { id: 'decompose', typeId: 'core.ai.callPrompt', inputs: { plan: { type: 'variable', variableName: 'plan' } } },
    ],
    edges: [{ from: 'generate', to: 'decompose' }],
  },
};

describe('chain-produced-var-roundtrip: run-scoped variables (RFC 0133 §2, server-free)', () => {
  it('emits declared producedVariables into variables[] (name + type, NO value)', () => {
    const vars = emitProducedVariables(PLAN_GEN);
    expect(vars, req('openwop.it.chain-produced-var-roundtrip.emits-declared-producedvariables-into-variables-name-type-no-value', SPEC, '§2.3 — one run-scoped variable emitted')).toEqual([{ name: 'plan', type: 'object' }]);
    // Run-scoped: NO author-time value rides the emitted entry.
    expect('value' in (vars[0] as object), req('openwop.it.chain-produced-var-roundtrip.emits-declared-producedvariables-into-variables-name-type-no-value', SPEC, '§2.3 — no author-time value (distinct from parameters)')).toBe(
      false,
    );
    expect(
      'defaultValue' in (vars[0] as object),
      req('openwop.it.chain-produced-var-roundtrip.emits-declared-producedvariables-into-variables-name-type-no-value', SPEC, '§2.3 — no default value (a produced var is written during the run)'),
    ).toBe(false);
  });

  it('validates a variable read of a DECLARED producedVariables name', () => {
    expect(() => validateVariableReads(PLAN_GEN), req('openwop.it.chain-produced-var-roundtrip.validates-a-variable-read-of-a-declared-producedvariables-name', SPEC, '§2.2 — declared read is closed-world valid')).not.toThrow();
  });

  it('rejects a variable read of an UNDECLARED name (variable_undeclared)', () => {
    const undeclared: WorkflowChain = {
      ...PLAN_GEN,
      producedVariables: [], // nothing declared
      dag: {
        nodes: [
          { id: 'generate', typeId: 'core.ai.callPrompt', config: {} },
          {
            id: 'decompose',
            typeId: 'core.ai.callPrompt',
            inputs: { plan: { type: 'variable', variableName: 'plan' } },
          },
        ],
      },
    };
    expect(() => validateVariableReads(undeclared), req('openwop.it.chain-produced-var-roundtrip.rejects-a-variable-read-of-an-undeclared-name-variable-undeclared', SPEC, '§2.2 — undeclared read MUST reject')).toThrow(
      VariableUndeclaredError,
    );
    try {
      validateVariableReads(undeclared);
    } catch (e) {
      expect((e as VariableUndeclaredError).code, req('openwop.it.chain-produced-var-roundtrip.rejects-a-variable-read-of-an-undeclared-name-variable-undeclared', SPEC, 'wire code variable_undeclared')).toBe('variable_undeclared');
      expect((e as VariableUndeclaredError).variableName, req('openwop.it.chain-produced-var-roundtrip.rejects-a-variable-read-of-an-undeclared-name-variable-undeclared', SPEC, 'names the offending variable')).toBe('plan');
    }
  });

  it('rejects a producedVariables whose producedBy names a NON-EXISTENT node (produced_var_producer_unknown)', () => {
    const badProducer: WorkflowChain = {
      ...PLAN_GEN,
      producedVariables: [{ name: 'plan', producedBy: 'ghost', type: 'object' }],
    };
    expect(
      () => validateVariableReads(badProducer),
      req('openwop.it.chain-produced-var-roundtrip.rejects-a-producedvariables-whose-producedby-names-a-non-existent-node-produced', SPEC, '§2.2 — producedBy MUST be a real fragment node'),
    ).toThrow(ProducedVarProducerUnknownError);
    try {
      validateVariableReads(badProducer);
    } catch (e) {
      expect((e as ProducedVarProducerUnknownError).code, req('openwop.it.chain-produced-var-roundtrip.rejects-a-producedvariables-whose-producedby-names-a-non-existent-node-produced', SPEC, 'distinct wire code')).toBe(
        'produced_var_producer_unknown',
      );
    }
  });

  it('rejects a producedVariables name that COLLIDES with a parameter (channels MUST be disjoint)', () => {
    const collide: WorkflowChain = {
      ...PLAN_GEN,
      parameters: { type: 'object', properties: { plan: { type: 'object' } } },
      producedVariables: [{ name: 'plan', producedBy: 'generate', type: 'object' }],
    };
    expect(
      () => validateVariableReads(collide),
      req('openwop.it.chain-produced-var-roundtrip.rejects-a-producedvariables-name-that-collides-with-a-parameter-channels-must-be', SPEC, '§2.2 — a produced var colliding with a parameter name MUST reject'),
    ).toThrow(VariableUndeclaredError);
  });

  it('validates a read of a MATERIALIZED PARAMETER name (params + produced vars compose)', () => {
    // A read whose name is NOT a produced var but IS a materialized parameter
    // (RFC 0124 deferred mode) is closed-world valid.
    const paramRead: WorkflowChain = {
      ...PLAN_GEN,
      producedVariables: [],
      dag: {
        nodes: [
          { id: 'n', typeId: 'core.ai.callPrompt', inputs: { seed: { type: 'variable', variableName: 'seed' } } },
        ],
      },
    };
    expect(
      () => validateVariableReads(paramRead, new Set(['seed'])),
      req('openwop.it.chain-produced-var-roundtrip.validates-a-read-of-a-materialized-parameter-name-params-produced-vars-compose', SPEC, '§2.2 — a materialized-parameter read validates'),
    ).not.toThrow();
    // …but still rejects when the name is neither a produced var nor a param.
    expect(
      () => validateVariableReads(paramRead, new Set()),
      req('openwop.it.chain-produced-var-roundtrip.validates-a-read-of-a-materialized-parameter-name-params-produced-vars-compose', SPEC, '§2.2 — same read with no matching param still rejects'),
    ).toThrow(VariableUndeclaredError);
  });
});
