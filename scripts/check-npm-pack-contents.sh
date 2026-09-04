#!/usr/bin/env bash
# check-npm-pack-contents — verify npm tarball file lists before publish.

set -euo pipefail

SPEC_ROOT="."
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/openwop-npm-cache}"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/openwop-pack-contents.XXXXXX")

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "=== check-npm-pack-contents — auditing npm dry-run tarball contents ==="
echo

pack_json() {
  local pkg_dir="$1"
  local out_file="$2"
  (
    cd "$pkg_dir"
    npm_config_cache="$NPM_CACHE" npm pack --dry-run --json --silent
  ) >"$out_file"
}

# The TypeScript SDK pack-contents audit moved to the openwop-sdks repo with
# sdk/. The spec corpus's only publishable npm artifact is the conformance suite.
CONFORMANCE_JSON="$TMP_DIR/conformance-pack.json"

echo "  building conformance CLI dist/..."
(
  cd "$SPEC_ROOT/conformance"
  npm_config_cache="$NPM_CACHE" npm run build:cli >/dev/null
)

pack_json "$SPEC_ROOT/conformance" "$CONFORMANCE_JSON"

node - "$CONFORMANCE_JSON" <<'NODE'
const { readFileSync } = require('node:fs');

const [conformancePath] = process.argv.slice(2);

function readPack(path) {
  const raw = readFileSync(path, 'utf8');
  const start = raw.indexOf('[');
  if (start < 0) {
    throw new Error(`${path} did not contain npm pack JSON`);
  }
  const parsed = JSON.parse(raw.slice(start));
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`${path} should contain exactly one packed package`);
  }
  return parsed[0];
}

function filePaths(pack) {
  return pack.files.map((file) => file.path).sort();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoCommonLeaks(packageName, paths) {
  for (const path of paths) {
    assert(!path.includes('node_modules/'), `${packageName} packs node_modules content: ${path}`);
    assert(!path.includes('.DS_Store'), `${packageName} packs macOS metadata: ${path}`);
    assert(!path.endsWith('.tgz'), `${packageName} packs nested npm tarball: ${path}`);
  }
}

function assertAllowedRoots(packageName, paths, allowedRoots) {
  for (const path of paths) {
    const root = path.includes('/') ? path.slice(0, path.indexOf('/')) : path;
    assert(allowedRoots.has(root), `${packageName} packs unexpected top-level path: ${path}`);
  }
}

function assertIncludes(packageName, paths, requiredPaths) {
  const seen = new Set(paths);
  for (const path of requiredPaths) {
    assert(seen.has(path), `${packageName} tarball is missing required path: ${path}`);
  }
}

const conformancePack = readPack(conformancePath);
const conformanceFiles = filePaths(conformancePack);
assert(
  conformancePack.name === '@openwop/openwop-conformance',
  `unexpected conformance package name: ${conformancePack.name}`,
);
// @openwop/openwop-conformance tracks its own minor cadence per
// PUBLISHING.md §"Versioning alignment"; bump alongside the
// EXPECTED_CONFORMANCE_VERSION in openwop-check-publish-metadata.sh.
assert(conformancePack.version === '2.0.0-rc.23', `unexpected conformance package version: ${conformancePack.version}`);
assertNoCommonLeaks(conformancePack.name, conformanceFiles);
assertAllowedRoots(
  conformancePack.name,
  conformanceFiles,
  // Suite 2.0.0 (RFC 0168 §D.2): api/ and the schemas are the @openwop/spec-artifacts peer, not
  // tarball contents; schemas/ carries ONLY the provenance stamp copy hosts read.
  new Set(['CHANGELOG.md', 'LICENSE', 'README.md', 'coverage.md', 'dist', 'fixtures', 'fixtures.md', 'package.json', 'requirement-aliases.json', 'requirements.json', 'scenario-majors.json', 'schemas', 'src', 'vectors', 'vitest.config.ts']),
);
assertIncludes(conformancePack.name, conformanceFiles, [
  'LICENSE',
  'README.md',
  'package.json',
  'dist/cli.js',
  'dist/spec-artifacts.lock.json',
  'scenario-majors.json',
  // The contract copies a host is told to depend on instead of hand-vendoring
  // (conformance/README.md §"Resolving the contract"). Pinned by path because a
  // packaging change that dropped them would silently push hosts back to copying
  // files, which is the staleness RFC 0145 G2 is about.
  // The provenance stamp a host compares its hand-copied contract against
  // (RFC 0145 G2). It rides INSIDE schemas/ because the directory is what gets
  // copied — package.json's version does not survive `cp -R schemas/ vendor/`.
  'schemas/CORPUS-STAMP.json',
  'fixtures.md',
  'coverage.md',
]);

// Suite 1.156.0 — what the tarball must NOT carry: the suite's own self-tests and
// the corpus-coherence scenarios (they read spec/v1, assert nothing about a host,
// and reported `blocked`/`inapplicable` in every host bundle). A packaging change
// that let them back in would put rows about the spec into evidence about a host.
const forbidden = conformanceFiles.filter((f) => /^src\/lib\/.*\.test\.ts$/.test(f));
if (forbidden.length > 0) throw new Error(`conformance tarball carries suite self-tests: ${forbidden.join(', ')}`);
// Suite 2.0.0 (RFC 0168 §D.1): the corpus-coherence scenarios live in src/coherence/ and are never packed — one directory, no list to keep in sync.
const leaked = conformanceFiles.filter((f) => f.startsWith('src/coherence/') || f.startsWith('api/') || (f.startsWith('schemas/') && f !== 'schemas/CORPUS-STAMP.json'));
if (leaked.length > 0) throw new Error(`conformance tarball carries corpus-coherence scenarios or vendored contract files (the contract is the @openwop/spec-artifacts peer): ${leaked.join(', ')} — src/coherence/ is excluded by package.json files`);
console.log(`  ok: ${conformancePack.name}@${conformancePack.version} packs ${conformanceFiles.length} files with vendored contracts; 0 coherence scenarios and every src/lib self-test excluded.`);
NODE

if [[ -e "$SPEC_ROOT/conformance/api" || -e "$SPEC_ROOT/conformance/schemas" ]]; then
  echo "  FAIL: conformance prepack left vendored api/ or schemas/ directories in the worktree." >&2
  exit 1
fi
echo "  ok: conformance postpack removed vendored api/ and schemas/ directories."

echo
echo "=== check-npm-pack-contents OK — npm package contents are release-ready ==="
