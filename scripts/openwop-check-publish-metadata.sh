#!/usr/bin/env bash
# openwop-check-publish-metadata — defensive pre-publish metadata audit.
#
# Catches the class of bugs the openwop-package-release session found in
# 2026-04-29 P3 hardening: placeholder URLs, stale module paths, missing
# repository fields, etc. Run as part of `openwop-check.sh` (stage 7) so any
# regression is caught before a tag push activates the publish workflow.
#
# Exits 0 if all checks pass, 1 if any fail.
#
# Scope: metadata only. SDK source code logic is owned by the SDK tests and
# package-content audits; this script doesn't touch it.

set -euo pipefail

SPEC_ROOT="."
EXPECTED_REPO="github.com/openwop/openwop"
EXPECTED_GO_MODULE="${EXPECTED_REPO}/sdk/go"
EXPECTED_NPM_SCOPE="@openwop"
EXPECTED_V1_VERSION="1.1.5"
# `@openwop/openwop-conformance` independently bumps minors as conformance
# scenarios are added/removed, per `PUBLISHING.md` §"Versioning alignment"
# ("Conformance scenario addition | @openwop/openwop-conformance minor
# bump; other artifacts unaffected."). The SDK + Python + Go artifacts
# stay locked to EXPECTED_V1_VERSION until the next coordinated spec-
# corpus release. Bump this when the next `openwop-conformance/v*` tag
# rolls.
EXPECTED_CONFORMANCE_VERSION="1.18.0"
# The TypeScript SDK floats its patch version independently within the v1
# major, per PUBLISHING.md §"Versioning alignment" ("within a major, SDK
# patch versions float independently") + the `openwop/v*` SDK-only release
# tag. It publishes ahead of the coordinated corpus version when the SDK
# surface gains additive wrappers between corpus releases. Bump this when
# the next `openwop/v*` (or coordinated `v*`) tag rolls.
EXPECTED_TS_SDK_VERSION="1.1.6"
fail=0

err() { echo "  FAIL: $*" >&2; fail=1; }
ok()  { echo "  ok:   $*"; }

echo "=== openwop:check:publish-metadata — auditing publishable manifests ==="
echo

# 1. Python pyproject.toml — no placeholder URLs.
echo "[1/12] Python pyproject.toml URLs..."
PYPROJECT="$SPEC_ROOT/sdk/python/pyproject.toml"
if grep -qE "github.com/example|github.com/openwop-spec/openwop-client-go" "$PYPROJECT"; then
  err "$PYPROJECT contains a placeholder URL (github.com/example or openwop-spec/openwop-client-go)."
  grep -nE "github.com/example|github.com/openwop-spec/openwop-client-go" "$PYPROJECT" >&2
elif ! grep -qE "github.com/openwop/openwop" "$PYPROJECT"; then
  err "$PYPROJECT does not reference the canonical repo $EXPECTED_REPO."
else
  ok "$PYPROJECT references $EXPECTED_REPO."
fi

# 2. Go go.mod — module path matches expected pattern.
echo "[2/12] Go go.mod module path..."
GOMOD="$SPEC_ROOT/sdk/go/go.mod"
GO_MODULE_LINE=$(grep -E "^module " "$GOMOD" || true)
if [[ -z "$GO_MODULE_LINE" ]]; then
  err "$GOMOD has no module declaration."
elif [[ "$GO_MODULE_LINE" != "module $EXPECTED_GO_MODULE" ]]; then
  err "$GOMOD module path is '$GO_MODULE_LINE', expected 'module $EXPECTED_GO_MODULE'."
else
  ok "$GOMOD declares 'module $EXPECTED_GO_MODULE'."
fi

# 3. Publishable npm packages — `private: true` is a publish-blocker. We
#    keep `private: true` set in-tree as a deliberate gate (per PUBLISHING.md
#    pre-publish checklist) — flag this as a warning, not a failure, so the
#    user remembers to flip it at publish time. The script still exits 0
#    if this is the only "issue".
echo "[3/12] npm packages with private:true (publish gate reminder)..."
for PKG in "$SPEC_ROOT/sdk/typescript/package.json" "$SPEC_ROOT/conformance/package.json"; do
  if grep -qE '"private":\s*true' "$PKG"; then
    echo "  reminder: $PKG has \"private\": true — must be removed (or set to false) before \`npm publish\`."
  else
    ok "$PKG is not marked private."
  fi
done

# 4. PUBLISHING.md — Go SDK module path table entry matches go.mod.
echo "[4/12] PUBLISHING.md ↔ go.mod consistency..."
PUBLISHING="$SPEC_ROOT/PUBLISHING.md"
if ! grep -qE "openwopclient" "$PUBLISHING"; then
  err "$PUBLISHING does not mention the Go package name 'openwopclient'."
