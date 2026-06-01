#!/usr/bin/env bash
# build-whitelabel-zip — package the white-label demo app as a downloadable
# source zip for the /install/ page on openwop.dev.
#
# Uses `git archive` on the `apps/workflow-engine` subtree, so the zip contains
# ONLY tracked files: the backend + frontend source, WHITE-LABEL.md, DEPLOY.md,
# providers.json, etc. — and never `node_modules/`, `dist/`, `.env*`, `data/`,
# or any key material (all untracked / gitignored). The output is deterministic
# per commit (git archive stamps the commit time, not the wall clock).
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
