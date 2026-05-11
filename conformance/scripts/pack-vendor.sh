#!/usr/bin/env bash
# pack-vendor.sh — prepack helper for @openwop/openwop-conformance.
#
# Vendors api/ + schemas/ from the repo root into the conformance package
# directory so npm pack can include them in the published tarball. The
# files field in package.json gates what npm pack actually ships.
#
# Failure-mode safety (H3 from code review of session 21343f09):
# `trap cleanup_on_error ERR` ensures partial copies don't leave the
# working tree polluted if any step fails — without this, a failed
# `cp -R ../schemas ./schemas` after a successful `cp -R ../api ./api`
# would leave api/ in place AND skip postpack, requiring manual cleanup.
#
# postpack still runs the cleanup on the SUCCESS path; this script only
# handles the ERROR path. Both paths leave the working tree clean.

set -euo pipefail

cleanup_on_error() {
  echo "pack-vendor.sh: error during vendoring — removing partial state" >&2
  rm -rf api schemas
}
trap cleanup_on_error ERR

# Defensive cleanup: if a prior run was killed mid-way and bypassed both
# the ERR trap AND postpack, this resets state.
rm -rf api schemas

# Vendor the contract material. Both source dirs live at the public-repo
# root and the in-tree mirror root (), so the relative
# path is consistent between layouts.
cp -R ../api ./api
cp -R ../schemas ./schemas

echo "pack-vendor.sh: vendored api/ + schemas/ for npm pack"
