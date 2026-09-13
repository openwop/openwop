#!/usr/bin/env node
/**
 * `spec/v1/host-sample-test-seams.md` §5 states the isolation property the
 * mock-AI program seam depends on:
 *
 *   "The seam is callable BEFORE the run is created — each conformance
 *    scenario uses a unique fixture (and therefore unique `nodeId`)."
 *
 * That parenthetical is the whole safety argument. `POST /host/sample/test/
 * mock-ai/program` takes `{ nodeId, program }` and nothing else: no run, no
 * workflow, no tenant. The stored program is therefore global host state keyed
 * by a bare node id, and "unique fixture" only implies "unique nodeId" if the
 * fixture set actually says so.
 *
 * It did not. Nine fixtures declared a node called `structured-call`, vitest
 * runs scenario files in parallel, and so any two of those nine could overwrite
 * each other's program mid-run. It produced a long-lived flake in
 * `replay-observable-sequence-determinism`, which does not program the mock at
 * all and simply inherited whatever the last writer left: when an envelope
 * scenario had just staged `{ stopReason: 'safety' }`, the replay fixture's own
 * node refused, its run reached `failed`, and the scenario reported
 *
 *     expected 'failed' to be 'completed'
 *
 * — which reads as a broken replay implementation and is not one. It was green
 * in isolation, red under the full gate, and did not track load, because
 * contention was never the variable. Overlap was.
 *
 * This gate makes the spec sentence enforceable rather than aspirational.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'fixtures');

/** node id -> fixtures declaring it */
const owners = new Map();
const nodesOf = new Map();
for (const f of readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json'))) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8'));
  } catch {
    continue;
  }
  const id = f.slice(0, -5);
  const nodes = (doc.nodes ?? [])
    .filter((n) => n && typeof n.id === 'string')
    .map((n) => ({ id: n.id, mock: (n.config ?? {}).provider === 'mock' }));
  nodesOf.set(id, nodes);
  for (const n of nodes) {
    if (!owners.has(n.id)) owners.set(n.id, []);
    owners.get(n.id).push(id);
  }
}

/**
 * Which nodes are programmable? Every node that dispatches to the mock
 * provider — not just the ones some scenario happens to program today.
 *
 * That distinction is the whole point. The scenario that flaked,
 * `replay-observable-sequence-determinism`, never calls the seam: it runs
 * `conformance-phase4-nondet-tool` and inherits whatever program the node was
 * last given by somebody else. A gate keyed on "fixtures a programming
 * scenario references" would have declared that fixture out of scope and
 * passed over the exact defect it exists to catch. The seam is global, so the
 * hazard belongs to the node, not to the caller.
 */
const programmable = [];
for (const [fx, nodes] of nodesOf) {
  for (const n of nodes) {
    if (n.mock) programmable.push({ fixture: fx, node: n.id });
  }
}

if (programmable.length === 0) {
  console.error('check-mock-ai-node-ids-unique FAILED — found no fixture node dispatching to the mock provider.');
  console.error('  The sweep is broken, not the tree: this gate cannot pass vacuously.');
  process.exit(1);
}

const violations = programmable
  .map((p) => ({ ...p, alsoIn: (owners.get(p.node) ?? []).filter((x) => x !== p.fixture) }))
  .filter((p) => p.alsoIn.length > 0);

if (violations.length > 0) {
  console.error('=== check-mock-ai-node-ids-unique FAILED ===');
  console.error('');
  console.error('spec/v1/host-sample-test-seams.md §5 requires a mock-driven fixture to own its node');
  console.error('ids: the seam is keyed by `nodeId` alone, so a shared id is shared host state between');
  console.error('scenario files that vitest runs in parallel. The last writer wins, and the loser fails');
  console.error('an assertion about its own subject rather than about the collision.');
  console.error('');
  for (const v of violations) {
    console.error(`  ${v.fixture} node \`${v.node}\` dispatches to the mock provider`);
    console.error(`      also declared by: ${v.alsoIn.join(', ')}`);
  }
  console.error('');
  console.error('Fix: rename the node so it is unique across conformance/fixtures/, and update the');
  console.error('scenarios that program it. Do not serialize the scenarios instead — §5 names unique');
  console.error('node ids as the isolation mechanism, and a lock would leave that sentence false.');
  process.exit(1);
}

console.log(
  `=== check-mock-ai-node-ids-unique OK — ${programmable.length} mock-provider node(s) across ${nodesOf.size} fixture(s); every one is owned by exactly one fixture ===`,
);
