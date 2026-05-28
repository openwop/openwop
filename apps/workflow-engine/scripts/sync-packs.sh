#!/usr/bin/env bash
# Sync local node + agent + vendor packs from the canonical repo-root
# `packs/` location into the workflow-engine sample's `packs/` vendored
# directory. The sample BE auto-mounts them at boot via
# `bootstrap/mountLocalPacks.ts` + `bootstrap/agentPackResolver.ts` so
# the deployed Cloud Run revision shows every `core.openwop.*` and
# `vendor.*` pack in `/v1/agents`, `/v1/host/sample/registry/agent-packs`,
# and the node-palette — same surface local `npm run dev` shows.
#
# Without this sync + Dockerfile COPY, `resolveLocalPacksDir()` walks up
# from `/app/lib` in the runtime image and finds nothing, so
# `loadAllLocalAgents()` returns 0 and the Agents tab is empty in prod
# even though it shows 30+ agents locally.
#
# Vendoring is required because `gcloud run deploy --source` uploads
# only the contents of `apps/workflow-engine/`; the repo-root `packs/`
# dir is outside that build context and `Dockerfile COPY` can't reach
# it. Same pattern as `sync-schemas.sh` and `sync-fixtures.sh`.
#
# Scope: `core.openwop.*` + `vendor.*` (matches the bootstrap's
# `LOCAL_PACK_PREFIXES` plus the vendor.* extension demos). Excludes any
# `.registry-<version>` shadow-preservation dirs that
# `mountLocalPacks.ts` may have created on dev machines —
# those aren't meant to be redistributed.
#
# Run this script before `gcloud run deploy` whenever a pack manifest
# changes locally and the change should reach prod.
#
# Usage:
#   bash apps/workflow-engine/scripts/sync-packs.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CANONICAL="$REPO_ROOT/packs"
VENDORED="$REPO_ROOT/apps/workflow-engine/packs"

if [ ! -d "$CANONICAL" ]; then
  echo "error: canonical packs dir not found at $CANONICAL" >&2
  exit 1
fi

rm -rf "$VENDORED"
mkdir -p "$VENDORED"

# Copy each `core.openwop.*` or `vendor.*` pack that is a real directory
# (not a symlink — symlinks point at registry-installed artifacts that
# may be on the dev's machine but aren't in the canonical source).
# `.registry-<version>` shadow dirs are excluded.
copied=0
for entry in "$CANONICAL"/*; do
  [ -d "$entry" ] || continue
  name="$(basename "$entry")"
  case "$name" in
    core.openwop.*|vendor.*) ;;
    *) continue ;;
  esac
  case "$name" in
    *.registry-*) continue ;;
  esac
  # Skip if the entry is itself a symlink (dev-mode mount). The
  # canonical source must be the resolved real directory.
  if [ -L "$entry" ]; then
    target="$(readlink "$entry")"
    if [ ! -d "$target" ]; then continue; fi
    cp -RL "$entry" "$VENDORED/$name"
  else
    cp -R "$entry" "$VENDORED/$name"
  fi
  copied=$((copied + 1))
done

echo "ok — vendored $copied packs into apps/workflow-engine/packs/"
