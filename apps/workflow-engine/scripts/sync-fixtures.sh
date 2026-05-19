#!/usr/bin/env bash
# Sync conformance fixtures from the canonical `conformance/fixtures/`
# location into the workflow-engine sample's `conformance-fixtures/`
# vendored directory. The sample BE bundles them into the Docker image
# (Dockerfile COPY) so the deployed Cloud Run revision can serve them
# from `capabilities.fixtures` + answer black-box conformance runs.
#
# Vendoring as real files (vs. symlink) is required because
# `gcloud run deploy --source` preserves symlinks at upload time, but
# Docker COPY can't follow symlinks outside the build context — so a
# symlink to `../../conformance/fixtures` arrives in the runtime image
# as a broken link.
#
# Run this script after any change to `conformance/fixtures/*.json`
# that the workflow-engine sample should serve. Or wire it into a
# precommit hook / CI check.
#
# Usage:
#   bash apps/workflow-engine/scripts/sync-fixtures.sh
#
# Exit non-zero if the vendored copy diverges from the canonical
# location after sync (sanity check for CI).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CANONICAL="$REPO_ROOT/conformance/fixtures"
VENDORED="$REPO_ROOT/apps/workflow-engine/conformance-fixtures"

if [ ! -d "$CANONICAL" ]; then
  echo "error: canonical fixtures dir not found at $CANONICAL" >&2
  exit 1
fi

rm -rf "$VENDORED"
mkdir -p "$VENDORED"
cp -r "$CANONICAL/." "$VENDORED/"

diff -rq "$CANONICAL" "$VENDORED" >/dev/null
echo "ok — vendored $(ls -1 "$VENDORED"/*.json | wc -l | tr -d ' ') fixtures into apps/workflow-engine/conformance-fixtures/"
