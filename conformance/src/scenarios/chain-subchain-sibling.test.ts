/**
 * Sub-chain composition — sibling co-registration (RFC 0133 §1).
 *
 * Server-free scenario. Exercises `expandChainTree` in the reference library
 * (`conformance/src/lib/workflow-chain-expansion.ts`) against a pack with a
 * PARENT chain that composes a SIBLING child chain via `config.subChainRef`.
 * Asserts the normative co-expansion + co-registration contract from
 * `workflow-chain-packs.md` §"Sub-chain composition (RFC 0133)":
 *
 *   - §1.3 step 2: the referenced sibling is co-registered as its own workflow,
 *     under a DETERMINISTIC id minted from `(parentExpansionId, childChainId)`.
 *   - §1.3 step 2: a child referenced TWICE registers exactly ONCE (dedup by the
 *     deterministic id — a repeat instantiation converges).
 *   - §1.3 step 3: each referencing node's `config.subChainRef` is rewritten to
 *     the minted child `config.workflowId` (the field the runtime already reads),
 *     and the transient `subChainRef` key is dropped.
 *   - the child reference IS preserved at runtime (unlike RFC 0013 inline mode) —
 *     the parent holds a concrete `workflowId` pointing at the co-registered child.
 *   - determinism: two expansions with the SAME `parentExpansionId` mint the SAME
 *     child id (so `:fork` / re-instantiation reproduces the same child).
 *
 * @see spec/v1/workflow-chain-packs.md §"Sub-chain composition (RFC 0133)"
 * @see conformance/src/lib/workflow-chain-expansion.ts (expandChainTree)
 * @see RFCS/0133-workflow-chain-composition.md
 */

import { describe, it, expect } from 'vitest';
import {
  expandChainTree,
  mintChildWorkflowId,
  type WorkflowChain,
} from '../lib/workflow-chain-expansion.js';

/** Server-free assertion-message helper (mirrors driver.describe without OPENWOP_BASE_URL). */
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;
const SPEC = 'workflow-chain-packs.md §"Sub-chain composition (RFC 0133)"';

/** A leaf child chain — one plain node, no further composition. */
const CHILD: WorkflowChain = {
  chainId: 'lesson-batch',
  version: '1.0.0',
  label: 'Lesson batch',
  description: 'Generates one batch of lessons.',
  parameters: {},
  dag: { nodes: [{ id: 'gen', typeId: 'core.ai.callPrompt', config: { systemPrompt: 'Write a lesson.' } }] },
};

/** A parent chain that composes the sibling `lesson-batch` from two dispatch
 *  nodes (so we can prove dedup: two refs → one co-registered child). */
const PARENT: WorkflowChain = {
  chainId: 'kicktodo.challenge-factory',
  version: '1.0.0',
  label: 'Challenge factory',
  description: 'Runs lesson-batch children per checkpoint.',
  parameters: {},
  subChains: [{ ref: 'lesson-batch' }],
  dag: {
    nodes: [
      { id: 'plan', typeId: 'core.ai.callPrompt', config: { systemPrompt: 'Plan the challenge.' } },
      { id: 'build-0', typeId: 'core.subWorkflow', config: { subChainRef: 'lesson-batch' }, inputs: { checkpoint: 0 } },
      { id: 'build-1', typeId: 'core.subWorkflow', config: { subChainRef: 'lesson-batch' }, inputs: { checkpoint: 1 } },
    ],
    edges: [
      { from: 'plan', to: 'build-0' },
      { from: 'plan', to: 'build-1' },
    ],
  },
};

const siblings = new Map<string, WorkflowChain>([
  [CHILD.chainId, CHILD],
  [PARENT.chainId, PARENT],
]);

const ctx = (tenantId = 'tenant-a') => ({
  parentExpansionId: 'exp1',
  tenantId,
  params: {},
  isTypeIdResolvable: () => true,
  siblingChains: siblings,
});

describe('chain-subchain-sibling: co-registration (RFC 0133 §1, server-free)', () => {
  it('co-registers the referenced sibling as its own workflow', () => {
    const { children } = expandChainTree(PARENT, ctx());
    expect(children.length, why(SPEC, '§1.3 step 2 — one distinct sibling ref ⇒ one co-registered child')).toBe(1);
    expect(children[0]?.chainId, why(SPEC, 'child carries the composed chainId')).toBe('lesson-batch');
    expect(
      children[0]?.fragment.nodes.length,
      why(SPEC, 'child is a fully expanded fragment (its own registered workflow)'),
    ).toBe(1);
  });

  it('mints a DETERMINISTIC, TENANT-SCOPED, version-pinned child id', () => {
    const { children } = expandChainTree(PARENT, ctx());
    const expected = mintChildWorkflowId('tenant-a', 'lesson-batch', '1.0.0');
    expect(children[0]?.childWorkflowId, why(SPEC, '§1.3 step 2 — deterministic (tenantId, childChainId, version) id')).toBe(
      expected,
    );
    // Re-instantiating in the same tenant converges on the same id.
    const again = expandChainTree(PARENT, ctx());
    expect(again.children[0]?.childWorkflowId, why(SPEC, 'repeat instantiation in-tenant converges')).toBe(expected);
  });

  it('scopes the child id per TENANT — two tenants NEVER collide on the global registry (isolation)', () => {
    const a = expandChainTree(PARENT, ctx('tenant-a')).children[0]?.childWorkflowId;
    const b = expandChainTree(PARENT, ctx('tenant-b')).children[0]?.childWorkflowId;
    expect(a, why(SPEC, 'tenant-a mints an id')).toBeTruthy();
    expect(
      a !== b,
      why(SPEC, '§1.3 SECURITY sub-chain-child-tenant-scoped — distinct tenants ⇒ distinct child ids, no cross-tenant collision'),
    ).toBe(true);
  });

  it('registers a child referenced twice exactly ONCE (dedup by deterministic id)', () => {
    const { children } = expandChainTree(PARENT, ctx());
    const ids = children.map((c) => c.childWorkflowId);
    expect(new Set(ids).size, why(SPEC, '§1.3 step 2 — a shared child registers once')).toBe(ids.length);
    expect(ids.length, why(SPEC, 'both build-0 + build-1 collapse to one child')).toBe(1);
  });

  it('rewrites config.subChainRef → the minted child config.workflowId', () => {
    const { parent } = expandChainTree(PARENT, ctx());
    const expected = mintChildWorkflowId('tenant-a', 'lesson-batch', '1.0.0');
    const dispatchNodes = parent.nodes.filter((n) => n.typeId === 'core.subWorkflow');
    expect(dispatchNodes.length, why(SPEC, 'both dispatch nodes present')).toBe(2);
    for (const n of dispatchNodes) {
      const config = n.config as Record<string, unknown>;
      expect(config['workflowId'], why(SPEC, '§1.3 step 3 — subChainRef rewritten to minted child id')).toBe(expected);
      expect(
        'subChainRef' in config,
        why(SPEC, '§1.3 step 3 — transient subChainRef key dropped from the runtime config'),
      ).toBe(false);
    }
  });

  it('preserves the child reference at runtime (concrete workflowId, unlike inline mode)', () => {
    const { parent, children } = expandChainTree(PARENT, ctx());
    const childId = children[0]?.childWorkflowId;
    const referenced = parent.nodes
      .filter((n) => n.typeId === 'core.subWorkflow')
      .map((n) => (n.config as Record<string, unknown>)['workflowId']);
    expect(referenced.every((id) => id === childId), why(SPEC, 'parent HOLDS the co-registered child at runtime')).toBe(
      true,
    );
  });
});
