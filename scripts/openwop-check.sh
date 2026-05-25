#!/usr/bin/env bash
# openwop-check — one-shot validation of the openwop spec corpus.
#
# Runs server-free checks across all artifacts:
#   1. JSON Schemas compile + fixtures validate (vitest server-free subset)
#   2. TypeScript SDK builds clean (tsc)
#   3. Python SDK passes syntax + import smoke
#   4. Go SDK passes go vet + tests (skipped if Go is not installed)
#   5. OpenAPI lints clean (redocly)
#   6. AsyncAPI validates (asyncapi-cli)
#   7. Generated protocol status + active-doc stale-status guard
#   8. Publish/package audit (metadata + npm/Python/Go release surfaces)
#   9. Security invariants — every protocol-tier MUST-NOT in
#      SECURITY/invariants.yaml has at least one matching public test.
#
# Mirror of .github/workflows/openwop-spec.yml — run this before pushing
# to skip the round-trip CI wait. Exits non-zero on any failure.
#
# Total runtime: ~30s on a warm cache.

set -euo pipefail

SPEC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/openwop-npm-cache}"
ROOT_NODE_BIN="$SPEC_ROOT/node_modules/.bin"

# Stale npm _locks left from killed earlier invocations cause
# `ECOMPROMISED Lock compromised` on the next run. The locks are advisory
# and safe to wipe at gate start; npm regenerates whatever it needs. This
# class of failure was historically much more common when steps 5/6 used
# an ad-hoc package executor with `@latest` — one network fetch into the cache per gate
# run, racing itself when concurrent runs interleaved. The validator CLIs
# now live as pinned repo-root devDependencies and the gate invokes the
# local bins directly, so there is no per-run `npx` package resolution.
# The lock-wipe stays as belt-and-suspenders safety because npm install
# can still leave advisory locks behind if interrupted.
rm -rf "$NPM_CACHE/_locks" 2>/dev/null || true

ensure_root_validator_deps() {
  if [[ ! -x "$ROOT_NODE_BIN/redocly" || ! -x "$ROOT_NODE_BIN/asyncapi" ]]; then
    echo "  installing root validator deps (one-time)..."
    (
      cd "$SPEC_ROOT"
      npm_config_cache="$NPM_CACHE" npm install --legacy-peer-deps --no-audit --no-fund --prefer-offline >/dev/null
    )
  fi
}

echo "=== openwop:check — validating $SPEC_ROOT/ ==="
echo

# 1. TypeScript SDK — build first (emits dist/) so step 2's corpus-validity
# test can assert against the dist artifacts. Order matters: the conformance
# corpus-validity test in step 2 reads sdk/typescript/dist/*.map.
echo "[1/9] TypeScript reference SDK (build + emit dist/)..."
(
  cd "$SPEC_ROOT/sdk/typescript"
  if [[ ! -d node_modules ]]; then
    echo "  installing SDK deps (one-time)..."
    npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  fi
  # `npm run build` does `rm -rf dist && tsc -p tsconfig.build.json` —
  # produces dist/*.js + dist/*.d.ts + dist/*.map.
  npm run build >/dev/null
)
echo

# 2. Conformance package — typecheck + server-free scenarios.
echo "[2/9] Conformance suite (typecheck + server-free scenarios)..."
(
  cd "$SPEC_ROOT/conformance"
  if [[ ! -d node_modules ]]; then
    echo "  installing conformance deps (one-time)..."
    npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  fi
  npx tsc --noEmit
  npx vitest run \
    src/scenarios/fixtures-valid.test.ts \
    src/scenarios/spec-corpus-validity.test.ts \
    src/scenarios/ai-envelope-shape.test.ts
)
echo

