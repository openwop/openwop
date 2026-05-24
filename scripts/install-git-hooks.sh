#!/usr/bin/env bash
# Install opt-in git hooks for the openwop repo.
#
# Symlinks `scripts/hooks/*` into `.git/hooks/` so a single source of
# truth is committed to the repo (under scripts/hooks/) and per-clone
# install is a one-time `bash scripts/install-git-hooks.sh` step.
#
# Hooks installed:
#   pre-commit — refuses commits that stage RFC changes without
#                regenerating docs/PROTOCOL-STATUS.md + README.md
#                (the protocol-status gate that 85b6f94 missed).
#
# Re-run anytime — the script overwrites existing symlinks of the
# same name but won't clobber real (non-symlink) hooks you've
# customized. Remove with: rm .git/hooks/<hook-name>.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SRC_DIR="scripts/hooks"
DEST_DIR=".git/hooks"

if [ ! -d "$SRC_DIR" ]; then
  echo "install-git-hooks: $SRC_DIR not found — are you in the openwop repo root?" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

for hook in "$SRC_DIR"/*; do
  name="$(basename "$hook")"
  dest="$DEST_DIR/$name"

  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "install-git-hooks: skip $name — $dest exists and is not a symlink." >&2
    continue
  fi

  chmod +x "$hook"
  ln -sf "../../$hook" "$dest"
  echo "install-git-hooks: linked $name → $hook"
done

echo "install-git-hooks: done."
