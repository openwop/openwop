#!/usr/bin/env node
/**
 * Drift-gate for the duplicated `expandChain()` algorithm.
 *
 * Background. The spec-authoritative implementation lives at
 * `conformance/src/lib/workflow-chain-expansion.ts`. The in-memory
 * reference host carries a verbatim copy at
 * `examples/hosts/in-memory/src/workflow-chain-expansion.ts` because
 * the host has a zero-runtime-deps policy and cannot import from the
 * conformance package. The header comment in the host copy makes the
 * convention explicit, and the live-host conformance scenario
 * (`workflow-chain-host-expansion.test.ts`) exercises both
 * implementations end-to-end — but that's a behavioral check, not a
 * byte-level one. A future edit to one copy that doesn't change the
 * fixture outputs would ship silent drift.
 *
 * This script closes that loophole by extracting the "pure algorithm"
 * section from each file (the region between the `// ─── Pure
 * algorithm` marker and the next major section break) and asserting
 * byte equality after whitespace normalization. Failure prints a
 * unified diff so the author can decide which copy is canonical.
 *
 * Exit codes:
 *   0  copies match (or whitespace-only drift)
 *   1  semantic drift detected; manual merge required
 *   2  could not locate the algorithm region in one or both files
 *      (probably refactor — update the markers below)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFORMANCE_PATH = resolve(REPO_ROOT, 'conformance/src/lib/workflow-chain-expansion.ts');
const HOST_PATH = resolve(REPO_ROOT, 'examples/hosts/in-memory/src/workflow-chain-expansion.ts');

// Markers chosen so that the host file (which has additional I/O code
// AFTER the pure algorithm) and the conformance file (which is pure
// algorithm only) yield comparable slices.
//
//   START: the `// ─── Pure algorithm` banner OR the first `export
//          class ChainUnresolvableTypeIdError` line (conformance file
//          has the banner via header context; host file has the
//          explicit banner).
//   END:   either EOF (conformance) or the `// ─── Host-side I/O
//          wrapper` banner (host).
const START_RE = /export class ChainUnresolvableTypeIdError/;
const END_RE = /\/\/ ─── Host-side I\/O wrapper/;

function extractAlgorithm(text, label) {
  const startMatch = START_RE.exec(text);
  if (!startMatch) {
    console.error(`[sync-gate] could not find algorithm START marker in ${label}`);
    process.exit(2);
  }
  const startIdx = startMatch.index;
  const endMatch = END_RE.exec(text.slice(startIdx));
  const endIdx = endMatch ? startIdx + endMatch.index : text.length;
  return text.slice(startIdx, endIdx).trimEnd();
}

function normalize(s) {
  // Whitespace-tolerant diff: collapse trailing whitespace on each
  // line; drop fully-blank lines. Semantic drift in comments OR code
  // still fails, but `dprint`-style reformatting that only changes
  // blank-line count passes.
  return s
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.length > 0)
    .join('\n');
}

const conformanceText = readFileSync(CONFORMANCE_PATH, 'utf8');
const hostText = readFileSync(HOST_PATH, 'utf8');

const conformanceAlgo = extractAlgorithm(conformanceText, 'conformance');
const hostAlgo = extractAlgorithm(hostText, 'host');

if (normalize(conformanceAlgo) === normalize(hostAlgo)) {
  console.log('[sync-gate] workflow-chain expansion algorithm — in-sync.');
  process.exit(0);
}

console.error('[sync-gate] DRIFT detected between:');
console.error(`  conformance: ${CONFORMANCE_PATH}`);
console.error(`  host:        ${HOST_PATH}`);
console.error('');
console.error('Decide which copy is canonical (the conformance copy is spec-');
console.error('authoritative by convention; the host copy is a sanctioned mirror)');
console.error('and align the other. Then re-run this script. To inspect:');
console.error('');
console.error(`  diff -u ${CONFORMANCE_PATH} ${HOST_PATH}`);
console.error('');

// Emit the per-line diff so CI logs show the substantive divergence
// rather than a single "they differ" message.
const a = normalize(conformanceAlgo).split('\n');
const b = normalize(hostAlgo).split('\n');
const max = Math.max(a.length, b.length);
for (let i = 0; i < max; i++) {
  if (a[i] !== b[i]) {
    console.error(`  L${i + 1}:`);
    console.error(`    conformance: ${a[i] ?? '<absent>'}`);
    console.error(`    host:        ${b[i] ?? '<absent>'}`);
    // Cap diff verbosity so a major refactor doesn't flood CI logs.
    if (i > 30) {
      console.error(`  … (truncated; ${max - i - 1} more differing lines)`);
      break;
    }
  }
}
process.exit(1);
