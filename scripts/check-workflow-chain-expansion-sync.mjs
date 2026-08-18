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
// The in-memory host now lives in the openwop-examples repo. CI checks it out and
// points OPENWOP_EXAMPLES_DIR at the checkout root; falls back to an in-tree path
// for anyone who vendors examples/ alongside the spec corpus.
const EXAMPLES_ROOT = process.env.OPENWOP_EXAMPLES_DIR
  ? resolve(process.env.OPENWOP_EXAMPLES_DIR)
  : REPO_ROOT;
const HOST_PATH = resolve(EXAMPLES_ROOT, 'examples/hosts/in-memory/src/workflow-chain-expansion.ts');

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
// The compared region ends at whichever sentinel the file carries:
//   • conformance — `// ─── End of the MIRRORED CORE`, which closes the base
//     algorithm and opens the CAPABILITY-GATED surfaces (RFC 0124 deferred
//     parameters, RFC 0133 sub-chain co-expansion) that a minimal host is NOT
//     obliged to mirror. RFC 0133 in fact requires a host that does not
//     advertise `workflowChainPacks.subChains` to REFUSE that surface rather
//     than implement it, so demanding a byte-mirror of it was incoherent.
//   • host — `// ─── Host-side I/O wrapper`, unchanged.
//
// Before this scope was pinned, the conformance side ran to EOF and the gate
// compared 33 KB against 4.5 KB — 6 shared declarations versus 32 — so it
// reported permanent drift for surfaces the mirror was never meant to carry.
// It failed 40 consecutive scheduled runs on `main` (from at least 2026-07-11)
// and was, in practice, unactionable.
const END_RES = [/\/\/ ─── End of the MIRRORED CORE/, /\/\/ ─── Host-side I\/O wrapper/];

function extractAlgorithm(text, label) {
  const startMatch = START_RE.exec(text);
  if (!startMatch) {
    console.error(`[sync-gate] could not find algorithm START marker in ${label}`);
    process.exit(2);
  }
  const startIdx = startMatch.index;
  const rest = text.slice(startIdx);
  const ends = END_RES.map((re) => re.exec(rest)).filter(Boolean).map((m) => m.index);
  const endIdx = ends.length > 0 ? startIdx + Math.min(...ends) : text.length;
  return text.slice(startIdx, endIdx).trimEnd();
}

// SP-01 (2026-08-18) — SECOND mirrored region: the RFC 0157 compensation pass.
//
// `carryCompensation` / `expandChainWithCompensation` compose on the core's
// output, so they sit BELOW the core sentinel — but carrying a chain's
// `compensation` declaration is unconditional (a host that does not advertise
// `capabilities.compensation` still MUST carry it verbatim and refuse only a
// chain-level POLICY), unlike the capability-gated surfaces alongside them,
// which a non-advertising host MUST REFUSE rather than mirror. Unconditional ⇒
// mirrorable ⇒ gated. RFC 0157 claimed this pass was "CI-gated against the
// reference host" and it never was, so the mirror silently lacked it.
//
// Both files delimit the region with the same explicit sentinels, so this
// extraction is symmetric (unlike the core's, where the host file's trailing
// I/O wrapper needs its own end marker).
const COMPENSATION_BEGIN_RE = /\/\/ ─── Begin the MIRRORED COMPENSATION pass/;
const COMPENSATION_END_RE = /\/\/ ─── End of the MIRRORED COMPENSATION pass/;

/**
 * Slice the compensation pass, or `null` when the file carries neither
 * sentinel. A file with exactly one sentinel is a hard error: it means someone
 * half-moved the region and the comparison would silently narrow.
 */
function extractCompensationPass(text, label) {
  const begin = COMPENSATION_BEGIN_RE.exec(text);
  const end = COMPENSATION_END_RE.exec(text);
  if (!begin && !end) return null;
  if (!begin || !end) {
    console.error(
      `[sync-gate] ${label} carries only ONE of the MIRRORED COMPENSATION sentinels ` +
        `(begin=${Boolean(begin)}, end=${Boolean(end)}). Both are required.`,
    );
    process.exit(2);
  }
  if (end.index <= begin.index) {
    console.error(`[sync-gate] ${label}: the COMPENSATION end sentinel precedes its begin sentinel.`);
    process.exit(2);
  }
  return text.slice(begin.index + begin[0].length, end.index).trimEnd();
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

const conformanceComp = extractCompensationPass(conformanceText, 'conformance');
const hostComp = extractCompensationPass(hostText, 'host');

// The conformance copy is spec-authoritative: if IT delimits the region, the
// host mirror MUST carry it too. (The reverse — a host-only region — is also a
// mismatch and is reported by the same branch.)
if (conformanceComp === null && hostComp !== null) {
  console.error('[sync-gate] the HOST delimits a MIRRORED COMPENSATION pass but the conformance copy does not.');
  process.exit(1);
}
if (conformanceComp !== null && hostComp === null) {
  console.error('[sync-gate] DRIFT: the conformance copy delimits a MIRRORED COMPENSATION pass');
  console.error('  (RFC 0157 carryCompensation / expandChainWithCompensation) that the host mirror LACKS.');
  console.error(`  host: ${HOST_PATH}`);
  console.error('  Port the region between the two `─── … MIRRORED COMPENSATION pass` sentinels.');
  process.exit(1);
}

const coreInSync = normalize(conformanceAlgo) === normalize(hostAlgo);
const compInSync =
  conformanceComp === null || normalize(conformanceComp) === normalize(hostComp);

if (coreInSync && compInSync) {
  console.log(
    '[sync-gate] workflow-chain expansion algorithm — in-sync' +
      (conformanceComp === null ? '' : ' (core + RFC 0157 compensation pass)') +
      '.',
  );
  process.exit(0);
}

if (coreInSync && !compInSync) {
  console.error('[sync-gate] DRIFT in the RFC 0157 MIRRORED COMPENSATION pass between:');
  console.error(`  conformance: ${CONFORMANCE_PATH}`);
  console.error(`  host:        ${HOST_PATH}`);
  console.error('');
  const a = normalize(conformanceComp).split('\n');
  const b = normalize(hostComp).split('\n');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      console.error(`  L${i + 1}:`);
      console.error(`    conformance: ${a[i] ?? '<absent>'}`);
      console.error(`    host:        ${b[i] ?? '<absent>'}`);
      if (i > 30) {
        console.error(`  … (truncated; ${max - i - 1} more differing lines)`);
        break;
      }
    }
  }
  process.exit(1);
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