# 3. Python SDK — syntax check + import smoke. Mypy is NOT run here
# (it's an optional dev dep); contributors can `pip install -e .[dev]`
# and run mypy locally for a stricter check.
echo "[3/9] Python reference SDK (syntax + import smoke)..."
(
  cd "$SPEC_ROOT/sdk/python"
  PY=$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)
  if [[ -z "$PY" ]]; then
    echo "  WARN: no python3.10+ found; skipping Python SDK smoke."
  else
    for f in src/openwop_client/*.py; do
      "$PY" -c "import ast; ast.parse(open('$f').read())" || exit 1
    done
    "$PY" -c "import sys; sys.path.insert(0, 'src'); import openwop_client; print('  openwop_client', openwop_client.__version__, 'imports clean')"
    if [[ -d tests ]]; then
      PYTHONPATH=src "$PY" -m unittest discover -s tests
    fi
  fi
)
echo

# 4. Go SDK — go vet + tests (skipped if Go not installed).
echo "[4/9] Go reference SDK (go vet + tests)..."
(
  cd "$SPEC_ROOT/sdk/go"
  if ! command -v go >/dev/null 2>&1; then
    echo "  WARN: go binary not found; skipping Go SDK vet/tests."
  else
    export GOCACHE="${GOCACHE:-/tmp/openwop-go-build-cache}"
    go vet ./...
    go test ./...
  fi
)
echo

# 5. OpenAPI lint via redocly. Uses the repo-root pinned devDependency.
echo "[5/9] OpenAPI 3.1 (redocly lint)..."
ensure_root_validator_deps
(
  cd "$SPEC_ROOT/api"
  "$ROOT_NODE_BIN/redocly" lint openapi.yaml
)
echo

# 6. AsyncAPI validate. Same pinning as step 5. `@asyncapi/cli@4.1.1` is
# the last release compatible with Node 22 (5.x requires Node 24+).
echo "[6/9] AsyncAPI 3.1 (asyncapi validate)..."
"$ROOT_NODE_BIN/asyncapi" validate "$SPEC_ROOT/api/asyncapi.yaml"
echo

# 7. Generated protocol status — catches stale corpus counts, RFC status
# drift, registry-count drift, SDK parity-count drift, and active-doc stale
# phrases that should not survive outside archived historical docs. Also
# guards against silent drift between sanctioned duplicate-source files
# (RFC 0013 expansion algorithm: spec-authoritative copy in conformance/
# vs. zero-deps mirror in examples/hosts/in-memory/). Plus the required-
# property typo-catcher (replaces redocly's flawed walker — see
# api/redocly.yaml comment for context).
echo "[7/9] Generated protocol status..."
node "$SPEC_ROOT/scripts/generate-protocol-status.mjs" --check
node "$SPEC_ROOT/scripts/check-workflow-chain-expansion-sync.mjs"
node "$SPEC_ROOT/scripts/check-required-properties-defined.mjs"
# Backend dep-graph sanity — every external import in apps/workflow-engine/
# backend/typescript/src/ MUST be declared in its package.json. Catches the
# class of bug where local hoisting masks a missing dep that breaks Cloud
# Run's `npm ci`-isolated install (cf. ajv-formats / 2026-05-21 deploy thrash).
node "$SPEC_ROOT/scripts/check-backend-dep-graph.mjs"
# Workflow-engine sample bundles a vendored copy of conformance/fixtures/
# into its Docker image (apps/workflow-engine/conformance-fixtures/, per
# the Dockerfile + scripts/sync-fixtures.sh). Catch silent drift: if the
# vendored copy gets out of sync, the deployed sample BE will serve
# stale fixtures that don't match what the conformance suite asserts.
SAMPLE_VENDORED="$SPEC_ROOT/apps/workflow-engine/conformance-fixtures"
CANONICAL_FIXTURES="$SPEC_ROOT/conformance/fixtures"
if [ -d "$SAMPLE_VENDORED" ] && [ -d "$CANONICAL_FIXTURES" ]; then
  if ! diff -rq "$CANONICAL_FIXTURES" "$SAMPLE_VENDORED" >/dev/null 2>&1; then
    echo "  FAIL: apps/workflow-engine/conformance-fixtures/ is out of sync with conformance/fixtures/" >&2
    echo "  Run: bash apps/workflow-engine/scripts/sync-fixtures.sh" >&2
    diff -rq "$CANONICAL_FIXTURES" "$SAMPLE_VENDORED" >&2
    exit 1
  fi
  echo "  ok: workflow-engine vendored conformance-fixtures in sync"
fi
echo

# 8. Publish-metadata + package-content audit — catches placeholder URLs,
# stale module paths, package posture drift, and package content leaks.
echo "[8/9] Publish metadata + package contents..."
"$(dirname "$0")/openwop-check-publish-metadata.sh"
"$(dirname "$0")/check-npm-pack-contents.sh"
"$(dirname "$0")/check-python-go-release-surface.sh"
echo

# 9. Security invariants — every protocol-tier MUST-NOT in
# SECURITY/invariants.yaml has at least one matching public test.
echo "[9/9] Security invariants..."
"$(dirname "$0")/check-security-invariants.sh"
echo

echo "=== openwop:check OK — spec corpus is internally consistent ==="
