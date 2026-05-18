/**
 * In-memory host workflow-chain expansion — RFC 0013 Phase 3.
 *
 * Pure-function test (no HTTP server boots). The host's expansion
 * wrapper is a single async function the HTTP handler calls; surfacing
 * the algorithm independently of the server makes mechanical proof
 * straightforward — the HTTP layer is just JSON parsing + status
 * mapping.
 *
 * Cases:
 *   1. Positive — load the in-tree sample pack, expand the 1-node
 *      chain, assert substituted+rewritten output.
 *   2. Positive — same pack, the 2-node chain with edges, assert
 *      edge rewriting + capability propagation.
 *   3. Negative — unknown pack → `pack_not_found`.
 *   4. Negative — pack exists but chain id doesn't → `chain_not_found`.
 *   5. Negative — pack found but `kind !== 'workflow-chain'` →
 *      `pack_kind_invalid`.
 *
 * Signature verification + tampered-manifest paths are already covered
 * by the server-free conformance scenario
 * `workflow-chain-pack-signature-verification.test.ts`; the sample
 * pack is unsigned (sample-host concession documented inline in the
 * host module) so this test exercises the unsigned-trust path.
 *
 * @see examples/hosts/in-memory/src/workflow-chain-expansion.ts
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics (normative)"
 * @see RFCS/0013-workflow-chain-packs.md
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  expandChainFromRegistry,
  WorkflowChainExpansionError,
} from '../src/workflow-chain-expansion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SAMPLE_REGISTRY = join(REPO_ROOT, 'examples', 'packs');
const SAMPLE_PACK_NAME = 'vendor.openwop.workflow-chain-sample';

async function expectThrow(
  fn: () => Promise<unknown>,
  code: string,
  hint: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(
      err instanceof WorkflowChainExpansionError,
      `${hint}: expected WorkflowChainExpansionError, got ${err instanceof Error ? err.constructor.name : typeof err}`,
    );
    assert.equal(err.code, code, `${hint}: expected code='${code}', got '${err.code}'`);
    return;
  }
  assert.fail(`${hint}: expected throw with code='${code}', got no error`);
}

// ─── Case 1: positive, 1-node chain ────────────────────────────────────

{
  const result = await expandChainFromRegistry({
    registryDir: SAMPLE_REGISTRY,
    packName: SAMPLE_PACK_NAME,
    chainId: 'vendor.openwop.workflow-chain-sample.summarize-text',
    parameters: {
      sourceText: 'The quick brown fox jumps over the lazy dog.',
      targetLength: 'one-sentence',
      tone: 'casual',
    },
    expansionId: 'abcd',
  });

  assert.equal(result.packName, SAMPLE_PACK_NAME);
  assert.equal(result.packVersion, '1.0.0');
  assert.equal(result.chainId, 'vendor.openwop.workflow-chain-sample.summarize-text');
  assert.equal(result.expansionId, 'abcd');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.edges.length, 0);

  const node = result.nodes[0]!;
  // Step 6: id rewriting — chainId's dots replaced with underscores +
  // expansion suffix.
  assert.equal(
    node.id,
    'vendor_openwop_workflow-chain-sample_summarize-text_abcd_summarize-call',
  );
  assert.equal(node.typeId, 'core.ai.callPrompt');
  // Step 5: literal substitution of {{params.<name>}}.
  const sysPrompt = (node.config as { systemPrompt: string }).systemPrompt;
  assert.ok(
    sysPrompt.includes('a one-sentence summary'),
    `targetLength substitution: ${sysPrompt}`,
  );
  assert.ok(
    sysPrompt.includes('a casual tone'),
    `tone substitution: ${sysPrompt}`,
  );
  assert.ok(
    sysPrompt.includes('The quick brown fox jumps over the lazy dog.'),
    `sourceText substitution: ${sysPrompt}`,
  );
  // Step 8: capability propagation.
  assert.deepEqual(node.capabilities, ['cacheable']);
  console.log('✓ case 1 — 1-node chain expansion');
}

// ─── Case 2: positive, 2-node chain with edges ─────────────────────────

{
  const result = await expandChainFromRegistry({
    registryDir: SAMPLE_REGISTRY,
    packName: SAMPLE_PACK_NAME,
    chainId: 'vendor.openwop.workflow-chain-sample.fetch-and-summarize',
    parameters: {
      url: 'https://example.com/article',
      targetLength: 'executive-summary',
    },
    expansionId: 'ef01',
  });
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);

  // Both nodes get the prefix.
  const fetchNode = result.nodes.find((n) => n.id.endsWith('_fetch'))!;
  const summarizeNode = result.nodes.find((n) => n.id.endsWith('_summarize'))!;
  assert.ok(fetchNode, 'fetch node present');
  assert.ok(summarizeNode, 'summarize node present');

  // Param substitution in the fetch node.
  assert.equal((fetchNode.config as { url: string }).url, 'https://example.com/article');

  // Edge rewriting — both endpoints reference fragment-internal nodes
  // so both get the prefix; port suffixes preserved.
  const edge = result.edges[0]!;
  const prefix = 'vendor_openwop_workflow-chain-sample_fetch-and-summarize_ef01_';
  assert.equal(edge.from, `${prefix}fetch.body`);
  assert.equal(edge.to, `${prefix}summarize.sourceText`);

  // Capability propagation: both nodes inherit `side-effectful`.
  assert.deepEqual(fetchNode.capabilities, ['side-effectful']);
  assert.deepEqual(summarizeNode.capabilities, ['side-effectful']);
  console.log('✓ case 2 — 2-node chain with edge rewriting + capability propagation');
}

// ─── Case 3: pack not found ────────────────────────────────────────────

await expectThrow(
  () =>
    expandChainFromRegistry({
      registryDir: SAMPLE_REGISTRY,
      packName: 'vendor.acme.does-not-exist',
      chainId: 'whatever',
      parameters: {},
    }),
  'pack_not_found',
  'case 3 — unknown pack',
);
console.log('✓ case 3 — pack not found');

// ─── Case 4: chain id not in pack ──────────────────────────────────────

await expectThrow(
  () =>
    expandChainFromRegistry({
      registryDir: SAMPLE_REGISTRY,
      packName: SAMPLE_PACK_NAME,
      chainId: 'vendor.openwop.workflow-chain-sample.does-not-exist',
      parameters: {},
    }),
  'chain_not_found',
  'case 4 — unknown chainId',
);
console.log('✓ case 4 — chain not found');

// ─── Case 5: pack found but kind != "workflow-chain" ───────────────────

{
  const tmpDir = mkdtempSync(join(tmpdir(), 'openwop-chain-test-'));
  const fakePackName = 'vendor.test.fake-node-pack';
  const fakePackDir = join(tmpDir, fakePackName);
  mkdirSync(fakePackDir, { recursive: true });
  writeFileSync(
    join(fakePackDir, 'pack.json'),
    JSON.stringify({
      name: fakePackName,
      version: '1.0.0',
      kind: 'node',
      engines: { openwop: '>=1.0.0' },
      nodes: [{ typeId: 'vendor.test.fake.node', main: 'index.mjs' }],
    }),
  );
  await expectThrow(
    () =>
      expandChainFromRegistry({
        registryDir: tmpDir,
        packName: fakePackName,
        chainId: 'whatever',
        parameters: {},
      }),
    'pack_kind_invalid',
    'case 5 — node pack rejected on the chain-expansion path',
  );
  console.log('✓ case 5 — pack_kind_invalid for kind=node');
}

console.log('\nworkflow-chain-expansion: 5/5 cases passed');
