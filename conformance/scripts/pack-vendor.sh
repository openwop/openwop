#!/usr/bin/env bash
# pack-vendor.sh — prepack helper for @openwop/openwop-conformance.
#
# Vendors api/ + schemas/ from the repo root into the conformance package
# directory so npm pack can include them in the published tarball. The
# files field in package.json gates what npm pack actually ships.
#
# Failure-mode safety (H3 from code review of session 21343f09):
# `trap cleanup_on_error ERR` ensures partial copies don't leave the
# working tree polluted if any step fails — without this, a failed
# `cp -R ../schemas ./schemas` after a successful `cp -R ../api ./api`
# would leave api/ in place AND skip postpack, requiring manual cleanup.
#
# postpack still runs the cleanup on the SUCCESS path; this script only
# handles the ERROR path. Both paths leave the working tree clean.

set -euo pipefail

cleanup_on_error() {
  echo "pack-vendor.sh: error during vendoring — removing partial state" >&2
  rm -rf api schemas
}
trap cleanup_on_error ERR

# Defensive cleanup: if a prior run was killed mid-way and bypassed both
# the ERR trap AND postpack, this resets state.
rm -rf api schemas

# Vendor the contract material. Both source dirs live at the public-repo
# root and the in-tree mirror root (), so the relative
# path is consistent between layouts.
cp -R ../api ./api
cp -R ../schemas ./schemas

# v2 charter Phase 3 (RFC 0176 §E.1; RFC 0168 §D.2): the 1.x tarball NEVER
# carries the v2 tree. Prune it here — after the copy and BEFORE the stamp's
# digest walk below — so the stamp enumerates exactly what ships (a stamp that
# names files the tarball lacks makes corpus-stamp.ts refuse to run). The v2
# artifacts are published in @openwop/spec-artifacts, never in this package.
rm -rf ./schemas/v2 ./api/v2 ./api/seams-v2.yaml

# ── Corpus stamp (RFC 0145 G2) ───────────────────────────────────────────────
# Write the provenance of this vendored copy INSIDE schemas/, because the
# directory is what gets copied. The tarball already carries the version in
# package.json — and that is exactly what a `cp -R schemas/ vendor/` throws
# away, which is how a host ends up validating against a contract it can no
# longer identify. A stamp inside the directory survives the copy, so a host
# can compare its vendored stamp against the installed package's stamp with a
# plain file read: no network, no sibling checkout, no pinning a branch.
#
# WRITTEN AT PREPACK ONLY, NEVER INTO THE REPO TREE. `schemas/` in the repo is
# enumerated by spec-corpus-validity against schemas/README.md; a stray
# non-schema JSON sitting there would red that gate. This file only ever exists
# inside conformance/schemas/, which postpack removes wholesale.
#
# NO TIMESTAMP: it would make the tarball non-reproducible for no benefit.
# Both fields are deterministic given the commit being packed.
SUITE_VERSION=$(node -p "require('./package.json').version")
CORPUS_COMMIT=$(git -C .. rev-parse HEAD 2>/dev/null || echo unknown)
cat > ./schemas/CORPUS-STAMP.json <<STAMP
{
  "_comment": "Provenance of this vendored schemas/ copy. See conformance/README.md \u00a7\"Resolving the contract\". Compare against the stamp in your installed @openwop/openwop-conformance to detect a stale hand-copied contract.",
  "suiteVersion": "${SUITE_VERSION}",
  "corpusCommit": "${CORPUS_COMMIT}"
}
STAMP

# Suite 1.154.0: per-file SHA-256 digests of everything vendored, so the suite
# can verify at global setup that the contract it validates against is the one
# it shipped (src/lib/corpus-stamp.ts). Written INTO the stamp, no timestamp.
node - <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, sep } = require('node:path');
const root = process.cwd();
const files = {};
const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(root, p).split(sep).join('/')] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
walk(join(root, 'api')); walk(join(root, 'schemas'));
delete files['schemas/CORPUS-STAMP.json'];
const stampPath = join(root, 'schemas', 'CORPUS-STAMP.json');
const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
stamp.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n');
console.log(`pack-vendor.sh: stamped ${Object.keys(files).length} vendored files with SHA-256 digests`);
NODE
echo "pack-vendor.sh: vendored api/ + schemas/ for npm pack (stamp ${SUITE_VERSION} @ ${CORPUS_COMMIT})"
