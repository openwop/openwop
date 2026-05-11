#!/usr/bin/env node
/**
 * Pack-coverage audit. Compares typeIds declared by in-tree
 * `defineNode({ id: '...' })` calls in a MyndHyve checkout against
 * the typeIds exported by the 19 OpenWOP packs in `packs/`.
 *
 *   node scripts/audit-pack-coverage.mjs --myndhyve <path>
 *
 * Outputs:
 *   PACK-COVERAGE:  typeIds declared by both in-tree + a pack
 *   IN-TREE-ONLY:   typeIds in myndhyve but no pack ships them
 *                    → blocker for Phase 5.5 (delete in-tree)
 *   PACK-ONLY:      typeIds in a pack but not in myndhyve in-tree
 *                    → expected for new pack-only nodes; flag anyway
 *
 * "In-tree" means: a source file under any of
 *   src/core/workflow/nodes/
 *   src/core/launch-studio/nodes/
 *   src/packs/nodes/
 *   packages/workflow-engine/src/nodes/core/   (engine built-ins)
 * containing a literal `defineNode({` whose first `id: '...'` line is
 * the typeId.
 *
 * Engine-built-ins (`packages/workflow-engine/src/nodes/core/`) STAY
 * in-tree by design (per docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION
 * §2.1). They show up in IN-TREE-ONLY as expected and are not a
 * blocker. The script tags them so the human reader can tell.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PACKS_DIR = join(REPO_ROOT, 'packs');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', yellow: '', cyan: '', reset: '' };

function parseArgs(argv) {
  const args = { myndhyve: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--myndhyve') args.myndhyve = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: audit-pack-coverage.mjs --myndhyve <path-to-myndhyve-checkout>');
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!args.myndhyve) {
    console.error('✗ --myndhyve <path> is required');
    process.exit(2);
  }
  args.myndhyve = resolve(args.myndhyve);
  return args;
}

// ─── walk + extract typeIds from defineNode calls ────────────────────

function walkFiles(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

// Two patterns:
//   (a) defineNode({ id: '...' })  — modern NodeModule SDK
//   (b) NodeTypeDefinition objects — legacy: `export const X: NodeTypeDefinition = { id: '...' }`
const DEFINE_NODE_RE = /defineNode\(\{[\s\n]*id:\s*['"]([^'"]+)['"]/g;
const NODE_TYPE_DEF_RE = /NodeTypeDefinition\s*=\s*\{[\s\n]*id:\s*['"]([^'"]+)['"]/g;

// Validates that an `id: '...'` literal is plausibly a typeId rather
// than a parameter id (e.g., `{ id: 'swarmId', type: 'string' }`).
// TypeIds in the codebase all contain at least one dot.
function isTypeIdShape(s) {
  return s.includes('.');
}

function extractTypeIdsFromFile(path) {
  const text = readFileSync(path, 'utf8');
  const out = [];
  for (const m of text.matchAll(DEFINE_NODE_RE)) {
    if (isTypeIdShape(m[1])) out.push(m[1]);
  }
  for (const m of text.matchAll(NODE_TYPE_DEF_RE)) {
    if (isTypeIdShape(m[1])) out.push(m[1]);
  }
  return out;
}

function inventoryInTree(myndhyveRoot) {
  const roots = [
    { path: join(myndhyveRoot, 'src/core/workflow/nodes'), tag: 'src/core/workflow/nodes' },
    { path: join(myndhyveRoot, 'src/core/launch-studio/nodes'), tag: 'src/core/launch-studio/nodes' },
    // src/packs/nodes is metadata-only per migration plan §1.2 — typeIds
    // declared there have no executor; they're editor-side scaffolding
    // that future state CONSUMES from the pack registry. Tagged so the
    // report can distinguish, blocker classification excludes it.
    { path: join(myndhyveRoot, 'src/packs/nodes'), tag: 'src/packs/nodes (editor-only)' },
    { path: join(myndhyveRoot, 'packages/workflow-engine/src/nodes/core'), tag: 'engine-built-in' },
  ];

  const result = new Map(); // typeId → { sources: [{tag, path}] }
  for (const { path, tag } of roots) {
    if (!existsSync(path)) continue;
    const files = [];
    walkFiles(path, files);
    for (const f of files) {
      for (const typeId of extractTypeIdsFromFile(f)) {
        if (!result.has(typeId)) result.set(typeId, { sources: [] });
        result.get(typeId).sources.push({ tag, path: f.slice(myndhyveRoot.length + 1) });
      }
    }
  }
  return result;
}

// ─── pack inventory (from packs/*/pack.json) ─────────────────────────

