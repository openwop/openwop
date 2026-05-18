/**
 * Workflow-chain pack expansion — live-host gate (RFC 0013 Phase 3).
 *
 * Capability-gated scenario. Skips when the host doesn't advertise
 * `capabilities.workflowChainPacks.supported: true`. Asserts the host's
 * vendor-prefixed expansion endpoint (`POST /v1/host/sample/workflow-
 * chain:expand` — vendor prefix per `host-extensions.md` §"Canonical
 * prefixes") returns expanded fragments equivalent to the spec-
 * authoritative `expandChain()` reference library.
 *
 * Why this exists: the four server-free chain scenarios
 * (manifest-validation, signature-verification, expansion,
 * unresolvable-typeid) cover the pure logic. This scenario proves a
 * reference host wraps the algorithm correctly — fetch + verify +
 * locate + expand — and emits the same wire shape any consumer
 * implementing the spec would. Without it, the RFC's "reference host
 * implements expansion" acceptance criterion cannot be verified
 * end-to-end against an actual deployment.
 *
 * Coverage:
 *   1. Discovery advertises the capability (precondition for the rest).
 *   2. Positive — 1-node chain expands; substituted config + rewritten
 *      id + propagated capabilities match the pure-library output for
 *      the same input.
 *   3. Positive — 2-node chain with edges expands; edge endpoints
 *      reference the rewritten ids.
 *   4. Negative — unknown packName → 404 `pack_not_found`.
 *   5. Negative — known pack, unknown chainId → 404 `chain_not_found`.
 *   6. Negative — malformed body (no chainId) → 422 `invalid_request`.
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics (normative)"
 * @see capabilities.md §workflowChainPacks
 * @see RFCS/0013-workflow-chain-packs.md (Phase 3)
 */

import { describe, it, expect } from 'vitest';

import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { behaviorGate } from '../lib/behavior-gate.js';

const PROFILE = 'workflowChainPacks';
const SAMPLE_PACK = 'vendor.openwop.workflow-chain-sample';
const CHAIN_1_NODE = 'vendor.openwop.workflow-chain-sample.summarize-text';
const CHAIN_2_NODE = 'vendor.openwop.workflow-chain-sample.fetch-and-summarize';
const EXPAND_PATH = '/v1/host/sample/workflow-chain:expand';

interface ChainCaps {
  supported?: boolean;
}

async function isExpansionAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps =
    (disco.json as { capabilities?: { workflowChainPacks?: ChainCaps } }).capabilities
      ?.workflowChainPacks ?? {};
  return caps.supported === true;
}

describe('workflow-chain-host-expansion: live host wraps expansion algorithm correctly', () => {
  it('host discovery advertises workflowChainPacks.supported when expansion is implemented', async () => {
    loadEnv();
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const disco = await driver.get('/.well-known/openwop');
    const caps = (disco.json as { capabilities?: { workflowChainPacks?: ChainCaps } }).capabilities
      ?.workflowChainPacks;
    expect(
      caps,
      driver.describe(
        'capabilities.md §workflowChainPacks',
        'host advertising the capability MUST set `supported: true` in the discovery block',
      ),
    ).toBeDefined();
    expect(caps?.supported).toBe(true);
  });

  it('positive — 1-node chain expansion via the host returns substituted config + rewritten id', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const res = await driver.post(EXPAND_PATH, {
      packName: SAMPLE_PACK,
      chainId: CHAIN_1_NODE,
      parameters: {
        sourceText: 'The quick brown fox jumps over the lazy dog.',
        targetLength: 'one-sentence',
        tone: 'casual',
      },
    });

    expect(res.status).toBe(200);
    const body = res.json as {
      expansionId: string;
      chainId: string;
      packName: string;
      packVersion: string;
      nodes: Array<{
        id: string;
        typeId: string;
        config?: { systemPrompt?: string };
        capabilities?: string[];
      }>;
      edges: Array<unknown>;
    };

    expect(body.chainId).toBe(CHAIN_1_NODE);
    expect(body.packName).toBe(SAMPLE_PACK);
    expect(body.packVersion).toBe('1.0.0');
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toHaveLength(0);
    expect(typeof body.expansionId).toBe('string');
    expect(body.expansionId.length).toBeGreaterThan(0);

    const node = body.nodes[0]!;
    // Step 6: id rewriting — chainId's dots become underscores +
    // expansionId suffix + original fragment id.
    expect(node.id).toMatch(
      /^vendor_openwop_workflow-chain-sample_summarize-text_[a-f0-9]+_summarize-call$/,
    );
    expect(node.typeId).toBe('core.ai.callPrompt');

    // Step 5: literal substitution.
    const sysPrompt = node.config?.systemPrompt ?? '';
    expect(sysPrompt).toContain('a one-sentence summary');
    expect(sysPrompt).toContain('a casual tone');
    expect(sysPrompt).toContain('The quick brown fox jumps over the lazy dog.');

    // Step 8: capability propagation.
    expect(node.capabilities).toEqual(['cacheable']);
  });

  it('positive — 2-node chain with edges expands with rewritten edge endpoints', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const res = await driver.post(EXPAND_PATH, {
      packName: SAMPLE_PACK,
      chainId: CHAIN_2_NODE,
      parameters: {
        url: 'https://example.com/article',
        targetLength: 'executive-summary',
      },
    });
    expect(res.status).toBe(200);

    const body = res.json as {
      expansionId: string;
      nodes: Array<{ id: string; typeId: string; capabilities?: string[] }>;
      edges: Array<{ from: string; to: string }>;
    };
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);

    // Both expanded nodes get the same prefix; the edge's `from`/`to`
    // refer to fragment node ids and so get rewritten with the same
    // prefix (port suffix preserved).
    const edge = body.edges[0]!;
    const prefix = `vendor_openwop_workflow-chain-sample_fetch-and-summarize_${body.expansionId}_`;
    expect(edge.from).toBe(`${prefix}fetch.body`);
    expect(edge.to).toBe(`${prefix}summarize.sourceText`);

    // side-effectful capability propagated to BOTH expanded nodes.
    for (const node of body.nodes) {
      expect(node.capabilities, `node ${node.id} inherits chain capability`).toEqual(['side-effectful']);
    }
  });

  it('negative — unknown pack returns 404 pack_not_found', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const res = await driver.post(EXPAND_PATH, {
      packName: 'vendor.acme.does-not-exist',
      chainId: 'whatever',
      parameters: {},
    });
    expect(res.status).toBe(404);
    expect((res.json as { error: string }).error).toBe('pack_not_found');
  });

  it('negative — known pack but unknown chainId returns 404 chain_not_found', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const res = await driver.post(EXPAND_PATH, {
      packName: SAMPLE_PACK,
      chainId: 'vendor.openwop.workflow-chain-sample.does-not-exist',
      parameters: {},
    });
    expect(res.status).toBe(404);
    expect((res.json as { error: string }).error).toBe('chain_not_found');
  });

  it('negative — malformed request body returns 422 invalid_request', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    // Missing chainId.
    const res = await driver.post(EXPAND_PATH, {
      packName: SAMPLE_PACK,
      parameters: {},
    });
    expect(res.status).toBe(422);
    expect((res.json as { error: string }).error).toBe('invalid_request');
  });
});
