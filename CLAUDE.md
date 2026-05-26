# CLAUDE.md

## Working in parallel sessions (read first)

Multiple Claude Code sessions share this one checkout. Assume another session is editing right now. Lessons learned the hard way:

- **Work in your own worktree.** `git worktree add ../openwop-<task> origin/main` off the current remote tip. Never `git checkout -b` in the shared checkout (`/Users/david/dev/openwop`) — it strands the working tree and other sessions expect `main` there. The same branch can't be checked out in two worktrees.
- **Branch from `origin/main`, not local.** `git fetch` first. Local `main` drifts behind constantly (parallel pushes) and can advance *under you* mid-session. Building on a stale base wastes work — check `git status -sb` for "behind N".
- **Never `git stash` / `git clean` / `git reset --hard` the shared tree.** Another session's uncommitted work lives there. Before discarding *anything*, `git diff` it against `origin/main` — if it differs, it's someone's unpushed work; leave it.
- **Preserve work by committing to a branch, then push.** Don't rely on stash (fragile, gets clobbered). Push immediately so it survives.
- **Before every commit:** `git branch --show-current` (a parallel `checkout` can move you) and `git diff --cached` (a parallel write can land between `add` and `commit`). Stage explicit paths, never `git add -A`.
- **Don't symlink `node_modules` as a shortcut.** The shell cwd resets between tool calls, so `ln -s` lands in the wrong dir and leaves stray `node_modules/node_modules` symlinks that break later `git checkout` ("cannot rmdir node_modules"). Provision worktrees with a real `npm install`.
- **Clean up only your own artifacts.** Delete your stale branches after the PR is up; never delete branches, worktrees, or stashes you didn't create.