function inventoryPacks() {
  const out = new Map(); // typeId → packName
  if (!existsSync(PACKS_DIR)) return out;
  for (const name of readdirSync(PACKS_DIR).sort()) {
    const manifestPath = join(PACKS_DIR, name, 'pack.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const n of manifest.nodes ?? []) {
      if (typeof n.typeId === 'string') out.set(n.typeId, name);
    }
  }
  return out;
}

// ─── report ──────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const inTree = inventoryInTree(args.myndhyve);
const packs = inventoryPacks();

const allTypeIds = new Set([...inTree.keys(), ...packs.keys()]);
const covered = [];      // in both
const inTreeOnly = [];   // myndhyve-only — Phase 5.5 blocker (unless engine-built-in)
const packOnly = [];     // pack-only — fine, just report

for (const typeId of allTypeIds) {
  const inMt = inTree.has(typeId);
  const inPk = packs.has(typeId);
  if (inMt && inPk) covered.push(typeId);
  else if (inMt) inTreeOnly.push(typeId);
  else if (inPk) packOnly.push(typeId);
}

covered.sort();
inTreeOnly.sort();
packOnly.sort();

// engine-built-ins are expected to stay in-tree.
function isEngineBuiltIn(typeId) {
  return inTree.get(typeId)?.sources?.some((s) => s.tag === 'engine-built-in') ?? false;
}

// Editor-only metadata typeIds (src/packs/nodes/) have no runtime
// executor — per migration plan §1.2, the future state has that
// directory consuming from the pack registry, not declaring typeIds.
// So a typeId that EXISTS ONLY in src/packs/nodes/ is NOT a blocker.
function isEditorOnly(typeId) {
  const entry = inTree.get(typeId);
  if (!entry) return false;
  return entry.sources.every((s) => s.tag === 'src/packs/nodes (editor-only)');
}

const blockers = inTreeOnly.filter((t) => !isEngineBuiltIn(t) && !isEditorOnly(t));
const engineBuiltIns = inTreeOnly.filter(isEngineBuiltIn);
const editorOnly = inTreeOnly.filter(isEditorOnly);

// ─── output ──────────────────────────────────────────────────────────

console.log(`${C.cyan}=== Pack coverage audit ===${C.reset}`);
console.log(`myndhyve: ${args.myndhyve}`);
console.log(`packs:    ${PACKS_DIR}`);
console.log('');
console.log(`In-tree typeIds:  ${inTree.size}`);
console.log(`Pack typeIds:     ${packs.size}`);
console.log('');

console.log(`${C.green}✓ PACK-COVERED (${covered.length})${C.reset} — typeId in both in-tree + a pack`);
for (const t of covered) {
  console.log(`  ${C.dim}${packs.get(t).padEnd(40)}${C.reset}  ${t}`);
}
console.log('');

console.log(`${C.yellow}⚠ ENGINE-BUILT-IN (${engineBuiltIns.length})${C.reset} — stays in-tree by design (per §2.1)`);
for (const t of engineBuiltIns) {
  console.log(`  ${C.dim}engine                                  ${C.reset}  ${t}`);
}
console.log('');

console.log(`${C.dim}ℹ EDITOR-ONLY METADATA (${editorOnly.length})${C.reset} — src/packs/nodes/ scaffolds for the workflow editor. No executor.`);
console.log(`${C.dim}  Per migration plan §1.2 these typeIds don't need pack equivalents — the directory itself becomes a pack-registry CONSUMER in the future state.${C.reset}`);
for (const t of editorOnly) {
  console.log(`  ${C.dim}editor-only                             ${C.reset}  ${t}`);
}
console.log('');

if (blockers.length === 0) {
  console.log(`${C.green}✓ NO BLOCKERS — every non-engine typeId has a pack home.${C.reset}`);
  console.log(`  Phase 5.5 (delete src/core/workflow/nodes/, src/core/launch-studio/nodes/,`);
  console.log(`  src/packs/nodes/) is unblocked once Phase 5.3 (publish) completes.`);
} else {
  console.log(`${C.red}✗ BLOCKERS (${blockers.length}) — in-tree typeIds with no pack equivalent${C.reset}`);
  console.log(`  These MUST get a pack before 5.5 (delete in-tree) can proceed.`);
  for (const t of blockers) {
    const src = inTree.get(t).sources[0];
    console.log(`  ${C.red}✗${C.reset}  ${t}  ${C.dim}(${src.tag})${C.reset}`);
  }
}
console.log('');

if (packOnly.length > 0) {
  console.log(`${C.cyan}ℹ PACK-ONLY (${packOnly.length})${C.reset} — pack ships them but no in-tree equivalent`);
  console.log(`  Expected when a pack adds new nodes; flag anyway in case of typeId drift.`);
  for (const t of packOnly) {
    console.log(`  ${C.dim}${packs.get(t).padEnd(40)}${C.reset}  ${t}`);
  }
  console.log('');
}

process.exit(blockers.length === 0 ? 0 : 1);
