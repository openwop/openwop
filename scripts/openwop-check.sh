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
#   7. Publish/package audit (metadata + npm/Python/Go release surfaces)
#   8. Security invariants — every protocol-tier MUST-NOT in
#      SECURITY/invariants.yaml has at least one matching public test.
#
# Mirror of .github/workflows/openwop-spec.yml — run this before pushing
# to skip the round-trip CI wait. Exits non-zero on any failure.
#
# Total runtime: ~30s on a warm cache.

set -euo pipefail

SPEC_ROOT="."
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/openwop-npm-cache}"

echo "=== openwop:check — validating $SPEC_ROOT/ ==="
echo

# 1. Conformance package — typecheck + server-free scenarios.
echo "[1/8] Conformance suite (typecheck + server-free scenarios)..."
(
  cd "$SPEC_ROOT/conformance"
  if [[ ! -d node_modules ]]; then
    echo "  installing conformance deps (one-time)..."
    npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  fi
  npx tsc --noEmit
  npx vitest run \
    src/scenarios/fixtures-valid.test.ts \
    src/scenarios/spec-corpus-validity.test.ts
)
echo

# 2. TypeScript SDK — typecheck.
echo "[2/8] TypeScript reference SDK (tsc)..."
(
  cd "$SPEC_ROOT/sdk/typescript"
  if [[ ! -d node_modules ]]; then
    echo "  installing SDK deps (one-time)..."
    npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  fi
  npx tsc --noEmit
)
echo

# 3. Python SDK — syntax check + import smoke. Mypy is NOT run here
# (it's an optional dev dep); contributors can `pip install -e .[dev]`
# and run mypy locally for a stricter check.
echo "[3/8] Python reference SDK (syntax + import smoke)..."
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
echo "[4/8] Go reference SDK (go vet + tests)..."
(
  cd "$SPEC_ROOT/sdk/go"
  if ! command -v go >/dev/null 2>&1; then
    echo "  WARN: go binary not found; skipping Go SDK vet/tests."
  else
    export GOCACHE="${GOCACHE:-/private/tmp/openwop-go-build-cache}"
    go vet ./...
    go test ./...
  fi
)
echo

# 5. OpenAPI lint via redocly.
echo "[5/8] OpenAPI 3.1 (redocly lint)..."
(
  cd "$SPEC_ROOT/api"
  npm_config_cache="$NPM_CACHE" npx -y -p @redocly/cli@latest redocly lint openapi.yaml
)
echo

# 6. AsyncAPI validate.
echo "[6/8] AsyncAPI 3.1 (asyncapi validate)..."
npm_config_cache="$NPM_CACHE" npx -y -p @asyncapi/cli@latest asyncapi validate "$SPEC_ROOT/api/asyncapi.yaml"
echo

# 7. Publish-metadata + package-content audit — catches placeholder URLs,
# stale module paths, package posture drift, and package content leaks.
echo "[7/8] Publish metadata + package contents..."
"$(dirname "$0")/openwop-check-publish-metadata.sh"
"$(dirname "$0")/check-npm-pack-contents.sh"
"$(dirname "$0")/check-python-go-release-surface.sh"
echo

# 8. Security invariants — every protocol-tier MUST-NOT in
# SECURITY/invariants.yaml has at least one matching public test.
echo "[8/8] Security invariants..."
"$(dirname "$0")/check-security-invariants.sh"
echo

echo "=== openwop:check OK — spec corpus is internally consistent ==="
