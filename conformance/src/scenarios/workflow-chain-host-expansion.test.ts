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
import { expandChain, expandChainWithCompensation, type WorkflowChain, type WorkflowChainWithCompensation } from '../lib/workflow-chain-expansion.js';
import { capabilityFamily, discoveryFamilies } from '../lib/discovery-capabilities.js';
import { softSkip } from '../lib/soft-skip.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { req } from '../lib/requirement-ids.js';

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
// RFC 0157 fixtures (pack 1.1.0, suite 1.133.0): node declarations + irreversibleEffect, without / with a chain policy.
const CHAIN_COMP = 'vendor.openwop.workflow-chain-sample.reserve-and-notify';
const CHAIN_COMP_POLICY = 'vendor.openwop.workflow-chain-sample.reserve-and-notify-with-policy';

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
  const caps = (discoveryFamilies(disco.json) as { workflowChainPacks?: ChainCaps }).workflowChainPacks ?? {};
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
    const caps = (discoveryFamilies(disco.json) as { workflowChainPacks?: ChainCaps }).workflowChainPacks;
    expect(
      caps,
      req('openwop.it.workflow-chain-host-expansion.host-discovery-advertises-workflowchainpacks-hostexpansionseam-when-the-expand-s', 
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
      req('openwop.it.workflow-chain-host-expansion.host-discovery-advertises-workflowchainpacks-hostexpansionseam-when-the-expand-s', 
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
    // The host serves the fixture from ITS conformance pin; the fixture gained two
    // RFC 0157 chains at pack 1.1.0 (suite 1.133.0) without touching the two
    // chains these legs expand, so an older pin is a note, not a mismatch — the
    // expansions below still compare like for like. A NEWER pack than this suite
    // knows is a mismatch (the suite cannot vouch for chains it has not seen).
    expect(typeof body.packVersion).toBe('string');
    if (body.packVersion !== PACK.version) {
      const [hm, hn] = body.packVersion.split('.').map(Number);
      const [fm, fn] = PACK.version.split('.').map(Number);
      const older = hm! < fm! || (hm === fm && hn! < fn!);
      expect(older, req('openwop.it.workflow-chain-host-expansion.positive-1-node-chain-expansion-matches-the-reference-library-for-the-bundled-pa', 'workflow-chain-host-expansion', `host bundles workflow-chain-sample ${body.packVersion}; this suite's fixture is ${PACK.version} — a host pack NEWER than the suite is unaccounted for`)).toBe(true);
      softSkip('blocked', `host bundles workflow-chain-sample ${body.packVersion} (suite fixture ${PACK.version}) — the RFC 0157 chains are absent there until its conformance pin catches up`);
    }
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
      req('openwop.it.workflow-chain-host-expansion.positive-1-node-chain-expansion-matches-the-reference-library-for-the-bundled-pa', 'workflow-chain-packs.md §Expansion semantics', 'host rewrites the node id exactly as the reference library (chainId dots → underscores + expansionId prefix)'),
    ).toBe(ref.id);
    expect(node.typeId).toBe(ref.typeId);
    expect(
      node.config?.systemPrompt,
      req('openwop.it.workflow-chain-host-expansion.positive-1-node-chain-expansion-matches-the-reference-library-for-the-bundled-pa', 'workflow-chain-packs.md §Expansion semantics', 'host performs the same literal {{params.*}} substitution as the reference library'),
    ).toBe((ref.config as { systemPrompt?: string } | undefined)?.systemPrompt);
    expect(
      node.capabilities,
      req('openwop.it.workflow-chain-host-expansion.positive-1-node-chain-expansion-matches-the-reference-library-for-the-bundled-pa', 'workflow-chain-packs.md §Capability propagation', 'chain capabilities propagate to the expanded node'),
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
      req('openwop.it.workflow-chain-host-expansion.positive-2-node-chain-matches-the-reference-library-edge-rewrite-capability-prop', 'workflow-chain-packs.md §Expansion semantics', 'host rewrites fragment-internal edge endpoints (port suffix preserved) exactly as the reference library'),
    ).toEqual({ from: refEdge.from, to: refEdge.to });

    // side-effectful capability propagated to BOTH expanded nodes (per the ref).
    const refCaps = expected.nodes.map((n) => n.capabilities);
    expect(
      body.nodes.map((n) => n.capabilities),
      req('openwop.it.workflow-chain-host-expansion.positive-2-node-chain-matches-the-reference-library-edge-rewrite-capability-prop', 'workflow-chain-packs.md §Capability propagation', 'chain capability propagates uniformly to every expanded node'),
    ).toEqual(refCaps);
  });

  it('negative — unknown pack returns 404 pack_not_found', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const res = await driver.post(EXPAND_PATH, {
      packName: 'vendor.acme.does-not-exist',
      chainId: 'whatever',
      parameters: {},
    });
    expect(res.status, req('openwop.it.workflow-chain-host-expansion.negative-unknown-pack-returns-404-pack-not-found', 'RFC 0013', 'negative — unknown pack returns 404 pack_not_found')).toBe(404);
    expect((res.json as { error: string }).error).toBe('pack_not_found');
  });

  it('negative — known pack but unknown chainId returns 404 chain_not_found', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    const res = await driver.post(EXPAND_PATH, {
      packName: SAMPLE_PACK,
      chainId: 'vendor.openwop.workflow-chain-sample.does-not-exist',
      parameters: {},
    });
    expect(res.status, req('openwop.it.workflow-chain-host-expansion.negative-known-pack-but-unknown-chainid-returns-404-chain-not-found', 'RFC 0013', 'negative — known pack but unknown chainId returns 404 chain_not_found')).toBe(404);
    expect((res.json as { error: string }).error).toBe('chain_not_found');
  });

  it('negative — malformed request body returns 422 invalid_request', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;

    // Missing chainId.
    const res = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, parameters: {} });
    expect(res.status, req('openwop.it.workflow-chain-host-expansion.negative-malformed-request-body-returns-422-invalid-request', 'RFC 0013', 'negative — malformed request body returns 422 invalid_request')).toBe(422);
    expect((res.json as { error: string }).error).toBe('invalid_request');
  });
  it('RFC 0157 — a compensating chain expands through the live path with `compensation` and `irreversibleEffect` carried verbatim onto the expanded nodes', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;
    const parameters = { reservationUrl: 'https://example.com/reservations' };
    const res = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, chainId: CHAIN_COMP, parameters });
    if (res.status === 404 && readErrorCode(res.json) === 'chain_not_found') {
      // The host serves the bundled fixture from its PINNED conformance package;
      // the RFC 0157 chains arrived with pack 1.1.0 (suite 1.133.0). Older pin ⇒
      // the chain does not exist there yet — unobservable, not a failure.
      return softSkip('blocked', `host's bundled workflow-chain-sample pack predates 1.1.0 (chain ${CHAIN_COMP} answered chain_not_found) — the RFC 0157 carry is unobservable until the host's conformance pin reaches 1.133.0`);
    }
    expect(res.status, req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-compensating-chain-expands-through-the-live-path-with-compensation-an', 'workflow-chain-packs.md §"Compensation (RFC 0157)"', 'a chain whose nodes declare an inverse action / irreversibleEffect (no policy) is acceptable on ANY host — the declaration describes, only the policy requests an unwind')).toBe(200);
    const body = res.json as unknown as {
      expansionId: string;
      nodes: Array<{ id: string; compensation?: unknown; irreversibleEffect?: boolean }>;
    };
    const expected = expandChainWithCompensation(chainById(CHAIN_COMP) as unknown as WorkflowChainWithCompensation, {
      expansionId: body.expansionId,
      params: parameters,
      isTypeIdResolvable: () => true,
    });
    expect(body.nodes).toHaveLength(expected.nodes.length);
    for (const ref of expected.nodes) {
      const node = body.nodes.find((n) => n.id === ref.id);
      expect(node, req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-compensating-chain-expands-through-the-live-path-with-compensation-an', 'workflow-chain-packs.md §Expansion semantics', `expanded node ${ref.id} present`)).toBeDefined();
      const refC = (ref as unknown as { compensation?: unknown }).compensation;
      expect(
        node?.compensation,
        req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-compensating-chain-expands-through-the-live-path-with-compensation-an', 'workflow-chain-packs.md §"Compensation (RFC 0157)" rules 5b/6b', `node ${ref.id}: the inverse-action declaration MUST survive expansion verbatim (params substituted, node-id refs re-prefixed) — a node-rebuilding allowlist that drops it silently loses the unwind`),
      ).toEqual(refC);
      expect(
        node?.irreversibleEffect,
        req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-compensating-chain-expands-through-the-live-path-with-compensation-an', 'workflow-chain-packs.md §"Compensation (RFC 0157)" rule 6c', `node ${ref.id}: irreversibleEffect MUST be copied unchanged`),
      ).toEqual((ref as unknown as { irreversibleEffect?: boolean }).irreversibleEffect);
    }
    // Non-vacuity: the fixture DOES declare both, so at least one node of each kind was compared.
    expect(expected.nodes.some((n) => (n as unknown as { compensation?: unknown }).compensation !== undefined)).toBe(true);
    expect(expected.nodes.some((n) => (n as unknown as { irreversibleEffect?: boolean }).irreversibleEffect === true)).toBe(true);
  });

  it('RFC 0157 — a chain carrying an unwind POLICY is refused with capability_required on a host that does not advertise compensation, and expands on one that does', async () => {
    if (!behaviorGate(PROFILE, await isExpansionAdvertised())) return;
    const disco = await driver.get('/.well-known/openwop');
    const advertises = capabilityFamily<{ supported?: boolean }>(disco.json, 'compensation')?.supported === true;
    const parameters = { reservationUrl: 'https://example.com/reservations' };
    const res = await driver.post(EXPAND_PATH, { packName: SAMPLE_PACK, chainId: CHAIN_COMP_POLICY, parameters });
    if (res.status === 404 && readErrorCode(res.json) === 'chain_not_found') {
      return softSkip('blocked', `host's bundled workflow-chain-sample pack predates 1.1.0 (chain ${CHAIN_COMP_POLICY} answered chain_not_found) — unobservable until the host's conformance pin reaches 1.133.0`);
    }
    if (!advertises) {
      // compensation.md §"Workflow policy": a host that does NOT advertise the family
      // MUST refuse a chain carrying a policy rather than accept a promise it will
      // never honour. Accepting silently is the advertise-and-opt-out failure with
      // the sign flipped.
      expect(res.status >= 400, req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-chain-carrying-an-unwind-policy-is-refused-with-capability-required-o', 'compensation.md §"Workflow policy"', 'a non-advertising host MUST refuse a chain carrying `compensation` (policy) — 4xx, not 200')).toBe(true);
      expect(readErrorCode(res.json), req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-chain-carrying-an-unwind-policy-is-refused-with-capability-required-o', 'capabilities.md §"Unsupported capability — refusal contract"', '`capability_required`')).toBe('capability_required');
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!advertises` returned early');
    }
    expect(res.status, req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-chain-carrying-an-unwind-policy-is-refused-with-capability-required-o', 'workflow-chain-packs.md §"Compensation (RFC 0157)"', 'an advertising host expands the policy-carrying chain')).toBe(200);
    const body = res.json as unknown as { expansionId: string; nodes: unknown[]; settings?: { compensation?: unknown } };
    const expected = expandChainWithCompensation(chainById(CHAIN_COMP_POLICY) as unknown as WorkflowChainWithCompensation, {
      expansionId: body.expansionId,
      params: parameters,
      isTypeIdResolvable: () => true,
    });
    expect(body.nodes).toHaveLength(expected.nodes.length);
    // The policy's destination is the registered definition's settings.compensation
    // (rule 9b). This seam returns the expanded fragment; whether it echoes
    // `settings` is host-optional, so the policy carry is asserted when visible
    // and noted when not — never assumed.
    if (body.settings?.compensation !== undefined) {
      expect(body.settings.compensation, req('openwop.it.workflow-chain-host-expansion.rfc-0157-a-chain-carrying-an-unwind-policy-is-refused-with-capability-required-o', 'workflow-chain-packs.md §"Compensation (RFC 0157)" rule 9b', 'the chain policy becomes settings.compensation, copied verbatim')).toEqual(expected.settingsCompensation);
    } else {
      softSkip('blocked', 'the expand seam does not echo `settings`, so the policy → settings.compensation carry (rule 9b) is unobservable through it; the node carry above was witnessed');
    }
  });
});