elif grep -qE "github.com/openwop-spec/openwop-client-go|github.com/example" "$PUBLISHING"; then
  err "$PUBLISHING references a stale or placeholder URL."
  grep -nE "github.com/openwop-spec/openwop-client-go|github.com/example" "$PUBLISHING" >&2
else
  ok "$PUBLISHING is consistent with go.mod."
fi

# 5. SDK READMEs — no stale `openwop-spec/openwop-client-go` import paths.
echo "[5/12] SDK READMEs — no stale import paths..."
for README in "$SPEC_ROOT/sdk/typescript/README.md" "$SPEC_ROOT/sdk/python/README.md" "$SPEC_ROOT/sdk/go/README.md" "$SPEC_ROOT/conformance/README.md"; do
  if grep -qE "github.com/example|github.com/openwop-spec/openwop-client-go" "$README"; then
    err "$README references a stale or placeholder URL."
    grep -nE "github.com/example|github.com/openwop-spec/openwop-client-go" "$README" >&2
  else
    ok "$README is clean."
  fi
done

# 6. npm package.json names — must use the chosen $EXPECTED_NPM_SCOPE,
#    never the placeholder `@openwop/` scope. (The "@openwop/protocol decision"
#    section in PUBLISHING.md and the §7 Q2 closure entry both keep
#    "@openwop/protocol" verbatim as historical context — that's text in
#    docs, not a manifest "name" field, so it doesn't trip this check.)
echo "[6/12] npm package names use $EXPECTED_NPM_SCOPE scope..."
for PKG in "$SPEC_ROOT/sdk/typescript/package.json" "$SPEC_ROOT/conformance/package.json"; do
  PKG_NAME=$(grep -E '"name":' "$PKG" | head -1 | sed -E 's/.*"name":[[:space:]]*"([^"]+)".*/\1/')
  if [[ "$PKG_NAME" != ${EXPECTED_NPM_SCOPE}/* ]]; then
    err "$PKG has name '$PKG_NAME' — does not start with $EXPECTED_NPM_SCOPE/."
  else
    ok "$PKG name '$PKG_NAME' is under $EXPECTED_NPM_SCOPE/."
  fi
done

# 7. LICENSE file present in every publishable artifact directory. npm
#    pack and PyPI both look for a sibling LICENSE; without one the
#    published artifact ships unlicensed regardless of the manifest's
#    `license` field.
echo "[7/12] LICENSE file in each publish directory..."
for DIR in "$SPEC_ROOT/sdk/typescript" "$SPEC_ROOT/sdk/python" "$SPEC_ROOT/sdk/go" "$SPEC_ROOT/conformance"; do
  if [[ -f "$DIR/LICENSE" ]]; then
    ok "$DIR/LICENSE exists."
  else
    err "$DIR/LICENSE missing — published package will ship unlicensed."
  fi
done

# 8. v1.0 reset — all publishable package manifests must agree that this
#    repo is being cut as OpenWOP v1.0.0. Old copied WOP-era package
#    versions such as conformance 1.18.x/1.19.x are point-in-time artifacts,
#    not valid OpenWOP release metadata.
echo "[8/12] v1.0 manifest version alignment..."
TS_PKG="$SPEC_ROOT/sdk/typescript/package.json"
TS_VERSION=$(grep -E '"version":' "$TS_PKG" | head -1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')
if [[ "$TS_VERSION" != "$EXPECTED_TS_SDK_VERSION" ]]; then
  err "$TS_PKG has version '$TS_VERSION', expected '$EXPECTED_TS_SDK_VERSION'."
else
  ok "$TS_PKG version is $EXPECTED_TS_SDK_VERSION."
fi
# Conformance package tracks its own minor cadence per PUBLISHING.md
# §"Versioning alignment" — checked against EXPECTED_CONFORMANCE_VERSION.
CONF_PKG="$SPEC_ROOT/conformance/package.json"
CONF_VERSION=$(grep -E '"version":' "$CONF_PKG" | head -1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')
if [[ "$CONF_VERSION" != "$EXPECTED_CONFORMANCE_VERSION" ]]; then
  err "$CONF_PKG has version '$CONF_VERSION', expected '$EXPECTED_CONFORMANCE_VERSION'."
else
  ok "$CONF_PKG version is $EXPECTED_CONFORMANCE_VERSION."
fi
PY_VERSION=$(grep -E '^version = ' "$PYPROJECT" | head -1 | sed -E 's/version = "([^"]+)"/\1/')
if [[ "$PY_VERSION" != "$EXPECTED_V1_VERSION" ]]; then
  err "$PYPROJECT has version '$PY_VERSION', expected '$EXPECTED_V1_VERSION'."
else
  ok "$PYPROJECT version is $EXPECTED_V1_VERSION."
fi

# 9. Example and site packages are not publishable artifacts, but they are
#    part of the public release surface. Keep them under the OpenWOP scope,
#    pinned to the v1.0 baseline, and private so npm publish workflows cannot
#    accidentally ship demos or generated site assets.
echo "[9/12] example/site package release metadata..."
for PKG in \
  "$SPEC_ROOT"/examples/*/package.json \
  "$SPEC_ROOT"/examples/hosts/*/package.json \
  "$SPEC_ROOT"/site/package.json; do
  PKG_NAME=$(grep -E '"name":' "$PKG" | head -1 | sed -E 's/.*"name":[[:space:]]*"([^"]+)".*/\1/')
  PKG_VERSION=$(grep -E '"version":' "$PKG" | head -1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')
  if [[ "$PKG_NAME" != ${EXPECTED_NPM_SCOPE}/* ]]; then
    err "$PKG has name '$PKG_NAME' — does not start with $EXPECTED_NPM_SCOPE/."
  elif [[ "$PKG_VERSION" != "$EXPECTED_V1_VERSION" ]]; then
    err "$PKG has version '$PKG_VERSION', expected '$EXPECTED_V1_VERSION'."
  elif ! grep -qE '"private":\s*true' "$PKG"; then
    err "$PKG is a demo/site package and must remain private."
  else
    ok "$PKG is private and aligned to $EXPECTED_V1_VERSION."
  fi
done

# 10. Reference hosts advertise v1.0 metadata in discovery/OpenAPI surfaces.
#     A copied 0.x sample version here is user-visible and makes the examples
#     look pre-release even when the spec and packages are v1.0.
echo "[10/12] reference host advertised versions..."
for HOST in \
  "$SPEC_ROOT/examples/hosts/in-memory/src/server.ts" \
  "$SPEC_ROOT/examples/hosts/sqlite/src/server.ts"; do
  if grep -qE "version:[[:space:]]*'0\\.|version:[[:space:]]*\"0\\.|info:[^{]*\\{[^}]*version:[[:space:]]*'0\\.|protocolVersion:[[:space:]]*'0\\." "$HOST"; then
    err "$HOST advertises stale 0.x host/API metadata."
    grep -nE "version:[[:space:]]*'0\\.|version:[[:space:]]*\"0\\.|protocolVersion:[[:space:]]*'0\\." "$HOST" >&2
  elif ! grep -qE "version:[[:space:]]*'${EXPECTED_V1_VERSION}'|version:[[:space:]]*\"${EXPECTED_V1_VERSION}\"" "$HOST"; then
    err "$HOST does not advertise host/API version $EXPECTED_V1_VERSION."
  else
    ok "$HOST advertises v1.0 release metadata."
  fi
done

# 11. Release posture — manifests and publishing docs must describe a
#    production-ready v1.0 release, not alpha/deferred/live-history copy
#    inherited from earlier WOP-era artifacts.
echo "[11/12] production-release posture language..."
for FILE in \
  "$SPEC_ROOT/sdk/typescript/package.json" \
  "$SPEC_ROOT/conformance/package.json" \
  "$SPEC_ROOT/sdk/python/pyproject.toml" \
  "$SPEC_ROOT/PUBLISHING.md"; do
  if grep -qE "G10 phase 2|deferred work|first .*publication|Development Status :: 3 - Alpha|1\\.18\\.6|1\\.19\\.1|v19" "$FILE"; then
    err "$FILE contains stale non-v1.0 release posture language."
    grep -nE "G10 phase 2|deferred work|first .*publication|Development Status :: 3 - Alpha|1\\.18\\.6|1\\.19\\.1|v19" "$FILE" >&2
  else
    ok "$FILE has v1.0 production-release posture."
  fi
done

# 12. Package contents — keep test-only files out of runtime SDK
#    tarballs. The TypeScript SDK includes src/ for sourcemap/debuggability,
#    but tests are not part of the public runtime surface.
echo "[12/12] runtime package file allowlists..."
TS_PACKAGE="$SPEC_ROOT/sdk/typescript/package.json"
if grep -qE '"src"' "$TS_PACKAGE" && ! grep -qE '"!src/__tests__"' "$TS_PACKAGE"; then
  err "$TS_PACKAGE includes src/ but does not exclude src/__tests__ from npm pack."
else
  ok "$TS_PACKAGE excludes TypeScript SDK tests from npm pack."
fi

echo
if (( fail )); then
  echo "=== openwop:check:publish-metadata FAILED — fix the issues above ==="
  exit 1
fi
echo "=== openwop:check:publish-metadata OK — manifests are publish-ready ==="
