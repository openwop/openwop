/**
 * Workflow-chain expansion semantics — `workflow-chain-packs.md` §"Expansion semantics (normative)"
 * + reference impl at `conformance/src/lib/workflow-chain-expansion.ts` (closes RFC 0013 Phase 3).
 *
 * Server-free scenario. Exercises the 9-step expansion algorithm
 * through the reference library. Asserts:
 *
 *   - Step 5: `{{params.<name>}}` placeholders substitute literally,
 *     recursively into nested string fields of `config` / `inputs`.
 *   - Step 6: node id rewriting — same chainId expanded TWICE in one
 *     parent workflow MUST produce non-colliding ids (the load-bearing
 *     property — without it, multi-expansion DAGs would have id
 *     duplicates that violate workflow-definition.schema.json).
 *   - Step 8: capability propagation — chain-level `capabilities[]`
 *     copy into every expanded node's `capabilities[]` so existing
 *     side-effect / streamable gates apply uniformly post-expansion.
 *   - Edge rewriting — `from`/`to` endpoints that reference fragment
 *     nodes get the chain prefix; refs to nodes OUTSIDE the fragment
 *     pass through unchanged so the parent workflow's adjacent wiring
 *     stays intact.
 *   - Output shape — the expanded fragment contains ONLY concrete
 *     typeIds (no chain reference survives to runtime).
 *
 * Capability-gated (logical sense): a host that ships chain expansion
 * advertises `capabilities.workflowChainPacks.supported: true`. This
 * scenario runs unconditionally because the reference library is
 * black-box logic — the spec is the spec regardless of host adoption.
 * Host-side end-to-end expansion gates on the capability flag.
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics (normative)"
 * @see conformance/src/lib/workflow-chain-expansion.ts
 * @see RFCS/0013-workflow-chain-packs.md
 */

import { describe, it, expect } from 'vitest';
import { expandChain, type WorkflowChain } from '../lib/workflow-chain-expansion.js';

/** Index helper that narrows away the `T | undefined` from `noUncheckedIndexedAccess`
 *  with an actionable error message — replaces `arr[i]!` non-null assertions so a
 *  shape mismatch surfaces as a real diagnostic instead of a TypeError-on-property-access. */
function at<T>(arr: ReadonlyArray<T>, i: number, label: string): T {
  const value = arr[i];
  if (value === undefined) {
    throw new Error(`${label}[${i}] expected to be defined (length=${arr.length})`);
  }
  return value;
}

/** Canonical sample chain used across multiple cases — mirrors the
 *  spec doc's "Positive: 1-node chain" example, kept tight so each
 *  assertion is focused on one rule. */
const SAMPLE_CHAIN: WorkflowChain = {
  chainId: 'vendor.acme.generatePRD',
  version: '1.0.0',
  label: 'Generate PRD',
  description: 'Single-node AI call.',
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
        name: 'Generate PRD',
        config: {
          systemPrompt: 'Write a PRD for: {{params.productIdea}}\nAudience: {{params.targetAudience}}',
          envelopeType: 'prd.create',
          provider: 'anthropic',
        },
      },
    ],
    edges: [],
  },
};

/** Resolver helper — accepts every typeId. Used when typeId resolution
 *  isn't the property under test. The unresolvable-typeid scenario lives
 *  in its own file. */
const RESOLVE_ALL = (_typeId: string): boolean => true;

