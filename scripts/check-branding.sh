#!/usr/bin/env bash
# check-branding — white-label guardrail. Greps a BUILT demo-app bundle for
# OpenWOP brand defaults that a fork forgot to override (favicon, title,
# product name, the steward's domain). Exits non-zero if any leak.
#
# This is a FORK tool, not part of the upstream openwop build/CI: the upstream
# IS OpenWOP, so its own build legitimately carries these strings and this
# script is EXPECTED to "fail" there. Run it against YOUR fork's build:
#
#   ( cd apps/workflow-engine/frontend/react && npm run build )
#   bash scripts/check-branding.sh apps/workflow-engine/frontend/react/dist
#
# Background: forks have shipped the OpenWOP favicon + title because the env
# vars were never set (the system supports overrides but nothing forced them).
# See apps/workflow-engine/frontend/react/WHITE-LABEL.md for the full surface
# list + the `.env.production.example` template.

set -euo pipefail

DIST="${1:-apps/workflow-engine/frontend/react/dist}"
INDEX="$DIST/index.html"

if [[ ! -f "$INDEX" ]]; then
  echo "[check-branding] FATAL: $INDEX not found — build the frontend first." >&2
  exit 2
fi

leaks=0
flag() { echo "  ✗ LEAK: $1"; leaks=$((leaks + 1)); }

echo "[check-branding] scanning $DIST for un-overridden OpenWOP defaults…"

# 1) Document title (Vite plugin stamps it into <title> from VITE_BRAND_DOCUMENT_TITLE).
grep -qiE '<title>[^<]*OpenWOP' "$INDEX" && flag "<title> still names OpenWOP (set VITE_BRAND_DOCUMENT_TITLE)"

# 2) Favicon — match ONLY the OpenWOP defaults: the /OpenWOP.svg asset or the
#    stock data-URI (identified by its clay rect fill %23a35a30 — a custom
#    inline-SVG data-URI favicon must NOT false-positive here).
# (note: the stock data-URI embeds `>` inside href, so no [^>]* spans here)
grep -qiE 'rel="icon".*(OpenWOP\.svg|a35a30)' "$INDEX" \
  && flag "favicon is the OpenWOP default (set VITE_BRAND_FAVICON_SRC + drop your icon in public/)"

# 3) The steward's domain baked into the bundle (strong fork-leak signal — a
#    re-branded fork should not reference app.openwop.dev / openwop.dev).
if grep -rqiE 'app\.openwop\.dev|//openwop\.dev' "$DIST"/assets/*.js 2>/dev/null; then
  flag "the bundle references the steward domain openwop.dev (set VITE_BRAND_PRIMARY_DOMAIN / VITE_BRAND_HOME_URL; scrub .env.production)"
fi

# 4) PWA manifest — stamped at build from VITE_BRAND_PRODUCT_NAME; an
#    installable app announcing "OpenWOP" is a leak.
MANIFEST="$DIST/manifest.webmanifest"
if [[ -f "$MANIFEST" ]] && grep -qiE '"(name|short_name)"[[:space:]]*:[[:space:]]*"[^"]*OpenWOP' "$MANIFEST"; then
  flag "PWA manifest still names OpenWOP (set VITE_BRAND_PRODUCT_NAME)"
fi

# 5) Instance/workspace name left at the stock demo label.
if grep -rqiE 'Demo host' "$DIST"/assets/*.js 2>/dev/null; then
  flag "sidebar instance name is still the stock Demo host (set VITE_BRAND_INSTANCE_NAME)"
fi

if [[ "$leaks" -gt 0 ]]; then
  echo "[check-branding] FAIL — $leaks OpenWOP default(s) leaked into the build." >&2
  echo "[check-branding] Set the matching VITE_BRAND_* vars (WHITE-LABEL.md) and rebuild." >&2
  exit 1
fi

echo "[check-branding] OK — no OpenWOP brand defaults found in the build."
