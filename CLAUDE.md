# CLAUDE.md

## Working in parallel sessions (read first)

Multiple Claude Code sessions share this one checkout. Assume another session is editing right now. Lessons learned the hard way:

- **Work in your own worktree.** `git worktree add ../openwop-<task> origin/main` off the current remote tip. Never `git checkout -b` in the shared checkout (`/Users/david/dev/openwop`) — it strands the working tree and other sessions expect `main` there. The same branch can't be checked out in two worktrees.
- **Branch from `origin/main`, not local.** `git fetch` first. Local `main` drifts behind constantly (parallel pushes) and can advance *under you* mid-session. Building on a stale base wastes work — check `git status -sb` for "behind N".
- **Don't fall behind `origin/main` — re-sync at every milestone, not just at branch time.** `origin/main` keeps moving while you work (other sessions merge PRs continuously), and a long-lived branch built on a stale tip accumulates conflicts that get *worse* the longer you defer them. The strategy when several sessions run at once:
  1. **Check before you commit and before you open a PR.** `git fetch origin` then `git status -sb` — if it says "behind N", integrate before doing anything else.
  2. **Integrate the moment a related PR lands.** If another session merges a PR that touches a surface you also touch (shared count files, schemas, an enum you're extending), pull it in *now* — don't let the gap widen.
  3. **Prefer `git merge origin/main` over rebase once you have a stack of commits.** A merge resolves each conflict *once*; a rebase replays every local commit against the new tip and makes you re-resolve the same conflict N times. Reserve rebase for a 1–2 commit branch you haven't shared.
  4. **Resolve generated / count surfaces by re-deriving, never by hand-merging the numbers.** For `docs/PROTOCOL-STATUS.md` and the README RFC counts, take either side then run `node scripts/generate-protocol-status.mjs --write`. For scenario/doc/invariant tallies (`conformance/README.md`, README "Total", `SECURITY/invariants.yaml`), re-count against the live tree — `ls spec/v1/*.md | wc -l`, `ls conformance/src/scenarios/*.test.ts | wc -l`, `grep -c '^[[:space:]]*-[[:space:]]*id:' SECURITY/invariants.yaml` — and set the resolved value to the real count. When both sides only differ by near-identical giant prose blocks (the "What's Covered" paragraph), `git checkout --ours <file>` then splice the other side's one new sentence in surgically.
  5. **Re-run the gate on the *merged* tree before pushing** (`protocol:status:check`, `check-security-invariants.sh`, `spec-corpus-validity`, `tsc`). A clean pre-merge branch can still fail post-merge when counts shift.
- **Never `git stash` / `git clean` / `git reset --hard` the shared tree.** Another session's uncommitted work lives there. Before discarding *anything*, `git diff` it against `origin/main` — if it differs, it's someone's unpushed work; leave it.
- **Preserve work by committing to a branch, then push.** Don't rely on stash (fragile, gets clobbered). Push immediately so it survives.
- **Before every commit:** `git branch --show-current` (a parallel `checkout` can move you) and `git diff --cached` (a parallel write can land between `add` and `commit`). Stage explicit paths, never `git add -A`.
- **Don't symlink `node_modules` as a shortcut.** The shell cwd resets between tool calls, so `ln -s` lands in the wrong dir and leaves stray `node_modules/node_modules` symlinks that break later `git checkout` ("cannot rmdir node_modules"). Provision worktrees with a real `npm install`.
- **Clean up only your own artifacts.** Delete your stale branches after the PR is up; never delete branches, worktrees, or stashes you didn't create.
