#!/usr/bin/env bash
# Sync JSON Schemas from the canonical `schemas/` location into the
# workflow-engine sample's `schemas/` vendored directory. The sample BE
# bundles them into the Docker image (Dockerfile COPY) so the deployed
# Cloud Run revision can load them at boot — `host/promptPackLoader.ts`
# and `host/envelopeAcceptor.ts` both call `locateRepoSchemasDir()` at
# module load and crash hard if the dir isn't reachable from `/app/lib`.
#
# Vendoring is required because `gcloud run deploy --source` uploads
# only the contents of `apps/workflow-engine/`; the repo-root `schemas/`
# dir is outside that build context and `Dockerfile COPY` can't reach
# it. Same pattern as `sync-fixtures.sh`.
#
# Run this script after any change to repo-root `schemas/*.json` that
# the workflow-engine sample should serve. Or wire it into a precommit
# hook / CI check.
#
# Usage:
#   bash apps/workflow-engine/scripts/sync-schemas.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CANONICAL="$REPO_ROOT/schemas"
VENDORED="$REPO_ROOT/apps/workflow-engine/schemas"

if [ ! -d "$CANONICAL" ]; then
  echo "error: canonical schemas dir not found at $CANONICAL" >&2
  exit 1
fi

rm -rf "$VENDORED"
mkdir -p "$VENDORED"
cp -r "$CANONICAL/." "$VENDORED/"

diff -rq "$CANONICAL" "$VENDORED" >/dev/null
echo "ok — vendored $(find "$VENDORED" -name '*.json' | wc -l | tr -d ' ') schemas into apps/workflow-engine/schemas/"
