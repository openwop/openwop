---
name: publish-whitelabel
description: Build the downloadable white-label demo-app zip from current main and publish it to the /install/ download on openwop.dev (Firebase Hosting `docs` target). Use when the white-label source bundle (`public/downloads/openwop-demo-app.zip`) needs (re)publishing so the /install/ download reflects the latest `apps/workflow-engine` — e.g. after demo-app changes merge. Triggers `scripts/build-whitelabel-zip.sh` then `firebase deploy --only hosting:docs`, and verifies the live artifact.
---

# Publish the white-label demo-app download

The downloadable white-label app advertised on **openwop.dev/install/** is a
source zip of the `apps/workflow-engine` subtree:

```
public/downloads/openwop-demo-app.zip        # the project
public/downloads/openwop-demo-app.zip.sha256 # integrity sidecar
```

Both are **gitignored** — generated at publish time, never committed. The zip is
`git archive HEAD:apps/workflow-engine`, so it contains **tracked files at the
current commit only** (backend + frontend source, `WHITE-LABEL.md`, `DEPLOY.md`,
`providers.json`) and never `node_modules/`, `dist/`, `.env*`, `data/`, or keys.

The Firebase Hosting **`docs`** target serves `public/` (`firebase.json`), so
`public/downloads/X` publishes to `https://openwop.dev/downloads/X`. There is
**no CD-on-merge** — `site.yml` deploys `hosting:docs` only on a manual
`workflow_dispatch` with the repo variable `ALLOW_DEPLOY=1`. This skill is the
deliberate, local equivalent of that gated publish.

> **Two ways to publish — pick one:**
> - **This skill (local deploy)** — fast, you run it now. Needs `firebase` auth.
> - **CI gate** — a maintainer sets repo var `ALLOW_DEPLOY=1` and runs the
>   `site.yml` workflow (`gh workflow run site.yml`); CI runs `build-site.sh`
>   (which calls the zip builder) and deploys. Use when you can't/shouldn't
>   deploy from your machine.

---

## Prerequisites (check first — STOP if unmet)

1. **Confirm with the user before deploying.** This publishes to the public
   site (`openwop.dev`). It is outward-facing — get an explicit go-ahead.
2. **Firebase CLI authed with a Hosting-deploy account on `openwop-dev`.**
   ```sh
   firebase projects:list 2>&1 | grep -i openwop-dev || echo "NOT AUTHED"
   firebase login:list
   ```
   If not authed, the user runs it interactively — suggest they type:
   `! firebase login` (the per-deploy account, not necessarily the project
   owner — see the private deploy-account memory; the same account used for
   `hosting:app`).
3. **`firebase` CLI present.** `firebase --version` (≥ 13). If missing:
   `npm i -g firebase-tools`.

---

## Steps

### 1. Work from a clean `origin/main` checkout

The zip archives `HEAD`, so `HEAD` must be the commit you want to ship. Never
build from the shared dev checkout (its uncommitted work would NOT ride in — the
zip is commit-based — but `firebase deploy` uploads the *working tree's*
`public/`, which could carry another session's edits). Use a throwaway detached
worktree at the remote tip:

```sh
git -C <repo> fetch origin
git -C <repo> worktree add --detach /tmp/owp-publish origin/main
cd /tmp/owp-publish
git rev-parse --short HEAD   # confirm == origin/main
```

### 2. Build the zip (triggers the script)

```sh
bash scripts/build-whitelabel-zip.sh
```

Expected: `[whitelabel-zip] done — NNNN KB` and the printed sha256. Verify your
intended changes are inside before publishing:

```sh
unzip -l public/downloads/openwop-demo-app.zip \
  'openwop-demo-app/frontend/react/src/**' 'openwop-demo-app/backend/typescript/src/**' \
  | tail -5
# spot-check a file you expect, e.g.:
unzip -l public/downloads/openwop-demo-app.zip 'openwop-demo-app/WHITE-LABEL.md' >/dev/null \
  && echo "WHITE-LABEL.md present ✓"
```

> Do **not** run `scripts/build-site.sh` just to refresh the zip — it
> regenerates all of `public/` and (per the public-site memory) its
> `rm -rf public/badge` deletes the hand-maintained
> `openwop-agent-platform.svg`, breaking the link gate. For a zip-only publish,
> the committed `public/` is already the current site; the step above adds only
> the zip. Run `build-site.sh` **only** when the site content itself must also
> refresh, and restore the badge afterward.

### 3. Publish (upload to the server)

```sh
firebase deploy --only hosting:docs --project openwop-dev
```

This uploads the worktree's `public/` (the committed site) **plus** the freshly
built `public/downloads/*`. Wait for `Deploy complete!`.

### 4. Verify the live artifact

```sh
# 200 + a real byte count (not the 404 HTML page)
curl -s -o /dev/null -w "zip:    HTTP %{http_code}  %{size_download}B\n" \
  https://openwop.dev/downloads/openwop-demo-app.zip
# live sha256 == freshly built sidecar
echo -n "live:   "; curl -s https://openwop.dev/downloads/openwop-demo-app.zip.sha256 | awk '{print $1}'
echo -n "local:  "; awk '{print $1}' public/downloads/openwop-demo-app.zip.sha256
# /install/ page still renders
curl -s -o /dev/null -w "install: HTTP %{http_code}\n" https://openwop.dev/install/
```

PASS = zip is HTTP 200 with a multi-MB body, and **live sha256 == local sha256**.
A CDN edge may briefly serve the old object; if the hash mismatches, re-check
after ~60s (Hosting invalidates changed files on deploy).

### 5. Clean up

```sh
git -C <repo> worktree remove /tmp/owp-publish
```

---

## Gotchas

- **404 with a styled HTML body** at the zip URL = not published (or the deploy
  didn't include `public/downloads/`). Confirm step 2 actually wrote the file
  into the *same* `public/` the deploy uploaded (same worktree).
- **Stale `HEAD`.** If `git rev-list --count HEAD..origin/main` > 0, you built an
  old commit — re-create the worktree at `origin/main`.
- **Wrong account.** A 403 on deploy means the active `firebase` account lacks
  Hosting rights on `openwop-dev`. Switch with `firebase login` / the deploy
  account; do not assume the project-owner email has it.
- **This is the `docs` target, not `app`.** `hosting:app` is the live SPA
  (`app.openwop.dev`); `hosting:docs` is the marketing/docs site
  (`openwop.dev`) that serves `/install/` + `/downloads/`. Don't confuse them.
- **No partial upload.** Firebase deploys the whole `public/` dir; there's no
  single-file push. That's why step 1's clean checkout matters.
