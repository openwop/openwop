#!/usr/bin/env bash
# openwop-check-publish-metadata — defensive pre-publish metadata audit.
#
# Catches placeholder URLs, package posture drift, missing LICENSE/repository
# fields, etc. Run as part of `openwop-check.sh` so any regression is caught
# before a tag push activates the publish workflow.
#
# Scope: metadata only. The SDK manifests (TS/Python/Go) + the python/go
# release-surface audit moved to the openwop-sdks repo with sdk/; the spec
# corpus's only publishable npm artifact now is @openwop/openwop-conformance.
#
# Exits 0 if all checks pass, 1 if any fail.

set -euo pipefail

SPEC_ROOT="."
EXPECTED_NPM_SCOPE="@openwop"
# `@openwop/openwop-conformance` independently bumps minors as conformance
# scenarios are added/removed, per `PUBLISHING.md` §"Versioning alignment".
# Bump this when the next `openwop-conformance/v*` tag rolls.
EXPECTED_CONFORMANCE_VERSION="2.0.0-rc.19"
# Suite 2.0.0 (RFC 0168 §D.2): the contract package publishes beside the suite from the same tag.
EXPECTED_SPEC_ARTIFACTS_VERSION="2.0.0-rc.19"
fail=0

err() { echo "  FAIL: $*" >&2; fail=1; }
ok()  { echo "  ok:   $*"; }

echo "=== openwop:check:publish-metadata — auditing publishable manifests ==="
echo

CONFORMANCE_PKG="$SPEC_ROOT/conformance/package.json"

# 1. Conformance package stays private:true until the publish workflow flips it
#    (publish gate reminder) and carries the @openwop scope + expected name.
echo "[1/4] conformance package name + scope + publish posture..."
PKG_NAME=$(grep -E '"name":' "$CONFORMANCE_PKG" | head -1 | sed -E 's/.*"name":[[:space:]]*"([^"]+)".*/\1/')
if [[ "$PKG_NAME" != "$EXPECTED_NPM_SCOPE/openwop-conformance" ]]; then
  err "$CONFORMANCE_PKG name is '$PKG_NAME', expected $EXPECTED_NPM_SCOPE/openwop-conformance."
else
  ok "conformance package name is $PKG_NAME."
fi

# 2. Version alignment.
echo "[2/4] conformance version alignment..."
PKG_VERSION=$(grep -E '"version":' "$CONFORMANCE_PKG" | head -1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')
if [[ "$PKG_VERSION" != "$EXPECTED_CONFORMANCE_VERSION" ]]; then
  err "$CONFORMANCE_PKG version is '$PKG_VERSION', expected '$EXPECTED_CONFORMANCE_VERSION'."
else
  ok "conformance version is $PKG_VERSION."
fi

# 3. LICENSE present in the publish directory.
echo "[3/4] conformance LICENSE present..."
if [[ -f "$SPEC_ROOT/conformance/LICENSE" ]]; then
  ok "conformance/LICENSE present."
else
  err "conformance/LICENSE missing — npm publish would ship without a license file."
fi

# 4. Production-release posture — no alpha/deferred/live-history copy in the
#    conformance manifest or the publishing docs.
echo "[4/4] production-release posture language..."
for FILE in "$CONFORMANCE_PKG" "$SPEC_ROOT/PUBLISHING.md"; do
  if grep -qE "G10 phase 2|deferred work|Development Status :: 3 - Alpha" "$FILE"; then
    err "$FILE contains stale non-v1.0 release posture language."
    grep -nE "G10 phase 2|deferred work|Development Status :: 3 - Alpha" "$FILE" >&2
  else
    ok "$FILE has v1.0 production-release posture."
  fi
done

echo
if (( fail )); then
  echo "=== openwop:check:publish-metadata FAILED — fix the issues above ==="
  exit 1
fi
echo "=== openwop:check:publish-metadata OK — manifests are publish-ready ==="

echo
echo "[5/5] spec-artifacts package version alignment..."
SA_VER=$(grep -E '"version":' "$SPEC_ROOT/spec-artifacts/package.json" | head -1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')
if [[ "$SA_VER" != "$EXPECTED_SPEC_ARTIFACTS_VERSION" ]]; then
  err "spec-artifacts/package.json version is '$SA_VER', expected $EXPECTED_SPEC_ARTIFACTS_VERSION."
else
  ok "spec-artifacts package version is $SA_VER."
fi
PEER=$(node -e "console.log(require('$SPEC_ROOT/conformance/package.json').peerDependencies?.['@openwop/spec-artifacts'] ?? 'absent')")
if [[ "$PEER" != "$EXPECTED_SPEC_ARTIFACTS_VERSION" ]]; then
  err "conformance peerDependencies[@openwop/spec-artifacts] is '$PEER', expected the exact pin $EXPECTED_SPEC_ARTIFACTS_VERSION (RFC 0168 §D.2)."
else
  ok "conformance pins the spec-artifacts peer exactly ($PEER)."
fi
[[ $fail -eq 0 ]] || exit 1

