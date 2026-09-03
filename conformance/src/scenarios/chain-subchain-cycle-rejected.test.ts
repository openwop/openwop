/**
 * Sub-chain composition — bounded recursion (RFC 0133 §"Sub-chain composition").
 *
 * Server-free scenario. The PUBLIC TEST for SECURITY invariant
 * `sub-chain-expansion-bounded` (SECURITY/invariants.yaml). Co-expansion of a
 * chain's `subChains[]` MUST terminate on adversarial input — a host cannot be
 * driven into unbounded recursion (DoS) by a malicious pack. Two guards, one
 * rejection code (`sub_chain_cycle`):
 *
 *   - a chain that transitively composes ITSELF is rejected;
 *   - nesting past the host's `maxSubChainDepth` (RECOMMENDED default 8) is
 *     rejected with the same code (the depth backstop).
 *
 * Also asserts the complement — an acyclic tree WITHIN the bound expands cleanly
 * (the guard rejects bombs, not benign composition), and an undeclared /
 * unresolvable `subChainRef` is `sub_chain_unresolved` (a ref pointing at no
 * sibling chain), the distinct §1.1 resolution error.
 *
 * @see spec/v1/workflow-chain-packs.md §"Sub-chain composition (RFC 0133)"
 * @see SECURITY/invariants.yaml (sub-chain-expansion-bounded)
 * @see conformance/src/lib/workflow-chain-expansion.ts (expandChainTree)
 */

import { describe, it, expect } from 'vitest';
import {
  expandChainTree,
  SubChainCycleError,
  SubChainDepthExceededError,
  SubChainUnresolvedError,
  DEFAULT_MAX_SUB_CHAIN_DEPTH,
  type WorkflowChain,
} from '../lib/workflow-chain-expansion.js';
import { req } from '../lib/requirement-ids.js';
const SPEC = 'workflow-chain-packs.md §"Sub-chain composition (RFC 0133)"';

/** A chain node that dispatches a named sub-chain ref. */
const dispatchNode = (id: string, ref: string) => ({
  id,
  typeId: 'core.subWorkflow',
  config: { subChainRef: ref },
});

/** Build a self-referential chain (composes itself). */
const selfRef: WorkflowChain = {
  chainId: 'loop.self',
  version: '1.0.0',
  label: 'Self loop',
  description: 'Composes itself — a cycle.',
  parameters: {},
  subChains: [{ ref: 'loop.self' }],
  dag: { nodes: [dispatchNode('n', 'loop.self')] },
};

/** Build a linear chain of `depth` links a→a1→a2… each composing the next, so
 *  co-expansion recurses exactly `depth` deep (no cycle). */
function linearChain(depth: number): { root: WorkflowChain; siblings: Map<string, WorkflowChain> } {
  const siblings = new Map<string, WorkflowChain>();
  for (let i = 0; i <= depth; i++) {
    const id = `link.${i}`;
    const next = `link.${i + 1}`;
    const chain: WorkflowChain = {
      chainId: id,
      version: '1.0.0',
      label: id,
      description: id,
      parameters: {},
      dag:
        i < depth
          ? { nodes: [dispatchNode('d', next)] }
          : { nodes: [{ id: 'leaf', typeId: 'core.ai.callPrompt', config: {} }] },
    };
    if (i < depth) chain.subChains = [{ ref: next }];
    siblings.set(id, chain);
  }
  return { root: siblings.get('link.0')!, siblings };
}

const ctxFor = (siblings: Map<string, WorkflowChain>, maxDepth?: number) => ({
  parentExpansionId: 'exp1',
  tenantId: 'tenant-a',
  params: {},
  isTypeIdResolvable: () => true,
  siblingChains: siblings,
  ...(maxDepth !== undefined ? { maxDepth } : {}),
});

