/**
 * Workflow-chain pack expansion — live-host gate (RFC 0013 Phase 3).
 *
 * Capability-gated scenario. **RFC 0013 erratum (2026-07-05):** gates on the
 * OPTIONAL test-seam sub-flag `capabilities.workflowChainPacks.hostExpansionSeam:
 * true` — NOT on the semantic `workflowChainPacks.supported` claim, which is
 * witnessed server-free by `workflow-chain-expansion.test.ts`. This decouples a
 * host's honest `supported` / RFC 0124 `deferredParameters` advertisement from
 * this scenario's `vendor.openwop.workflow-chain-sample` fixture.
 *
 * **A-lite follow-up (2026-07-05):** the `vendor.openwop.workflow-chain-sample`
 * pack is now **bundled into the conformance package** at
 * `fixtures/pack-manifests/workflow-chain-sample.pack.json` (host-syncable), and
 * this scenario **LOADS it + derives the expected expansion from the
 * spec-authoritative reference library** (`expandChain()`) instead of hardcoding
 * expected strings — so the published pack is the single source of truth and the
 * assertions can't drift from it. A serving host resolves the SAME bundled pack
 * and MUST produce the SAME expansion the reference library computes.
 *
 * Asserts the host's vendor-prefixed expansion endpoint (`POST /v1/host/sample/
 * workflow-chain:expand` — vendor prefix per `host-extensions.md` §"Canonical
 * prefixes") returns expanded fragments equivalent to `expandChain()` for the
 * same pack + parameters + host-chosen `expansionId`.
 *
 * Coverage:
 *   1. Discovery advertises `hostExpansionSeam` (precondition for the rest).
 *   2. Positive — 1-node chain expands; host output == reference expansion
 *      (substituted config + rewritten id + propagated `cacheable`).
 *   3. Positive — 2-node chain with edges expands; host output == reference
 *      expansion (rewritten edge endpoints + propagated `side-effectful`).
 *   4. Negative — unknown packName → 404 `pack_not_found`.
 *   5. Negative — known pack, unknown chainId → 404 `chain_not_found`.
 *   6. Negative — malformed body (no chainId) → 422 `invalid_request`.
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics (normative)"
 * @see conformance/src/lib/workflow-chain-expansion.ts (the reference library)
 * @see RFCS/0013-workflow-chain-packs.md (Phase 3)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { FIXTURES_DIR } from '../lib/paths.js';
import { expandChain, type WorkflowChain } from '../lib/workflow-chain-expansion.js';

const PROFILE = 'workflowChainPacks.hostExpansionSeam';
const EXPAND_PATH = '/v1/host/sample/workflow-chain:expand';

// The pack fixture is bundled with the conformance package (ships in `files`),
// so a host can sync the IDENTICAL pack and this scenario loads it as the
// contract source of truth (no hardcoded expansion).
interface SamplePack {
  name: string;
  version: string;
  chains: Array<WorkflowChain>;
}
const PACK = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'pack-manifests', 'workflow-chain-sample.pack.json'), 'utf8'),
) as SamplePack;
const SAMPLE_PACK = PACK.name; // vendor.openwop.workflow-chain-sample
const CHAIN_1_NODE = 'vendor.openwop.workflow-chain-sample.summarize-text';
const CHAIN_2_NODE = 'vendor.openwop.workflow-chain-sample.fetch-and-summarize';

function chainById(chainId: string): WorkflowChain {
  const c = PACK.chains.find((x) => x.chainId === chainId);
  if (!c) throw new Error(`fixture missing chain ${chainId}`);
  return c;
}

interface ChainCaps {
  supported?: boolean;
  hostExpansionSeam?: boolean;
}

async function isExpansionAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps =
    (disco.json as { capabilities?: { workflowChainPacks?: ChainCaps } }).capabilities
      ?.workflowChainPacks ?? {};
  return caps.hostExpansionSeam === true;
}

interface ExpandResponse {
  expansionId: string;
  chainId: string;
  packName: string;
  packVersion: string;
  nodes: Array<{ id: string; typeId: string; config?: Record<string, unknown>; capabilities?: string[] }>;
  edges: Array<{ from: string; to: string }>;
}

describe('workflow-chain-host-expansion: live host wraps expansion algorithm correctly', () => {
  it('host discovery advertises workflowChainPacks.hostExpansionSeam when the expand seam is served', async () => {
    loadEnv();
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const disco = await driver.get('/.well-known/openwop');
    const caps = (disco.json as { capabilities?: { workflowChainPacks?: ChainCaps } }).capabilities
      ?.workflowChainPacks;
    expect(
      caps,
      driver.describe(
        'capabilities.md §workflowChainPacks',
        'a host serving the RFC 0013 host-expansion test seam MUST set `hostExpansionSeam: true` (and, being a chain-pack consumer, `supported: true`) in the discovery block',
      ),
    ).toBeDefined();
    expect(caps?.supported).toBe(true);

    // `hostExpansionSeam === true` is NOT asserted here, deliberately: this leg
    // only runs when `isExpansionAdvertised()` already read it as true, so
    // asserting it again is a tautology that can never fail. It looked like a
    // check and was a restatement — the same shape as a golden-vector gate
    // comparing two stored constants.
    //
    // What this leg's NAME promises is that the seam is *served*, so that is
    // what it now verifies. A host advertising the flag while the route 404s
    // has made its discovery document false, and a consumer that read it
    // planned against a capability that is not there.
    //
    // Found by a tier-1 host running the suite against its release IMAGE: the
    // seam resolved its fixture manifest through `require.resolve` on a
    // devDependency at request time, which succeeds in a source tree and fails
    // under `npm ci --omit=dev`. Advertised, 404ing, **and this leg passed** —
    // the defect surfaced three legs later as a confusing expansion mismatch
    // rather than here, where the name says it belongs.
    const probe = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, chainId: CHAIN_1_NODE, parameters: {} });
    expect(
      probe.status,
      driver.describe(
        'capabilities.md §workflowChainPacks',
        `a host advertising \`hostExpansionSeam: true\` MUST serve ${EXPAND_PATH}. Got ${probe.status} — ` +
          'the discovery document promises a seam the host does not route. Advertising a capability ' +
          'that 404s is worse than advertising nothing: a consumer that read the flag made a plan ' +
          'on a fact that was not true.',
      ),
    ).not.toBe(404);
  });

  it('positive — 1-node chain expansion matches the reference library for the bundled pack', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const parameters = {
      sourceText: 'The quick brown fox jumps over the lazy dog.',
      targetLength: 'one-sentence',
      tone: 'casual',
    };
    const res = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, chainId: CHAIN_1_NODE, parameters });
    expect(res.status).toBe(200);
    const body = res.json as ExpandResponse;

    expect(body.chainId).toBe(CHAIN_1_NODE);
    expect(body.packName).toBe(SAMPLE_PACK);
    expect(body.packVersion).toBe(PACK.version);
    expect(typeof body.expansionId).toBe('string');
    expect(body.expansionId.length).toBeGreaterThan(0);

    // Derive the expected fragment from the reference library using the HOST's
    // own expansionId — the host MUST reproduce the same algorithm output.
    const expected = expandChain(chainById(CHAIN_1_NODE), {
      expansionId: body.expansionId,
      params: parameters,
      isTypeIdResolvable: () => true,
    });

    expect(body.nodes).toHaveLength(expected.nodes.length);
    expect(body.edges).toHaveLength(expected.edges.length);

    const node = body.nodes[0]!;
    const ref = expected.nodes[0]!;
    expect(
      node.id,
      driver.describe('workflow-chain-packs.md §Expansion semantics', 'host rewrites the node id exactly as the reference library (chainId dots → underscores + expansionId prefix)'),
    ).toBe(ref.id);
    expect(node.typeId).toBe(ref.typeId);
    expect(
      node.config?.systemPrompt,
      driver.describe('workflow-chain-packs.md §Expansion semantics', 'host performs the same literal {{params.*}} substitution as the reference library'),
    ).toBe((ref.config as { systemPrompt?: string } | undefined)?.systemPrompt);
    expect(
      node.capabilities,
      driver.describe('workflow-chain-packs.md §Capability propagation', 'chain capabilities propagate to the expanded node'),
    ).toEqual(ref.capabilities);
  });

  it('positive — 2-node chain matches the reference library (edge rewrite + capability propagation)', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const parameters = { url: 'https://example.com/article', targetLength: 'executive-summary' };
    const res = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, chainId: CHAIN_2_NODE, parameters });
    expect(res.status).toBe(200);
    const body = res.json as ExpandResponse;

    const expected = expandChain(chainById(CHAIN_2_NODE), {
      expansionId: body.expansionId,
      params: parameters,
      isTypeIdResolvable: () => true,
    });

    expect(body.nodes).toHaveLength(expected.nodes.length); // 2
    expect(body.edges).toHaveLength(expected.edges.length); // 1

    const edge = body.edges[0]!;
    const refEdge = expected.edges[0]!;
    expect(
      { from: edge.from, to: edge.to },
      driver.describe('workflow-chain-packs.md §Expansion semantics', 'host rewrites fragment-internal edge endpoints (port suffix preserved) exactly as the reference library'),
    ).toEqual({ from: refEdge.from, to: refEdge.to });

    // side-effectful capability propagated to BOTH expanded nodes (per the ref).
    const refCaps = expected.nodes.map((n) => n.capabilities);
    expect(
      body.nodes.map((n) => n.capabilities),
      driver.describe('workflow-chain-packs.md §Capability propagation', 'chain capability propagates uniformly to every expanded node'),
    ).toEqual(refCaps);
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
    const res = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, parameters: {} });
    expect(res.status).toBe(422);
    expect((res.json as { error: string }).error).toBe('invalid_request');
  });
});
