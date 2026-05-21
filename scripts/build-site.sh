#!/usr/bin/env bash
# build-site — render the spec corpus into the Firebase docs target.
#
# Runs `site/src/build.mjs` (a Node 20 stdlib-only generator with no
# runtime deps) and merges the output into `public/` so a single
# `firebase deploy --only hosting:docs` ships both:
#   - The marketing one-pager at `/` (public/index.html — preserved).
#   - The multi-page spec corpus at `/spec/v1/`, `/conformance/`,
#     `/profiles/`, and `/badge/{host}.svg`.
#
# The marketing one-pager's `index.html`, `main.js`, `styles.css`,
# `manifest.webmanifest`, `robots.txt`, and `404.html` are never
# overwritten — only the spec-derived directories and the site-
# generated `sitemap.xml` are written.
#
# IMPORTANT: any edit to `public/index.html` (marketing copy, new
# sections, hero changes) needs a `bash scripts/build-site.sh` pass
# before `firebase deploy` so the sitemap's `lastmod` for `/` reflects
# the deploy date. The generator stamps `lastmod` at build time, NOT
# at deploy time.
#
# Usage:
#   bash scripts/build-site.sh
#
# Idempotent. Safe to re-run before every deploy.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
PUBLIC="$ROOT/public"

if [[ ! -d "$SITE" ]]; then
  echo "[build-site] FATAL: $SITE not found." >&2
  exit 1
fi

echo "[build-site] running site/ generator…"
( cd "$SITE" && npm run --silent build )

# Spec corpus + conformance + profiles + per-host badges.
echo "[build-site] copying spec/ conformance/ profiles/ badge/ → public/"
rm -rf "$PUBLIC/spec" "$PUBLIC/conformance" "$PUBLIC/profiles" "$PUBLIC/badge"
cp -R "$SITE/dist/spec"        "$PUBLIC/spec"
cp -R "$SITE/dist/conformance" "$PUBLIC/conformance"
cp -R "$SITE/dist/profiles"    "$PUBLIC/profiles"
cp -R "$SITE/dist/badge"       "$PUBLIC/badge"

# Shared asset stylesheet for the rendered spec pages.
mkdir -p "$PUBLIC/assets"
cp "$SITE/dist/assets/style.css" "$PUBLIC/assets/style.css"

# Site-generated favicon + OG defaults (used by the spec pages, not the
# marketing one-pager — the marketing site keeps its own og-cover.png).
cp "$SITE/dist/favicon.svg"     "$PUBLIC/favicon.svg"
cp "$SITE/dist/og-default.png"  "$PUBLIC/assets/og-default.png"
cp "$SITE/dist/og-default.svg"  "$PUBLIC/assets/og-default.svg"

# The site-built sitemap replaces the public/ root one.
cp "$SITE/dist/sitemap.xml" "$PUBLIC/sitemap.xml"

echo "[build-site] done. Next: firebase deploy --only hosting:docs"