describe('chain-subchain-cycle-rejected: bounded recursion (RFC 0133, server-free)', () => {
  it('rejects a chain that transitively composes itself (sub_chain_cycle)', () => {
    const siblings = new Map([[selfRef.chainId, selfRef]]);
    expect(() => expandChainTree(selfRef, ctxFor(siblings)), req('openwop.it.chain-subchain-cycle-rejected.rejects-a-chain-that-transitively-composes-itself-sub-chain-cycle', SPEC, 'self-composition MUST reject')).toThrow(
      SubChainCycleError,
    );
    try {
      expandChainTree(selfRef, ctxFor(siblings));
    } catch (e) {
      expect((e as SubChainCycleError).code, req('openwop.it.chain-subchain-cycle-rejected.rejects-a-chain-that-transitively-composes-itself-sub-chain-cycle', SPEC, 'wire code sub_chain_cycle')).toBe('sub_chain_cycle');
      expect((e as SubChainCycleError).httpStatus, req('openwop.it.chain-subchain-cycle-rejected.rejects-a-chain-that-transitively-composes-itself-sub-chain-cycle', SPEC, 'HTTP 400')).toBe(400);
    }
  });

  it('rejects nesting past maxSubChainDepth with a DISTINCT sub_chain_max_depth_exceeded code (DoS backstop)', () => {
    // A linear chain deeper than a small cap: recursion must fail closed with a
    // code distinct from a cycle, so an operator sees WHICH backstop fired.
    const { root, siblings } = linearChain(5);
    expect(
      () => expandChainTree(root, ctxFor(siblings, 2)),
      req('openwop.it.chain-subchain-cycle-rejected.rejects-nesting-past-maxsubchaindepth-with-a-distinct-sub-chain-max-depth-exceed', SPEC, 'depth breach MUST reject (bounded recursion)'),
    ).toThrow(SubChainDepthExceededError);
    try {
      expandChainTree(root, ctxFor(siblings, 2));
    } catch (e) {
      expect((e as SubChainDepthExceededError).code, req('openwop.it.chain-subchain-cycle-rejected.rejects-nesting-past-maxsubchaindepth-with-a-distinct-sub-chain-max-depth-exceed', SPEC, 'distinct wire code')).toBe('sub_chain_max_depth_exceeded');
      expect(e instanceof SubChainCycleError, req('openwop.it.chain-subchain-cycle-rejected.rejects-nesting-past-maxsubchaindepth-with-a-distinct-sub-chain-max-depth-exceed', SPEC, 'a depth breach is NOT a cycle')).toBe(false);
    }
  });

  it('expands an acyclic tree WITHIN the bound cleanly (guard rejects bombs, not benign composition)', () => {
    const { root, siblings } = linearChain(3);
    const { children } = expandChainTree(root, ctxFor(siblings, DEFAULT_MAX_SUB_CHAIN_DEPTH));
    // 3 composing links (link.0..link.2 each compose their successor) ⇒ 3 co-registered children.
    expect(children.length, req('openwop.it.chain-subchain-cycle-rejected.expands-an-acyclic-tree-within-the-bound-cleanly-guard-rejects-bombs-not-benign', SPEC, 'benign acyclic tree within the bound expands')).toBe(3);
  });

  it('rejects a subChainRef that resolves to no sibling chain (sub_chain_unresolved)', () => {
    const orphan: WorkflowChain = {
      chainId: 'orphan',
      version: '1.0.0',
      label: 'Orphan',
      description: 'References a missing sibling.',
      parameters: {},
      subChains: [{ ref: 'does-not-exist' }],
      dag: { nodes: [dispatchNode('n', 'does-not-exist')] },
    };
    const siblings = new Map([[orphan.chainId, orphan]]);
    expect(
      () => expandChainTree(orphan, ctxFor(siblings)),
      req('openwop.it.chain-subchain-cycle-rejected.rejects-a-subchainref-that-resolves-to-no-sibling-chain-sub-chain-unresolved', SPEC, '§1.1 — unresolvable ref rejects distinctly'),
    ).toThrow(SubChainUnresolvedError);
  });
});
