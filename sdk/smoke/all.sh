#!/usr/bin/env bash
# Run all three SDK smokes against a running SQLite reference host.
# Exit non-zero if any of them fail.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

OPENWOP_BASE_URL="${OPENWOP_BASE_URL:-http://127.0.0.1:3838}"
OPENWOP_API_KEY="${OPENWOP_API_KEY:-openwop-sqlite-dev-key}"
export OPENWOP_BASE_URL OPENWOP_API_KEY

echo "Target host: ${OPENWOP_BASE_URL}"
echo

results=()

run() {
  local label=$1
  shift
  echo "▶ ${label}: $*"
  if "$@"; then
    results+=("✅ ${label}")
  else
    results+=("❌ ${label}")
  fi
  echo
}

# TypeScript smoke
run "ts " \
  npx --prefix "${REPO_ROOT}/sdk/typescript" tsx "${SCRIPT_DIR}/smoke.ts"

# Python smoke
run "py " python3 "${SCRIPT_DIR}/smoke.py"

# Go smoke
run "go " bash -c "cd '${SCRIPT_DIR}' && go run smoke.go"

echo "Summary:"
for r in "${results[@]}"; do
  echo "  ${r}"
done

# Exit non-zero on any failure
for r in "${results[@]}"; do
  case "${r}" in
    ❌*) exit 1 ;;
  esac
done
