#!/usr/bin/env node
/**
 * check-agent-tool-allowlist — verifies that every `toolAllowlist[]` entry in
 * every agent pack under `packs/` resolves to a real, currently-defined node
 * typeId in the in-tree pack catalog. Catches drift between agent packs and
 * the node packs they depend on as node packs version-bump or rename typeIds.
 *
 * Resolution rules (mirrors agent-manifest.schema.json toolAllowlist semantics):
 *
 *   - `openwop:<typeId>`              must match a `nodes[].typeId` from some
 *                                     pack in packs/ (typically a core.* pack).
 *   - `mcp:<tool-id>`                 NOT resolved — MCP tools are host-loaded
 *                                     at runtime, not in the static catalog.
 *                                     Allowed without check.
 *   - `<vendor>.<host>:<tool-id>`     host-extension tool; not resolved
 *                                     statically (host-defined). Allowed
 *                                     without check.
 *
 * Exit codes:
 *   0 — every openwop:<typeId> ref resolves; or no agent packs found.
 *   1 — one or more dangling openwop:<typeId> refs found; failed paths
 *       printed to stderr with the pack + agentId that referenced them.
 *   2 — invocation error (bad cwd, malformed pack.json, etc.).
 *
 * Usage:
 *   node scripts/check-agent-tool-allowlist.mjs
 *   node scripts/check-agent-tool-allowlist.mjs --packs-dir packs --verbose
 *
 * Wiring: invoke from CI on PRs touching `packs/`. Not wired into
 * scripts/openwop-check.sh — that gate is reserved for the 9-step spec-
 * corpus pass. This is a pack-catalog audit, run separately.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
let packsDir = join(REPO_ROOT, 'packs');
let verbose = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--packs-dir') packsDir = resolve(args[++i]);
  else if (a === '--verbose' || a === '-v') verbose = true;
  else if (a === '--help' || a === '-h') {
    process.stdout.write(`Usage: check-agent-tool-allowlist.mjs [--packs-dir <path>] [--verbose]\n`);
    process.exit(0);
  } else {
    process.stderr.write(`unknown flag: ${a}\n`);
    process.exit(2);
  }
}

if (!existsSync(packsDir) || !statSync(packsDir).isDirectory()) {
  process.stderr.write(`packs directory not found: ${packsDir}\n`);
  process.exit(2);
}

// --- 1. Build the node typeId catalog by scanning every pack.json's nodes[]. ---

const knownTypeIds = new Set();
const packDirs = readdirSync(packsDir).filter((name) => {
  const p = join(packsDir, name);
  return statSync(p).isDirectory() && existsSync(join(p, 'pack.json'));
});

for (const name of packDirs) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(packsDir, name, 'pack.json'), 'utf8'));
  } catch (e) {
    process.stderr.write(`pack.json parse error in ${name}: ${e.message}\n`);
    process.exit(2);
  }
  for (const node of manifest.nodes || []) {
    if (typeof node.typeId === 'string') knownTypeIds.add(node.typeId);
  }
}

if (verbose) {
  process.stdout.write(`scanned ${packDirs.length} packs, found ${knownTypeIds.size} node typeIds\n`);
}

// --- 2. For every agent pack, resolve every openwop:<typeId> in toolAllowlist. ---

const failures = [];
let agentPackCount = 0;
let agentCount = 0;
let allowlistEntryCount = 0;

for (const name of packDirs) {
  const manifest = JSON.parse(readFileSync(join(packsDir, name, 'pack.json'), 'utf8'));
  const agents = manifest.agents || [];
  if (agents.length === 0) continue;
  agentPackCount++;
  for (const agent of agents) {
    agentCount++;
    const allowlist = agent.toolAllowlist || [];
    for (const entry of allowlist) {
      allowlistEntryCount++;
      if (typeof entry !== 'string' || !entry.includes(':')) {
        failures.push({ pack: name, agentId: agent.agentId, entry, reason: 'malformed (no scope prefix)' });
        continue;
      }
      const colon = entry.indexOf(':');
      const scope = entry.slice(0, colon);
      const tail = entry.slice(colon + 1);

      if (scope === 'openwop') {
        if (!knownTypeIds.has(tail)) {
          failures.push({
            pack: name,
            agentId: agent.agentId,
            entry,
            reason: `dangling openwop:<typeId> — no pack in packs/ defines a node with typeId="${tail}"`,
          });
        }
      } else if (scope === 'mcp') {
        // MCP tools are host-loaded; not statically checkable.
        continue;
      } else if (scope.includes('.')) {
        // <vendor>.<host>:<tool-id> — host-extension; not statically checkable.
        continue;
      } else {
        failures.push({
          pack: name,
          agentId: agent.agentId,
          entry,
          reason: `unknown scope prefix "${scope}:" — expected one of openwop:, mcp:, or <vendor>.<host>:`,
        });
      }
    }
  }
}

// --- 3. Report. ---

process.stdout.write(`agent packs scanned: ${agentPackCount}\n`);
process.stdout.write(`agents scanned: ${agentCount}\n`);
process.stdout.write(`toolAllowlist entries scanned: ${allowlistEntryCount}\n`);
process.stdout.write(`failures: ${failures.length}\n`);

if (failures.length === 0) {
  process.stdout.write(`OK — all openwop:<typeId> refs resolve.\n`);
  process.exit(0);
}

process.stderr.write(`\nFAIL — ${failures.length} dangling or malformed toolAllowlist entries:\n\n`);
for (const f of failures) {
  process.stderr.write(`  pack: ${f.pack}\n`);
  process.stderr.write(`  agentId: ${f.agentId}\n`);
  process.stderr.write(`  entry: ${f.entry}\n`);
  process.stderr.write(`  reason: ${f.reason}\n\n`);
}
process.stderr.write(`Hint: update the agent's toolAllowlist to reference a typeId currently in the in-tree pack catalog, or remove the reference if the underlying node was retired.\n`);
process.exit(1);
