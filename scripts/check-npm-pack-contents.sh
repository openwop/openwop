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

TS_JSON="$TMP_DIR/typescript-pack.json"
CONFORMANCE_JSON="$TMP_DIR/conformance-pack.json"

echo "  building TypeScript SDK dist/..."
(
  cd "$SPEC_ROOT/sdk/typescript"
  npm_config_cache="$NPM_CACHE" npm run build >/dev/null
)

echo "  building conformance CLI dist/..."
(
  cd "$SPEC_ROOT/conformance"
  npm_config_cache="$NPM_CACHE" npm run build:cli >/dev/null
)

pack_json "$SPEC_ROOT/sdk/typescript" "$TS_JSON"
pack_json "$SPEC_ROOT/conformance" "$CONFORMANCE_JSON"

node - "$TS_JSON" "$CONFORMANCE_JSON" <<'NODE'
const { readFileSync } = require('node:fs');

const [typescriptPath, conformancePath] = process.argv.slice(2);

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

const tsPack = readPack(typescriptPath);
const tsFiles = filePaths(tsPack);
assert(tsPack.name === '@openwop/openwop', `unexpected TypeScript package name: ${tsPack.name}`);
assert(tsPack.version === '1.1.1', `unexpected TypeScript package version: ${tsPack.version}`);
assertNoCommonLeaks(tsPack.name, tsFiles);
assertAllowedRoots(tsPack.name, tsFiles, new Set(['LICENSE', 'README.md', 'dist', 'package.json', 'src']));
assertIncludes(tsPack.name, tsFiles, [
  'LICENSE',
  'README.md',
  'package.json',
  'dist/index.d.ts',
  'dist/index.js',
  'src/index.ts',
]);
for (const path of tsFiles) {
  assert(!path.includes('__tests__/'), `${tsPack.name} packs test directory: ${path}`);
  assert(!path.endsWith('.test.ts'), `${tsPack.name} packs test source: ${path}`);
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
assert(conformancePack.version === '1.3.0', `unexpected conformance package version: ${conformancePack.version}`);
assertNoCommonLeaks(conformancePack.name, conformanceFiles);
assertAllowedRoots(
  conformancePack.name,
  conformanceFiles,
  new Set(['CHANGELOG.md', 'LICENSE', 'README.md', 'api', 'coverage.md', 'dist', 'fixtures', 'fixtures.md', 'package.json', 'schemas', 'src', 'vitest.config.ts']),
);
assertIncludes(conformancePack.name, conformanceFiles, [
  'LICENSE',
  'README.md',
  'package.json',
  'dist/cli.js',
  'api/openapi.yaml',
  'api/asyncapi.yaml',
  'schemas/README.md',
  'fixtures.md',
  'coverage.md',
]);

console.log(`  ok: ${tsPack.name}@${tsPack.version} packs ${tsFiles.length} files without tests or stray metadata.`);
console.log(`  ok: ${conformancePack.name}@${conformancePack.version} packs ${conformanceFiles.length} files with vendored contracts.`);
NODE

if [[ -e "$SPEC_ROOT/conformance/api" || -e "$SPEC_ROOT/conformance/schemas" ]]; then
  echo "  FAIL: conformance prepack left vendored api/ or schemas/ directories in the worktree." >&2
  exit 1
fi
echo "  ok: conformance postpack removed vendored api/ and schemas/ directories."

echo
echo "=== check-npm-pack-contents OK — npm package contents are release-ready ==="
