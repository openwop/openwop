/**
 * Workflow-chain expansion — unresolvable typeId rejection per
 * `workflow-chain-packs.md` §"Expansion semantics (normative)" step 3
 * + `workflow-chain-packs.md` §"Error codes" `chain_unresolvable_typeid`.
 *
 * Server-free scenario. Asserts that when a chain's `dag.nodes[].typeId`
 * references an UNPUBLISHED typeId (one the destination host's pack
 * registry can't resolve), expansion is rejected with
 * `chain_unresolvable_typeid` BEFORE any node ids are rewritten or
 * placeholders substituted.
 *
 * The "rejection at expansion time" path is load-bearing for the
 * "additive — no new dispatch surface" invariant: if expansion produced
 * a workflow referencing an unknown typeId, the dispatching engine
 * would fail at run time with `unknown_typeid` and the user would see
 * a confusing failure far from the chain-pack tile they dragged.
 * Rejecting at edit time keeps the failure local to the author's
 * action.
 *
 * Per the spec's "Negative: chain references unpublished typeId"
 * example: the pack's manifest validation does NOT cross-check
 * published typeId existence (cycle issues + registry-availability
 * concerns); only the host-editor-time expansion step verifies — by
 * which point the destination host's pack registry has authoritative
 * knowledge of which typeIds it can resolve.
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics" step 3
 * @see spec/v1/workflow-chain-packs.md §"Error codes"
 * @see conformance/src/lib/workflow-chain-expansion.ts
 * @see RFCS/0013-workflow-chain-packs.md
 */

import { describe, it, expect } from 'vitest';
import {
  expandChain,
  ChainUnresolvableTypeIdError,
  type WorkflowChain,
} from '../lib/workflow-chain-expansion.js';

const CHAIN_WITH_UNKNOWN_TYPEID: WorkflowChain = {
  chainId: 'vendor.acme.someChain',
  version: '1.0.0',
  label: 'Some Chain',
  description: 'References an unpublished typeId — should fail expansion.',
  parameters: {},
  dag: {
    nodes: [
      { id: 'n1', typeId: 'made.up.foo', config: {} },
    ],
    edges: [],
  },
};

/** Resolver that only accepts a hardcoded set of "known" typeIds — the
 *  set the destination host's pack registry can satisfy. Mimics the
 *  realistic host-editor-time check. */
const KNOWN_TYPEIDS = new Set(['core.identity', 'core.ai.callPrompt']);
const isKnown = (typeId: string): boolean => KNOWN_TYPEIDS.has(typeId);

describe('category: workflow-chain expansion — unresolvable typeId rejection', () => {
  it('throws ChainUnresolvableTypeIdError when chain references an unknown typeId', () => {
    expect(
      () =>
        expandChain(CHAIN_WITH_UNKNOWN_TYPEID, {
          expansionId: 'x',
          params: {},
          isTypeIdResolvable: isKnown,
        }),
      'Per spec §"Expansion semantics" step 3: hosts MUST reject expansion with `chain_unresolvable_typeid` when any fragment node\'s typeId can\'t be resolved by the destination host.',
    ).toThrow(ChainUnresolvableTypeIdError);
  });

  it('error carries the offending typeId AND the chainId in `details`', () => {
    try {
      expandChain(CHAIN_WITH_UNKNOWN_TYPEID, {
        expansionId: 'x',
        params: {},
        isTypeIdResolvable: isKnown,
      });
      expect.fail('expandChain MUST have thrown ChainUnresolvableTypeIdError');
    } catch (err) {
      expect(err, 'expected ChainUnresolvableTypeIdError').toBeInstanceOf(
        ChainUnresolvableTypeIdError,
      );
      const e = err as ChainUnresolvableTypeIdError;
      expect(
        e.code,
        'Per spec §"Error codes": the wire-level error code MUST be `chain_unresolvable_typeid`.',
      ).toBe('chain_unresolvable_typeid');
      expect(
        e.typeId,
        'The error MUST surface the offending typeId so the host editor can render an actionable diagnostic.',
      ).toBe('made.up.foo');
      expect(
        e.chainId,
        'The error MUST surface the chainId so the host editor knows which chain-pack tile triggered the rejection.',
      ).toBe('vendor.acme.someChain');
    }
  });

  it('rejection happens BEFORE any id rewriting or placeholder substitution', () => {
    // If the spec allowed expansion to proceed and produce a half-built
    // fragment with an unknown typeId, downstream tooling would see a
    // workflow with an undispatchable node. The contract is "reject
    // cleanly at the resolution step, no partial output."
    let threw = false;
    try {
      expandChain(CHAIN_WITH_UNKNOWN_TYPEID, {
        expansionId: 'x',
        params: { foo: 'bar' },
        isTypeIdResolvable: isKnown,
      });
    } catch {
      threw = true;
    }
    expect(
      threw,
      'Expansion MUST throw before producing any output — host editors rely on the "no partial expansion" guarantee to keep parent workflows clean on rejection.',
    ).toBe(true);
  });

  it('accepts the chain when every typeId IS resolvable', () => {
    const resolvable: WorkflowChain = {
      ...CHAIN_WITH_UNKNOWN_TYPEID,
      dag: {
        nodes: [{ id: 'n1', typeId: 'core.identity', config: {} }],
        edges: [],
      },
    };
    expect(
      () =>
        expandChain(resolvable, {
          expansionId: 'x',
          params: {},
          isTypeIdResolvable: isKnown,
        }),
      'Sanity: when every typeId resolves, expansion MUST proceed without throwing.',
    ).not.toThrow();
  });

  it('throws on the FIRST unknown typeId encountered (fail-fast)', () => {
    // Chain with two nodes — one resolvable, one not. The unresolvable one
    // is second. The throw MUST identify the second one (the actual
    // offender), not silently skip it.
    const mixed: WorkflowChain = {
      ...CHAIN_WITH_UNKNOWN_TYPEID,
      dag: {
        nodes: [
          { id: 'n1', typeId: 'core.identity', config: {} },
          { id: 'n2', typeId: 'made.up.foo', config: {} },
        ],
        edges: [],
      },
    };
    try {
      expandChain(mixed, {
        expansionId: 'x',
        params: {},
        isTypeIdResolvable: isKnown,
      });
      expect.fail('MUST have thrown on n2\'s unknown typeId');
    } catch (err) {
      const e = err as ChainUnresolvableTypeIdError;
      expect(
        e.typeId,
        'When multiple nodes have unknown typeIds, the throw MUST identify the first unknown one encountered in declaration order.',
      ).toBe('made.up.foo');
    }
  });
});
