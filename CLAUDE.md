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

## Deploying the demo app (`app.openwop.dev`)

The live demo is **two independent deploys** — get this wrong and you ship half a release. (Full recipe + prerequisites in `apps/workflow-engine/DEPLOY.md`; this is the gotcha digest.)

- **`app.openwop.dev` = backend (Cloud Run) + frontend (Firebase Hosting), deployed separately.** The `apps/workflow-engine/Dockerfile` builds the **backend only** (no `COPY frontend`, no vite build). The React SPA is a *separate* Firebase Hosting deploy. A backend-only redeploy will NOT ship frontend changes, and vice-versa.
- **Deploy order: backend FIRST, then frontend.** A new SPA calls new backend endpoints; if the frontend lands first, those calls 404 until the backend catches up. Wait for the Cloud Run revision to serve 100% traffic before `firebase deploy`.
- **Deploy from a CLEAN `origin/main` checkout** (your worktree reset to `origin/main`, or `git worktree add --detach /tmp/owp-deploy origin/main`) — never the shared tree, whose uncommitted work would ride into the `--source` upload.
- **Backend (Cloud Run `openwop-app-backend`):**
  ```
  gcloud run deploy openwop-app-backend --source apps/workflow-engine \
    --region us-central1 --project openwop-dev --quiet
  ```
  **Pass NO `--set-secrets` / `--set-env-vars` / `--env-vars-file` flags.** A bare `gcloud run deploy` preserves the live secret + env config; DEPLOY.md §6's fuller command is STALE and would wipe the 7-secret config (Cloud SQL DSN, provider keys, messaging token). The build runs via Cloud Build (~3–5 min). The image vendors `conformance-fixtures/`, `schemas/`, `packs/` from the build context — re-run `scripts/sync-{fixtures,schemas,packs}.sh` only if those changed.
- **Frontend (Firebase Hosting target `app`):**
  ```
  ( cd apps/workflow-engine/frontend/react && npm run build )   # uses .env.production
  firebase deploy --only hosting:app --project openwop-dev
  ```
  `.env.production` wires the SPA to `VITE_OPENWOP_BASE_URL=/api` (a Firebase rewrite proxy to Cloud Run) + `cookie` auth. SSE bypasses `/api` (CDN buffers it) via a direct `*.run.app` URL — don't "simplify" it back to `/api`.
- **Deploy account:** use the gcloud account that has `run.admin` on `openwop-dev` — check `LAST DEPLOYED BY` on `gcloud run services list --project openwop-dev`. The project-*owner* account may NOT have Cloud Run perms; the deployer is a different account (see private memory).
- **Verify the full stack after both deploys:** `curl https://app.openwop.dev/` should reference the **same `assets/index-<hash>.js`** your local `dist/` just built; `curl https://app.openwop.dev/api/readiness` → 200 (503 only if a managed provider key is unconfigured); a `POST https://app.openwop.dev/api/v1/host/sample/demo/seed` (with a `-c -b` cookie jar — cookieless requests each get a throwaway `anon:<sid>` tenant) should round-trip.
- **Watch the per-IP rate limit when a page adds request fan-out.** `middleware/rateLimit.ts` enforces a **per-IP read budget (default 60 req/min)** — separate from the tighter run-creation limits (10/min, 50/day, 5 concurrent). A SPA page that fires many parallel reads on load (a dashboard that fans out one fetch per agent/board, a `Promise.all` over N runs) can blow a single *real* user past 60/min and surface as a wall of `429`s (plus `500`s from the Firebase `/api` proxy faulting under the storm). Console symptom: `rate_limited` / `listX returned 429` across unrelated endpoints. Fix WITHOUT a rebuild via an **incremental** env update (preserves all secrets + other env — unlike `--set-env-vars`/`--set-secrets`, which replace and would wipe the live config):
  ```
  gcloud run services update openwop-app-backend \
    --update-env-vars OPENWOP_RATELIMIT_IP_REQS_PER_MIN=300 \
    --region us-central1 --project openwop-dev
  ```
  Confirm the bucketed key in logs is a real client IP (`jsonPayload.msg="ip rate limit hit"`) — XFF first-hop resolves to the actual user, so the budget is per-user, not global. Also prefer reducing front-end fan-out (batch reads; don't N+1 a per-row detail fetch on a list page).
