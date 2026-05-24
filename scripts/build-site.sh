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

# OpenAPI + schemas — copy into public/ so the /api/rest/ Redoc viewer
# can fetch them at /api/openapi.yaml + /schemas/*.schema.json. The
# OpenAPI spec uses relative $refs (../schemas/...) so both have to
# sit at predictable URLs.
echo "[build-site] syncing api/ and schemas/ into public/"
mkdir -p "$PUBLIC/api" "$PUBLIC/api/grpc"
cp "$ROOT/api/openapi.yaml" "$PUBLIC/api/openapi.yaml"
cp "$ROOT/api/asyncapi.yaml" "$PUBLIC/api/asyncapi.yaml"
cp "$ROOT/api/grpc/openwop.proto" "$PUBLIC/api/grpc/openwop.proto"
rm -rf "$PUBLIC/schemas"
cp -R "$ROOT/schemas" "$PUBLIC/schemas"

# Site-generated directories — copy each into public/. The marketing
# one-pager's `index.html`, `main.js`, `styles.css`, `manifest.webmanifest`,
# `robots.txt`, and `404.html` are preserved (we don't copy site/dist/index.html
# or site/dist/robots.txt; the rendered marketing site wins root).
echo "[build-site] copying site-generated directories → public/"
for dir in spec conformance profiles badge changelog roadmap versioning security contributing governance maintainers quickstart community protocol implement adopters rfcs faq errors scenarios for; do
  if [[ -d "$SITE/dist/$dir" ]]; then
    rm -rf "$PUBLIC/$dir"
    cp -R "$SITE/dist/$dir" "$PUBLIC/$dir"
  fi
done

# REST API explorer directory is built by site/ generator; if present, copy.
if [[ -d "$SITE/dist/api/rest" ]]; then
  rm -rf "$PUBLIC/api/rest"
  mkdir -p "$PUBLIC/api"
  cp -R "$SITE/dist/api/rest" "$PUBLIC/api/rest"
fi
# AsyncAPI events explorer.
if [[ -f "$SITE/dist/api/events/index.html" ]]; then
  mkdir -p "$PUBLIC/api/events"
  cp "$SITE/dist/api/events/index.html" "$PUBLIC/api/events/index.html"
fi
# gRPC transport explorer (the generated index.html lives next to the .proto
# we already copied above; copy only the rendered page, not the proto, so the
# explicit cp of api/grpc/openwop.proto stays the source of truth).
if [[ -f "$SITE/dist/api/grpc/index.html" ]]; then
  mkdir -p "$PUBLIC/api/grpc"
  cp "$SITE/dist/api/grpc/index.html" "$PUBLIC/api/grpc/index.html"
fi

# Shared asset stylesheet + sticky-ToC script for the rendered spec pages.
mkdir -p "$PUBLIC/assets"
cp "$SITE/dist/assets/style.css" "$PUBLIC/assets/style.css"
cp "$SITE/dist/assets/spec-toc.js" "$PUBLIC/assets/spec-toc.js"

# Site-generated favicon + OG defaults (used by the spec pages, not the
# marketing one-pager — the marketing site keeps its own og-cover.png).
cp "$SITE/dist/favicon.svg"     "$PUBLIC/favicon.svg"
cp "$SITE/dist/og-default.png"  "$PUBLIC/assets/og-default.png"
cp "$SITE/dist/og-default.svg"  "$PUBLIC/assets/og-default.svg"

# The site-built sitemap replaces the public/ root one.
cp "$SITE/dist/sitemap.xml" "$PUBLIC/sitemap.xml"

echo "[build-site] done. Next: firebase deploy --only hosting:docs"
