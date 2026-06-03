#!/usr/bin/env bash
# build-whitelabel-zip — package the white-label demo app as a downloadable
# source zip for the /install/ page on openwop.dev.
#
# Uses `git archive` on the `apps/workflow-engine` subtree, so the zip contains
# ONLY tracked files: the backend + frontend source, WHITE-LABEL.md, DEPLOY.md,
# providers.json, etc. `node_modules/`, `dist/`, `data/`, and key material are
# untracked / gitignored so they never appear. The output is deterministic per
# commit (git archive stamps the commit time, not the wall clock).
#
# .env* CAVEAT: `frontend/react/.env.production` IS tracked (the steward's own
# CI/deploy builds load it), so `git archive` WOULD ship it — leaking the
# steward's backend SSE URL + Firebase project into every adopter's bundle (an
# adopter's `npm run build` auto-loads .env.production → their PRODUCTION app
# phones home to the steward). gitignore can't help a tracked file, so we
# explicitly STRIP every .env* from the distributable below; adopters supply
# their own per WHITE-LABEL.md.
#
# Output (both gitignored — generated at build/deploy time, never committed):
#   public/downloads/openwop-demo-app.zip
#   public/downloads/openwop-demo-app.zip.sha256
#
# The /install/ page links to the stable filename and publishes the sha256 so
# downloaders can verify integrity. Run this before `firebase deploy --only
# hosting:docs` (scripts/build-site.sh calls it for you).
#
# Usage:
#   bash scripts/build-whitelabel-zip.sh
#
# Idempotent. Safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBTREE="apps/workflow-engine"
OUT_DIR="$ROOT/public/downloads"
ZIP="$OUT_DIR/openwop-demo-app.zip"
PREFIX="openwop-demo-app/"

if [[ ! -d "$ROOT/$SUBTREE" ]]; then
  echo "[whitelabel-zip] FATAL: $SUBTREE not found under repo root." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Tracked files only, rooted at the subtree, under a clean top-level dir.
echo "[whitelabel-zip] archiving $SUBTREE @ $(git -C "$ROOT" rev-parse --short HEAD) → $ZIP"
git -C "$ROOT" archive --format=zip --prefix="$PREFIX" -o "$ZIP" "HEAD:$SUBTREE"

# White-label safety: strip every .env* from the distributable. `.env.production`
# is tracked (so git archive includes it) and carries the steward's backend +
# Firebase config — shipping it would point every adopter's production build at
# the steward's system. `zip -d` returns 12 ("nothing to do") when no entry
# matches, which is fine; only a real failure should abort. (`*` spans `/` in
# zip's delete globs, so this catches .env at any depth.)
echo "[whitelabel-zip] stripping .env* from the distributable (white-label safety)"
zip -q -d "$ZIP" "*/.env" "*/.env.*" "${PREFIX}.env" "${PREFIX}.env.*" || [[ $? -eq 12 ]]
# Fail loudly if any .env survived (e.g. a future `zip` with different glob rules).
if unzip -l "$ZIP" | grep -qiE '/\.env(\.|$| )'; then
  echo "[whitelabel-zip] FATAL: a .env* file remains in the zip after stripping." >&2
  unzip -l "$ZIP" | grep -iE '/\.env' >&2
  exit 1
fi

# sha256 sidecar — prefer sha256sum (Linux/CI), fall back to shasum (macOS).
echo "[whitelabel-zip] writing sha256 sidecar"
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && sha256sum "$(basename "$ZIP")" > "$ZIP.sha256" )
else
  ( cd "$OUT_DIR" && shasum -a 256 "$(basename "$ZIP")" > "$ZIP.sha256" )
fi

SIZE="$(wc -c < "$ZIP" | tr -d ' ')"
echo "[whitelabel-zip] done — $((SIZE / 1024)) KB"
cat "$ZIP.sha256"
