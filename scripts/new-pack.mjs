#!/usr/bin/env node
/**
 * Generate a new pack source tree from `examples/packs/vendor-template/`.
 *
 *   node scripts/new-pack.mjs vendor.<org>.<pack>
 *   node scripts/new-pack.mjs --pack vendor.<org>.<pack>
 *   node scripts/new-pack.mjs --pack vendor.<org>.<pack> --out packs/
 *
 * Copies the template, substitutes `{ORG}` and `{PACK}` placeholders
 * across pack.json + index.mjs + every schema file + the README, and
 * prints the next-step checklist (customize, build, sign, open PR).
 *
 * Reverse-DNS validation:
 *   - Pack name MUST match `(core|vendor|community)\.<org>\.<rest>` per
 *     `spec/v1/node-packs.md` §Naming. Core packs reserved for openwop
 *     project; community packs are author-claimed; vendor packs require
 *     a registered namespace claim in `registry/.well-known/openwop-
 *     registry.json` `namespaceAssignments`.
 *
 * Pure Node 20 stdlib — no npm install required.
 *
 * Stage 3 PR 1 (2026-05-12): part of the enterprise-architecture plan.
 * Reduces per-pack authoring overhead by ~50% by eliminating the
 * "what files go where + what's the exact placeholder shape" research
 * cost. See docs/AUTHORING-CANVAS-PACKS.md for the full pattern guide.
 */

import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(__filename));
const TEMPLATE_DIR = join(REPO_ROOT, 'examples', 'packs', 'vendor-template');
const DEFAULT_OUT_DIR = join(REPO_ROOT, 'packs');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', cyan: '', dim: '', reset: '' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const fail = (s) => {
  console.error(`${C.red}✗${C.reset} ${s}`);
  process.exit(1);
};
const info = (s) => console.log(`${C.cyan}→${C.reset} ${s}`);
const dim = (s) => console.log(`${C.dim}${s}${C.reset}`);

// ─── arg parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { pack: null, out: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack') {
      args.pack = argv[++i];
    } else if (a === '--out') {
      args.out = resolve(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: new-pack.mjs [--pack] vendor.<org>.<pack> [--out <dir>]');
      console.log('');
      console.log('Generates a new pack source tree under packs/<name>/ from');
      console.log('the examples/packs/vendor-template/ skeleton, with all');
      console.log('placeholder substitutions applied.');
      process.exit(0);
    } else if (!a.startsWith('-') && args.pack === null) {
      // Positional pack name.
      args.pack = a;
    } else {
      fail(`unknown flag: ${a}`);
    }
  }
  return args;
}

// ─── name validation ────────────────────────────────────────────────

const PACK_NAME_RE = /^(core|vendor|community|private)\.([a-z][a-z0-9_-]*)(\.[a-z][a-zA-Z0-9_-]*)+$/;

function parsePackName(name) {
  const match = PACK_NAME_RE.exec(name);
  if (!match) {
    fail(
      `pack name '${name}' violates the reverse-DNS pattern.\n` +
      `Expected: <scope>.<org>.<rest> where scope is core|vendor|community|private\n` +
      `Examples: vendor.acme.salesforce  community.openwop-team.tools`,
    );
  }
  const scope = match[1];
  const org = match[2];
  // The "pack" segment is everything after the second `.` — captures
  // multi-segment names like `vendor.myndhyve.campaign-studio-ads`.
  const restStart = name.indexOf('.', name.indexOf('.') + 1) + 1;
  const pack = name.slice(restStart);

  if (scope === 'core') {
    console.warn(
      `${C.yellow}⚠${C.reset} 'core.*' is reserved for openwop-project-owned packs. ` +
      `Are you sure this isn't supposed to be vendor.<org>.* or community.<author>.*?`,
    );
  }
  if (scope === 'private') {
    console.warn(
      `${C.yellow}⚠${C.reset} 'private.*' packs MUST NOT be published to packs.openwop.dev — ` +
      `they're host-internal only. This generate still works for local dev.`,
    );
  }
  return { scope, org, pack, fullName: name };
}

// ─── copy + substitute ──────────────────────────────────────────────

function substitutePlaceholders(content, parsed) {
  return content
    .replace(/\{ORG\}/g, parsed.org)
    .replace(/\{PACK\}/g, parsed.pack);
}

function copyAndSubstitute(srcDir, destDir, parsed) {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir);
  for (const name of entries) {
    const srcPath = join(srcDir, name);
    const destPath = join(destDir, name);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyAndSubstitute(srcPath, destPath, parsed);
    } else {
      // Substitute in text files; copy binary as-is.
      const ext = name.split('.').pop()?.toLowerCase();
      const textExts = ['json', 'mjs', 'js', 'ts', 'md', 'yaml', 'yml'];
      if (textExts.includes(ext)) {
        const original = readFileSync(srcPath, 'utf8');
        const substituted = substitutePlaceholders(original, parsed);
        writeFileSync(destPath, substituted);
      } else {
        cpSync(srcPath, destPath);
      }
    }
  }
}

// ─── main ───────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pack) {
    fail('pack name required. Usage: new-pack.mjs vendor.<org>.<pack>');
  }
  if (!existsSync(TEMPLATE_DIR)) {
    fail(`template dir missing: ${TEMPLATE_DIR}`);
  }

  const parsed = parsePackName(args.pack);
  const destDir = join(args.out, parsed.fullName);

  if (existsSync(destDir)) {
    fail(
      `destination already exists: ${destDir}\n` +
      `Refusing to overwrite. Delete the existing dir or pick a different name.`,
    );
  }

  info(`generation ${parsed.fullName}`);
  info(`  scope:  ${parsed.scope}`);
  info(`  org:    ${parsed.org}`);
  info(`  pack:   ${parsed.pack}`);
  info(`  output: ${destDir}`);

  copyAndSubstitute(TEMPLATE_DIR, destDir, parsed);

  ok(`pack source tree created at ${destDir}`);

  // Print next steps.
  console.log('');
  info('next steps:');
  console.log('');
  console.log(`  1. Edit ${destDir}/pack.json — update description, keywords, signing.keyId, peerDependencies`);
  console.log(`  2. Replace the example typeId in pack.json + index.mjs with your real nodes`);
  console.log(`  3. Author per-node JSON schemas in ${destDir}/schemas/`);
  console.log(`  4. Write executor logic in ${destDir}/index.mjs using ctx.* accessors`);
  console.log('');
  console.log(`  5. Build + sign:`);
  console.log(`     node scripts/build-pack-tarball.mjs \\`);
  console.log(`       --pack ${parsed.fullName} \\`);
  console.log(`       --signed \\`);
  console.log(`       --key ~/.openwop-keys/${parsed.org}-internal-1.private.pem \\`);
  console.log(`       --key-id ${parsed.org}-internal-1`);
  console.log('');
  console.log(`  6. Open a PR against openwop/openwop with the registry/v1/packs/${parsed.fullName}/-/1.0.0.{tgz,sig,json} files`);
  console.log('');
  dim('   See docs/AUTHORING-CANVAS-PACKS.md for the full pattern guide.');
}

main();
