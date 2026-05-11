#!/usr/bin/env node
/**
 * Single-command pre-publish gate. Runs all three pack-CI steps in
 * sequence and bails on the first failure:
 *
 *   1. scripts/test-packs.mjs           runtime smoke tests
 *   2. scripts/audit-pack-coverage.mjs  in-tree coverage audit
 *   3. scripts/build-pack-tarball.mjs   deterministic build + sign
 *
 *   node scripts/precheck-packs.mjs [--myndhyve <path>] [--key <pem>] [--key-id <id>]
 *
 * --myndhyve  Path to MyndHyve checkout for the coverage audit.
 *             Defaults to ../myndhyve relative to repo root.
 *             Pass `--no-audit` to skip the audit step (e.g., in
 *             environments without a myndhyve checkout).
 * --key       Private key for signing. Omit to use an ephemeral
 *             keypair (dev only — tarballs won't pass registry
 *             keychain verification).
 * --key-id    publicKeyRef in the signing block. Defaults to
 *             "openwop-team-1".
 *
 * Exit 0 only when all three steps succeed. Operator workflow:
 *
 *   node scripts/precheck-packs.mjs --key ~/.keys/openwop.pem \
 *     --key-id openwop-team-1 && \
 *   node scripts/publish-pack.mjs --all
 *
 * Mirrors the standard build → test → audit → publish gate from
 * docs/runbooks/PACK-PUBLISH.md.
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', cyan: '', bold: '', reset: '' };

function parseArgs(argv) {
  const args = {
    myndhyve: resolve(REPO_ROOT, '..', 'myndhyve'),
    noAudit: false,
    key: null,
    keyId: 'openwop-team-1',
    filter: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--myndhyve') args.myndhyve = argv[++i];
    else if (a === '--no-audit') args.noAudit = true;
    else if (a === '--key') args.key = argv[++i];
    else if (a === '--key-id') args.keyId = argv[++i];
    else if (a === '--filter') args.filter = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: precheck-packs.mjs [--myndhyve <path> | --no-audit] [--key <pem>] [--key-id <id>] [--filter <prefix>]');
      console.log('');
      console.log('  --filter <prefix>  Scope step 3 (build) to packs matching the prefix.');
      console.log('                     Useful for per-publisher signing pipelines:');
      console.log('                       precheck-packs.mjs --filter core.openwop --key openwop.pem --key-id openwop-team-1');
      console.log('                       precheck-packs.mjs --filter vendor.myndhyve --key myndhyve.pem --key-id myndhyve-internal-1');
      console.log('                       precheck-packs.mjs --filter community --key community.pem --key-id community-openwop-team-demo-1');
      process.exit(0);
    } else {
      console.error(`${C.red}unknown flag: ${a}${C.reset}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function runStep(label, cmd, cmdArgs) {
  console.log('');
  console.log(`${C.cyan}${C.bold}━━ ${label} ━━${C.reset}`);
  console.log(`${C.dim}${cmd} ${cmdArgs.join(' ')}${C.reset}`);
  console.log('');

  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });

  if (result.error) {
    console.error(`${C.red}✗ ${label} — exec error: ${result.error.message}${C.reset}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`${C.red}✗ ${label} — exit ${result.status}${C.reset}`);
    return false;
  }
  console.log(`${C.green}✓ ${label}${C.reset}`);
  return true;
}

// ─── 1. Smoke tests ──────────────────────────────────────────────────

if (!runStep('Step 1/3 — Pack smoke tests', 'node', ['scripts/test-packs.mjs'])) {
  process.exit(1);
}

// ─── 2. Coverage audit (optional, requires myndhyve checkout) ────────

if (!args.noAudit) {
  if (!existsSync(args.myndhyve)) {
    console.log('');
    console.log(`${C.dim}Step 2/3 — Coverage audit SKIPPED — myndhyve checkout not found at ${args.myndhyve}${C.reset}`);
    console.log(`${C.dim}  Pass --myndhyve <path> or --no-audit to silence this notice.${C.reset}`);
  } else {
    if (!runStep('Step 2/3 — Coverage audit', 'node', ['scripts/audit-pack-coverage.mjs', '--myndhyve', args.myndhyve])) {
      process.exit(1);
    }
  }
} else {
  console.log('');
  console.log(`${C.dim}Step 2/3 — Coverage audit SKIPPED (--no-audit)${C.reset}`);
}

// ─── 3. Build + sign ─────────────────────────────────────────────────

const buildArgs = ['scripts/build-pack-tarball.mjs', '--all', '--signed', '--key-id', args.keyId];
if (args.key) {
  buildArgs.push('--key', args.key);
}
if (args.filter) {
  buildArgs.push('--filter', args.filter);
}

const buildLabel = args.filter
  ? `Step 3/3 — Build signed tarballs (filter: ${args.filter})`
  : 'Step 3/3 — Build signed tarballs';

if (!runStep(buildLabel, 'node', buildArgs)) {
  process.exit(1);
}

// ─── done ────────────────────────────────────────────────────────────

console.log('');
console.log(`${C.green}${C.bold}✓ All pre-publish checks passed.${C.reset}`);
console.log('');
console.log('Next: publish to the registry —');
console.log(`  ${C.dim}export OPENWOP_PACK_REGISTRY_URL=https://...${C.reset}`);
console.log(`  ${C.dim}export OPENWOP_PACK_PUBLISH_KEY=<firebase-id-token>${C.reset}`);
console.log(`  ${C.dim}node scripts/publish-pack.mjs --all${C.reset}`);
console.log('');
