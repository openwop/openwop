#!/usr/bin/env bash
# RFC 0154 §E / acceptance "provenance attestations verify from a clean checkout"
# — the suite + SDK half, runnable by anyone with npm and network.
#
# Both `@openwop/openwop-conformance` (this repo, `openwop-publish.yml`) and
# `@openwop/openwop` (openwop-sdks, `publish.yml`) publish with
# `npm publish --provenance` under GitHub OIDC, so the registry holds a SLSA
# provenance v1 attestation binding each tarball's digest to the source commit
# and the workflow that built it. This script installs the two packages into an
# EMPTY directory (a clean checkout has nothing to reuse) and asks npm to
# verify registry signatures AND attestations. It exits non-zero if either
# package lacks a verified attestation — a substituted tarball, a build outside
# the workflow, or a registry that dropped the attestation all fail here.
#
# What it proves: integrity + build provenance of the published artifacts.
# What it does NOT prove: conformance, or anything about packs (openwop-registry
# publishes its own attestations; verify those with `openwop-registry:registry/
# scripts/verify-signatures.mjs`).
#
#   bash scripts/verify-published-provenance.sh                 # latest of both
#   bash scripts/verify-published-provenance.sh 1.129.0 1.7.0   # pinned
set -euo pipefail
SUITE_VERSION="${1:-latest}"
SDK_VERSION="${2:-latest}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund "@openwop/openwop-conformance@${SUITE_VERSION}" "@openwop/openwop@${SDK_VERSION}"
echo "installed: $(npm ls --json --depth=0 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')).dependencies;console.log(Object.entries(d).map(([k,v])=>k+'@'+v.version).join(', '))")"
# `npm audit signatures` verifies every installed package's registry signature
# and, where the registry holds one, its provenance attestation; the JSON form
# lists `invalid` and `missing` packages (empty on success) and the human form
# prints the verified counts. Run both: the JSON is the assertion, the text is
# the evidence a reader wants to see.
npm audit signatures 2>&1 | sed 's/^/  /'
OUT="$(npm audit signatures --json 2>/dev/null || true)"
node - "$OUT" <<'JS'
const report = JSON.parse(process.argv[2] || '{}');
const want = ['@openwop/openwop-conformance', '@openwop/openwop'];
const failures = [];
for (const name of want) {
  if ((report.invalid ?? []).some((p) => p.name === name)) failures.push(`${name}: INVALID signature/attestation`);
  if ((report.missing ?? []).some((p) => p.name === name)) failures.push(`${name}: MISSING registry signature`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
JS
# Belt and braces: the registry metadata itself must reference a SLSA v1 provenance for each pinned tarball.
for pkg in "@openwop/openwop-conformance@${SUITE_VERSION}" "@openwop/openwop@${SDK_VERSION}"; do
  PT="$(npm view "$pkg" dist.attestations.provenance.predicateType 2>/dev/null || true)"
  if [ "$PT" != "https://slsa.dev/provenance/v1" ]; then
    echo "FAIL: $pkg has no SLSA provenance v1 attestation in registry metadata (got: '${PT}')" >&2
    exit 1
  fi
  echo "ok: $pkg → $PT"
done
echo "=== verify-published-provenance OK — both packages carry verified registry signatures + SLSA provenance v1 attestations ==="