describe('category: workflow-chain expansion — placeholder substitution', () => {
  it('substitutes {{params.x}} placeholders literally in config strings', () => {
    const fragment = expandChain(SAMPLE_CHAIN, {
      expansionId: 'a8f3',
      params: { productIdea: 'AI-powered toaster', targetAudience: 'restaurant chains' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(fragment.nodes).toHaveLength(1);
    const config = at(fragment.nodes, 0, 'fragment.nodes').config as { systemPrompt: string };
    expect(
      config.systemPrompt,
      'Per workflow-chain-packs.md §"Parameter substitution": placeholders MUST be substituted literally at expansion time.',
    ).toBe('Write a PRD for: AI-powered toaster\nAudience: restaurant chains');
  });

  it('recurses into nested object structures in config', () => {
    const chain: WorkflowChain = {
      ...SAMPLE_CHAIN,
      dag: {
        nodes: [
          {
            id: 'n',
            typeId: 'core.identity',
            config: {
              outer: {
                middle: {
                  message: 'Hello {{params.who}}',
                  tags: ['static', '{{params.who}}-tag'],
                },
              },
            },
          },
        ],
        edges: [],
      },
    };
    const fragment = expandChain(chain, {
      expansionId: 'x1',
      params: { who: 'world' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    const config = at(fragment.nodes, 0, 'fragment.nodes').config as {
      outer: { middle: { message: string; tags: string[] } };
    };
    expect(
      config.outer.middle.message,
      'Recursive substitution MUST walk into nested objects (per spec §Parameter substitution: "Substitution MUST recurse into nested string values within `config` and `inputs`").',
    ).toBe('Hello world');
    expect(
      config.outer.middle.tags,
      'Recursive substitution MUST also walk into array elements when those elements are strings.',
    ).toEqual(['static', 'world-tag']);
  });

  it('leaves non-placeholder strings untouched', () => {
    const fragment = expandChain(
      {
        ...SAMPLE_CHAIN,
        dag: {
          nodes: [
            {
              id: 'n',
              typeId: 'core.identity',
              config: { literal: 'no placeholders here', empty: '' },
            },
          ],
          edges: [],
        },
      },
      { expansionId: 'x', params: {}, isTypeIdResolvable: RESOLVE_ALL },
    );
    const config = at(fragment.nodes, 0, 'fragment.nodes').config as { literal: string; empty: string };
    expect(config.literal).toBe('no placeholders here');
    expect(config.empty).toBe('');
  });

  it('substitutes the same placeholder name in multiple positions', () => {
    const fragment = expandChain(
      {
        ...SAMPLE_CHAIN,
        dag: {
          nodes: [
            {
              id: 'n',
              typeId: 'core.identity',
              config: { a: '{{params.who}}', b: '{{params.who}}', joined: 'hi {{params.who}}, hi again {{params.who}}' },
            },
          ],
          edges: [],
        },
      },
      { expansionId: 'x', params: { who: 'Ada' }, isTypeIdResolvable: RESOLVE_ALL },
    );
    const config = at(fragment.nodes, 0, 'fragment.nodes').config as { a: string; b: string; joined: string };
    expect(config.a).toBe('Ada');
    expect(config.b).toBe('Ada');
    expect(config.joined).toBe('hi Ada, hi again Ada');
  });
});

describe('category: workflow-chain expansion — whole-value typed resolution', () => {
  it('resolves a whole-value {{params.x}} token to the RAW typed value (object/array/number/boolean)', () => {
    const chain: WorkflowChain = {
      ...SAMPLE_CHAIN,
      parameters: {
        type: 'object',
        properties: {
          retryPolicy: { type: 'object' },
          allowlist: { type: 'array' },
          maxTokens: { type: 'number' },
          streaming: { type: 'boolean' },
        },
      },
      dag: {
        nodes: [
          {
            id: 'n',
            typeId: 'core.identity',
            config: {
              retryPolicy: '{{params.retryPolicy}}',
              allowlist: '{{params.allowlist}}',
              maxTokens: '{{params.maxTokens}}',
              streaming: '{{params.streaming}}',
            },
          },
        ],
        edges: [],
      },
    };
    const fragment = expandChain(chain, {
      expansionId: 'wv1',
      params: {
        retryPolicy: { attempts: 3, backoff: 'exponential' },
        allowlist: ['a', 'b'],
        maxTokens: 4096,
        streaming: true,
      },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    const config = at(fragment.nodes, 0, 'fragment.nodes').config as {
      retryPolicy: unknown;
      allowlist: unknown;
      maxTokens: unknown;
      streaming: unknown;
    };
    expect(
      config.retryPolicy,
      'Per workflow-chain-packs.md §"Parameter substitution": a value that is EXACTLY one `{{params.x}}` token MUST resolve to the raw typed value — an object param MUST NOT be stringified to "[object Object]".',
    ).toEqual({ attempts: 3, backoff: 'exponential' });
    expect(config.allowlist).toEqual(['a', 'b']);
    expect(config.maxTokens).toBe(4096);
    expect(config.streaming).toBe(true);
  });

  it('does literal string coercion for an EMBEDDED token in surrounding text', () => {
    const chain: WorkflowChain = {
      ...SAMPLE_CHAIN,
      parameters: { type: 'object', properties: { count: { type: 'number' } } },
      dag: {
        nodes: [{ id: 'n', typeId: 'core.identity', config: { label: 'items: {{params.count}}' } }],
        edges: [],
      },
    };
    const fragment = expandChain(chain, {
      expansionId: 'wv2',
      params: { count: 42 },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    const config = at(fragment.nodes, 0, 'fragment.nodes').config as { label: string };
    expect(
      config.label,
      'A token embedded in surrounding text MUST do literal string substitution (the numeric param coerces to its string form).',
    ).toBe('items: 42');
  });
});

describe('category: workflow-chain expansion — inputs preservation', () => {
  it('preserves a present node.inputs (PortValue references) through expansion', () => {
    const chain: WorkflowChain = {
      ...SAMPLE_CHAIN,
      dag: {
        nodes: [
          {
            id: 'n',
            typeId: 'core.identity',
            config: {},
            inputs: {
              prompt: { sourceNodeId: 'upstream', sourcePort: 'text' },
              seed: '{{params.seed}}',
            },
          },
        ],
        edges: [],
      },
    };
    const fragment = expandChain(chain, {
      expansionId: 'ip1',
      params: { seed: 'xyz' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    const inputs = at(fragment.nodes, 0, 'fragment.nodes').inputs as {
      prompt: unknown;
      seed: unknown;
    };
    expect(
      inputs.prompt,
      'Per workflow-chain-packs.md §"Parameter substitution": expansion MUST preserve a present `node.inputs` (PortValue references) verbatim — only `{{params.*}}` tokens inside its string leaves are substituted.',
    ).toEqual({ sourceNodeId: 'upstream', sourcePort: 'text' });
    expect(inputs.seed).toBe('xyz');
  });
});

describe('category: workflow-chain expansion — node id collision avoidance', () => {
  it('same chain expanded TWICE in one parent workflow produces non-colliding node ids', () => {
    const first = expandChain(SAMPLE_CHAIN, {
      expansionId: 'a8f3',
      params: { productIdea: 'first', targetAudience: '' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    const second = expandChain(SAMPLE_CHAIN, {
      expansionId: 'b9e4',
      params: { productIdea: 'second', targetAudience: '' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(
      at(first.nodes, 0, 'first.nodes').id,
      'Per spec §"Expansion semantics" step 6: each expansion MUST use a unique `expansionId` prefix so multi-expansion DAGs do not collide.',
    ).not.toBe(at(second.nodes, 0, 'second.nodes').id);
    expect(at(first.nodes, 0, 'first.nodes').id).toBe('vendor_acme_generatePRD_a8f3_prd-call');
    expect(at(second.nodes, 0, 'second.nodes').id).toBe('vendor_acme_generatePRD_b9e4_prd-call');
  });

  it('rewritten ids replace dots in chainId with underscores for storage-key safety', () => {
    const fragment = expandChain(SAMPLE_CHAIN, {
      expansionId: 'x',
      params: { productIdea: 'p', targetAudience: '' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(
      at(fragment.nodes, 0, 'fragment.nodes').id,
      'chainId `vendor.acme.generatePRD` MUST be slugged (dots → underscores) so the resulting id is safe to use in storage backends that reserve `.` for hierarchical keys.',
    ).toMatch(/^vendor_acme_generatePRD_/);
    expect(at(fragment.nodes, 0, 'fragment.nodes').id).not.toMatch(/\./);
  });

  it('exposes idMap so the caller can wire parent-workflow edges into the expansion', () => {
    const fragment = expandChain(SAMPLE_CHAIN, {
      expansionId: 'a8f3',
      params: { productIdea: 'p', targetAudience: '' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(
      fragment.idMap.get('prd-call'),
      'The expansion contract MUST surface the original-id → rewritten-id map so the caller can route adjacent parent-workflow edges to the right expanded node.',
    ).toBe('vendor_acme_generatePRD_a8f3_prd-call');
  });
});

describe('category: workflow-chain expansion — edge rewriting', () => {
  const MULTI_NODE: WorkflowChain = {
    chainId: 'vendor.acme.twoStep',
    version: '1.0.0',
    label: 'Two-step',
    description: 'Two nodes connected by an edge.',
    parameters: {},
    dag: {
      nodes: [
        { id: 'first', typeId: 'core.identity', config: {} },
        { id: 'second', typeId: 'core.identity', config: {} },
      ],
      edges: [{ from: 'first', to: 'second' }],
    },
  };

  it('rewrites `from` and `to` ids that reference fragment nodes', () => {
    const fragment = expandChain(MULTI_NODE, {
      expansionId: 'e1',
      params: {},
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(fragment.edges).toHaveLength(1);
    expect(
      at(fragment.edges, 0, 'fragment.edges').from,
      'Edge `from` ids that match fragment node ids MUST be rewritten with the same prefix as the nodes themselves.',
    ).toBe('vendor_acme_twoStep_e1_first');
    expect(at(fragment.edges, 0, 'fragment.edges').to).toBe('vendor_acme_twoStep_e1_second');
  });

  it('preserves port-name suffix (`nodeId.portName`) when rewriting edge refs', () => {
    const withPorts: WorkflowChain = {
      ...MULTI_NODE,
      dag: {
        ...MULTI_NODE.dag,
        edges: [{ from: 'first.out', to: 'second.in' }],
      },
    };
    const fragment = expandChain(withPorts, {
      expansionId: 'e2',
      params: {},
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(
      at(fragment.edges, 0, 'fragment.edges').from,
      'Port-name suffix (after the `.`) MUST be preserved verbatim during id rewriting.',
    ).toBe('vendor_acme_twoStep_e2_first.out');
    expect(at(fragment.edges, 0, 'fragment.edges').to).toBe('vendor_acme_twoStep_e2_second.in');
  });

  it('leaves edge refs alone when they don\'t match a fragment node id', () => {
    // Refs to OUTSIDE the fragment let the parent-workflow host splice
    // in adjacent wiring. Critical for the "this chain plugs into
    // node-X-of-parent-workflow" use case.
    const withExternalRefs: WorkflowChain = {
      ...MULTI_NODE,
      dag: {
        ...MULTI_NODE.dag,
        edges: [
          { from: 'parent-upstream', to: 'first' },
          { from: 'second', to: 'parent-downstream' },
        ],
      },
    };
    const fragment = expandChain(withExternalRefs, {
      expansionId: 'e3',
      params: {},
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(
      at(fragment.edges, 0, 'fragment.edges').from,
      'Edge refs to nodes OUTSIDE the fragment MUST pass through unchanged so the parent host can wire adjacent edges post-splice.',
    ).toBe('parent-upstream');
    expect(at(fragment.edges, 0, 'fragment.edges').to).toBe('vendor_acme_twoStep_e3_first');
    expect(at(fragment.edges, 1, 'fragment.edges').from).toBe('vendor_acme_twoStep_e3_second');
    expect(at(fragment.edges, 1, 'fragment.edges').to).toBe('parent-downstream');
  });
});

describe('category: workflow-chain expansion — capability propagation', () => {
  it('copies chain.capabilities[] into every expanded node\'s capabilities[]', () => {
    const chainWithCaps: WorkflowChain = {
      ...SAMPLE_CHAIN,
      capabilities: ['side-effectful', 'cacheable'],
      dag: {
        nodes: [
          { id: 'n1', typeId: 'core.identity', config: {} },
          { id: 'n2', typeId: 'core.identity', config: {} },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      },
    };
    const fragment = expandChain(chainWithCaps, {
      expansionId: 'c1',
      params: {},
      isTypeIdResolvable: RESOLVE_ALL,
    });
    for (const node of fragment.nodes) {
      expect(
        node.capabilities,
        'Per spec §"Expansion semantics" step 8: chain-level `capabilities[]` MUST be copied to every expanded node so existing capability gates (side-effect, streamable) apply uniformly.',
      ).toEqual(['side-effectful', 'cacheable']);
    }
  });

  it('omits capabilities[] on expanded nodes when the chain declares none', () => {
    const fragment = expandChain(SAMPLE_CHAIN, {
      expansionId: 'c2',
      params: { productIdea: 'p', targetAudience: '' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    expect(
      at(fragment.nodes, 0, 'fragment.nodes').capabilities,
      'When the chain declares no `capabilities[]`, expanded nodes MUST NOT carry an empty array (preserves wire-shape minimality).',
    ).toBeUndefined();
  });
});

describe('category: workflow-chain expansion — runtime-invariance contract', () => {
  it('expanded fragment carries ONLY concrete typeIds (no chain reference survives)', () => {
    const fragment = expandChain(SAMPLE_CHAIN, {
      expansionId: 'r1',
      params: { productIdea: 'p', targetAudience: '' },
      isTypeIdResolvable: RESOLVE_ALL,
    });
    for (const node of fragment.nodes) {
      expect(
        node.typeId,
        'Per workflow-chain-packs.md §"What hosts dispatch": dispatching runtimes see only concrete `core.*`/published-vendor typeIds — the chain reference MUST NOT be preserved at runtime.',
      ).not.toMatch(/^vendor\.acme\.generatePRD$/);
      expect(node.typeId).toBe('core.ai.callPrompt');
    }
  });
});
