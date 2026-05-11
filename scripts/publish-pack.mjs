#!/usr/bin/env node
/**
 * Publish built pack tarballs to an OpenWOP pack registry.
 *
 *   node scripts/publish-pack.mjs --pack <name> [--version <v>]
 *   node scripts/publish-pack.mjs --all
 *   node scripts/publish-pack.mjs --all --dry-run    (print, don't POST)
 *
 * Environment:
 *   OPENWOP_PACK_REGISTRY_URL   Base URL of the registry, e.g.
 *                               https://workflow-runtime-...-uc.a.run.app
 *                               (or https://api.myndhyve.ai for the
 *                               hosted MyndHyve registry)
 *   OPENWOP_PACK_PUBLISH_KEY    Bearer token (Firebase ID token of a
 *                               super-admin). Mint via:
 *                                 gcloud auth print-identity-token \
 *                                   --impersonate-service-account=...
 *                               or via a Firebase Auth client SDK.
 *
 * Spec: PUT /v1/packs/<name>/-/<version>.tgz with the gzipped tarball
 * as application/gzip body. The route's createPublishTar handler
 *   1. parses the tarball
 *   2. cross-checks pack.json.name == URL name (and same for version)
 *   3. verifies the embedded signature against the registry's
 *      keychain for that pack (publicKeyRef → keychain key)
 *   4. records the version in Firestore + uploads the tarball to
 *      Cloud Storage
 *
 * For unsigned (non-`private.*`) tarballs the registry returns 400
 * signature_required. Use `build-pack-tarball.mjs --signed` first.
 *
 * @see services/workflow-runtime/src/routes/packs.ts createPublishTar
 * @see spec/v1/node-packs.md §"Registry HTTP API"
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_DIST = join(REPO_ROOT, 'dist', 'packs');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', yellow: '', cyan: '', reset: '' };
const ok = (s) => console.log(`${C.green}${s}${C.reset}`);
const warn = (s) => console.log(`${C.yellow}${s}${C.reset}`);
const fail = (s) => console.error(`${C.red}${s}${C.reset}`);
const dim = (s) => console.log(`${C.dim}${s}${C.reset}`);
const cyan = (s) => console.log(`${C.cyan}${s}${C.reset}`);

function parseArgs(argv) {
  const args = { pack: null, version: null, all: false, dist: DEFAULT_DIST, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack') args.pack = argv[++i];
    else if (a === '--version') args.version = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--dist') args.dist = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: publish-pack.mjs [--pack <name> [--version <v>] | --all] [--dist <dir>] [--dry-run]');
      console.log('Env: OPENWOP_PACK_REGISTRY_URL, OPENWOP_PACK_PUBLISH_KEY');
      process.exit(0);
    } else {
      fail(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const REGISTRY_URL = process.env.OPENWOP_PACK_REGISTRY_URL?.replace(/\/$/, '');
const PUBLISH_KEY = process.env.OPENWOP_PACK_PUBLISH_KEY;

if (!args.dryRun) {
  if (!REGISTRY_URL) {
    fail('✗ OPENWOP_PACK_REGISTRY_URL env var is required (or use --dry-run)');
    process.exit(2);
  }
  if (!PUBLISH_KEY) {
    fail('✗ OPENWOP_PACK_PUBLISH_KEY env var is required (or use --dry-run)');
    process.exit(2);
  }
}

if (!args.pack && !args.all) {
  fail('✗ specify --pack <name> or --all');
  process.exit(2);
}

if (!existsSync(args.dist)) {
  fail(`✗ dist dir not found: ${args.dist}`);
  fail('  Run: node scripts/build-pack-tarball.mjs --all --signed --key <pem>');
  process.exit(2);
}

// ── enumerate tarballs ────────────────────────────────────────────────

function findTarballs() {
  const files = readdirSync(args.dist).filter((f) => f.endsWith('.tgz')).sort();
  const out = [];
  for (const f of files) {
    // Convention: <name>-<version>.tgz
    const m = f.match(/^(.+)-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/);
    if (!m) continue;
    const [, name, version] = m;
    if (args.pack && args.pack !== name) continue;
    if (args.version && args.version !== version) continue;
    out.push({ name, version, path: join(args.dist, f) });
  }
  return out;
}

const tarballs = findTarballs();
if (tarballs.length === 0) {
  fail(`✗ no tarballs match in ${args.dist}`);
  if (args.pack) fail(`  expected: ${args.pack}-<version>.tgz`);
  process.exit(2);
}

console.log(`=== publish-pack: ${tarballs.length} tarball${tarballs.length === 1 ? '' : 's'} ${args.dryRun ? '(DRY RUN)' : ''} ===`);
if (REGISTRY_URL) cyan(`registry: ${REGISTRY_URL}`);
console.log('');

// ── publish loop ─────────────────────────────────────────────────────

async function publishOne({ name, version, path }) {
  const size = statSync(path).size;
  const url = `${REGISTRY_URL ?? '<registry>'}/v1/packs/${name}/-/${version}.tgz`;

  if (args.dryRun) {
    cyan(`→ ${name}@${version}  (${size} bytes)`);
    dim(`  PUT ${url}`);
    dim(`  Authorization: Bearer <token>`);
    dim(`  Content-Type: application/gzip`);
    return { ok: true };
  }

  const body = readFileSync(path);
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${PUBLISH_KEY}`,
        'Content-Type': 'application/gzip',
      },
      body,
    });

    let json;
    try { json = await res.json(); } catch { json = null; }

    if (res.status === 201) {
      ok(`✓ ${name}@${version}  published (first-time)`);
      return { ok: true, record: json };
    }
    if (res.status === 200) {
      ok(`✓ ${name}@${version}  re-published (idempotent)`);
      return { ok: true, record: json };
    }
    if (res.status === 409) {
      warn(`⚠ ${name}@${version}  version_conflict (already published with different content)`);
      return { ok: false, status: res.status, body: json };
    }
    fail(`✗ ${name}@${version}  ${res.status}  ${json?.error ?? ''}`);
    if (json?.message) dim(`  ${json.message}`);
    return { ok: false, status: res.status, body: json };
  } catch (err) {
    fail(`✗ ${name}@${version}  network error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

let okCount = 0;
let failCount = 0;
for (const t of tarballs) {
  const r = await publishOne(t);
  if (r.ok) okCount++;
  else failCount++;
}

console.log('');
if (failCount === 0) {
  ok(`✓ ${okCount} pack${okCount === 1 ? '' : 's'} ${args.dryRun ? 'enumerated' : 'published'}`);
  process.exit(0);
} else {
  fail(`✗ ${failCount} failure${failCount === 1 ? '' : 's'} (${okCount} succeeded)`);
  process.exit(1);
}
