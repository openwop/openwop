---
name: release
description: Cut an openwop release. This repo publishes two npm packages together — `@openwop/openwop-conformance` and its exact-pinned peer `@openwop/spec-artifacts` — from one tag. Tag forms: `vX.Y.Z` (corpus release, the normal form; also opens a tracking issue in `openwop-sdks`), `openwop-conformance/vX.Y.Z` (fast suite fix; still publishes both), `openwop-spec-artifacts/vX.Y.Z` (contract package only). Covers the version sites, the regen chain and 10-step `openwop:check` gate, a base-vs-head host diff, tagging the merge commit on `main`, and verifying both packages from an empty directory. SDKs release from `openwop-sdks`, hosts from `openwop-examples`, the site from `openwop-site`; this skill does not bump them.
---

# Cut a release (openwop)

You are now in **Release Manager Mode** for a spec-corpus release.

`PUBLISHING.md` is the contract. This skill walks it phase by phase, with detection commands and a catalog of the drift modes that have broken past releases.

**What this repo publishes:** `@openwop/openwop-conformance` and `@openwop/spec-artifacts`. They always share one version, and the suite's `peerDependencies["@openwop/spec-artifacts"]` names exactly that version, so they are one release under two names. The TypeScript, Python and Go SDKs release from `openwop-sdks`; a `vX.Y.Z` tag here only opens a reminder issue there.

---

## Release target: $ARGUMENTS

If no version was passed, read the in-tree version (`conformance/package.json`) and the `conformance/CHANGELOG.md` heading, and announce the target before Phase 0.

---

## Scope rule (read first)

A release is a **freeze + tag**, not a feature cycle. The work is: (a) moving the `[Unreleased]` lines into a release section, (b) confirming every version site agrees, (c) regenerating the stamped surfaces once, and (d) verifying what npm actually serves.

**Tag forms, all handled by `.github/workflows/openwop-publish.yml`:**

| Tag | Publishes | Use when |
|---|---|---|
| `vX.Y.Z` | both packages, then `verify-installable`; plus `remind-sdk-release` | A corpus release. The normal form. |
| `openwop-conformance/vX.Y.Z` | both packages, then `verify-installable` | A suite fix a host needs on npm quickly. Spec-artifacts publishes too, because of the exact peer pin. |
| `openwop-spec-artifacts/vX.Y.Z` | `@openwop/spec-artifacts` only | A packaging fix to the contract package alone. |

Jobs in order: `validate-tag` (format, and the commit must be on `main` or `release/1.x`) → `preflight` (`npm run openwop:check`) → `publish-spec-artifacts` → `publish-conformance` → `verify-installable`, with `remind-sdk-release` on `v*`. Each publish step runs `scripts/check-published-suite-identity.mjs` first: an already-published version with identical contents skips; one with different contents fails, and the fix is a new version. A pre-release `X.Y.Z-rc.N` publishes under the `next` dist-tag.

---

## Phase 0 — Discovery & freeze

### 0.1 Detect current state

```bash
git fetch origin && git status -sb          # work from a fresh worktree on origin/main

# In-tree version of both packages, and what npm serves
node -p "require('./conformance/package.json').version"
node -p "require('./spec-artifacts/package.json').version"
npm view @openwop/openwop-conformance version
npm view @openwop/spec-artifacts version

# The other version sites (all must agree — see Phase 3)
grep -n '"@openwop/spec-artifacts"' conformance/package.json
sed -n 1,35p conformance/package-lock.json | grep -n '"version"\|spec-artifacts'
grep -n 'EXPECTED_.*_VERSION=' scripts/openwop-check-publish-metadata.sh
grep -n "conformancePack.version ===" scripts/check-npm-pack-contents.sh
grep -n "Published artifacts" README.md
cat spec/v2/release.json
head -5 conformance/CHANGELOG.md
```

Sibling repos (`openwop-sdks`, `openwop-examples`, `openwop-site`, `openwop-app`) are not bumped from here.

### 0.2 Decide the release target

- **Patch** (`2.45.x → 2.45.x+1`): scenario corrections, errata, RFC status flips, doc and evidence changes. The usual cadence.
- **Minor** (`2.x → 2.(x+1).0`): additive wire surface, new families or facets, new scenario families.
- **Major**: a new protocol major. Out of scope for this skill; it needs RFC governance and the retention floors in `spec/v2/core/overview.md` §"Old-major retention floors".

Announce the verdict in one sentence (e.g. "Target: `v2.45.24`, corpus patch") before moving on.

### 0.3 Scope freeze

- [ ] Take a release lock and ask other sessions to hold merges until the tag is pushed. A busy `main` out-races the CI run.
- [ ] Record the freeze SHA. Anything merged after it rolls to the next release.
- [ ] Check open spec PRs: `gh pr list --state open --label openwop-spec`.
- [ ] Check post-merge and scheduled workflow history; a wall of failures predates you and should be known before the tag (lesson #10):
  ```bash
  gh run list --workflow=conformance-soak.yml --limit 10 --json conclusion -q '.[].conclusion'
  ```

---

## Phase 1 — Run `/update-docs`

Sync doc surfaces before writing release notes, because the sweep touches some of the same files (README counts, KNOWN-LIMITS rows, INTEROP-MATRIX).

- [ ] `/update-docs based on the contents of [Unreleased]`
- [ ] Commit the sweep separately (`docs: sync surfaces for X.Y.Z`) before Phase 2.

---

## Phase 2 — Release notes

### 2.1 `CHANGELOG.md`

- [ ] Add `## [X.Y.Z] — YYYY-MM-DD — <headline>` directly under `## [Unreleased]`. The headline is 3–8 words and says what changed for an implementer.
- [ ] **Move** the `[Unreleased]` bullets into it; `[Unreleased]` stays as the first `## ` heading and ends the release empty.
- [ ] Each bullet is one line, `- **Lead.** sentence`. An ordinary release uses 1–5 bullets; cluster related items into one.
- [ ] No hashes, pass counts or discovery narratives; those belong in `evidence/`, the RFC and the PR.
- [ ] `node scripts/check-changelog-shape.mjs` passes (it enforces all of the above).

Read the previous release section for tone:

```bash
awk '/^## \[[0-9]/{n++} n==1' CHANGELOG.md | head -20
```

### 2.2 `conformance/CHANGELOG.md`

- [ ] The top heading reads `## [X.Y.Z] — YYYY-MM-DD — <headline>`, with the date set (not `unreleased`).

---

## Phase 3 — Version sites

`PUBLISHING.md` §"Version sites" is the list. A cycle-opening PR bumps them all at once; a release PR confirms they agree and sets the release identity. Edit each at its exact line.

| # | File | What |
|---|---|---|
| 1 | `conformance/package.json` | `version` and `peerDependencies["@openwop/spec-artifacts"]` |
| 2 | `conformance/package-lock.json` | exactly 4 lines: root `version`, `packages[""].version`, `packages[""].peerDependencies["@openwop/spec-artifacts"]`, and `packages["../spec-artifacts"].version` |
| 3 | `spec-artifacts/package.json` | `version` |
| 4 | `scripts/openwop-check-publish-metadata.sh` | `EXPECTED_CONFORMANCE_VERSION` and `EXPECTED_SPEC_ARTIFACTS_VERSION` |
| 5 | `scripts/check-npm-pack-contents.sh` | the `conformancePack.version ===` assertion |
| 6 | `README.md` | the "Published artifacts" line: three mentions (conformance, spec-artifacts, "currently **vX.Y.Z**") |
| 7 | `conformance/CHANGELOG.md` | the release heading |

At release time also set `version`, `corpusTag` and `updated` in `spec/v2/release.json`.

**The lockfile:** never run a global `sed` over it (the corpus version collides with third-party versions; `tinybench@2.9.0` once became a nonexistent `2.9.1`). Never run `npm install` in `conformance/` to "verify"; it rewrites the lockfile beyond the bump and CI's `npm ci` then refuses it. Edit the four lines with a line-indexed script, then confirm the diff:

```bash
git diff --stat conformance/package-lock.json      # → 4 insertions(+), 4 deletions(-)
bash scripts/openwop-check-publish-metadata.sh 2>&1 | tail -6
```

Gate step 5 fails if sites 1–5 disagree.

---

## Phase 4 — Regenerate once, then gate

The corpus tag and version are stamped into generated files, so run the full regen chain once, after every hand edit, immediately before the gate:

```bash
python3 scripts/derive-v2-api.py --write && node scripts/generate-gaps.mjs --write && node scripts/generate-core-standard-manifest.mjs --write && node scripts/generate-assurance-status.mjs --write && node scripts/generate-protocol-status.mjs --write && node conformance/scripts/generate-scenario-majors.mjs --write && node conformance/scripts/generate-requirement-registry.mjs --write && node scripts/generate-spec-artifacts.mjs --write && node scripts/generate-review-packet.mjs --write && node scripts/generate-v1-eos-clock.mjs --write && node scripts/report-v2-witness-coverage.mjs --write && node scripts/check-spec-coherence.mjs --write

npm run openwop:check      # 10 steps; the same gate preflight runs
```

- [ ] `npm run openwop:check` ends OK. Hard gate.
- [ ] `bash scripts/check-npm-pack-contents.sh` clean.
- [ ] `ROADMAP.md` still matches what this release ships.
- [ ] Commit the hand edits and regenerated files together as `release(X.Y.Z): <headline>`.

A later PR that leaves the version alone must not re-stamp `spec-artifacts/CORPUS-STAMP.json` and `evidence/corpus-ledger.json`: restore them from the release commit before committing, or the gate reports the tree is not what was published.

---

## Phase 5 — Diff against a real host

Before merging, run the suite at the base (previous tag) and at the head against at least one host, and compare `results.requirements` by id. A release must not turn a passing requirement into a failure unless that is its point. `PUBLISHING.md` §"Cutting a release" step 2.

---

## Phase 6 — Merge, tag, publish

```bash
# Open the release PR with /pr, merge it, then confirm it actually merged:
gh pr view <n> --json state,mergeCommit -q '.state + " " + .mergeCommit.oid'   # → MERGED <sha>
git fetch origin && git rev-parse origin/main                                   # must equal <sha>

git tag -a vX.Y.Z -m vX.Y.Z <sha>
git push origin vX.Y.Z
```

- [ ] **Never tag before confirming MERGED.** On an open PR the merge-commit query is empty, and `git tag … ""` tags HEAD, the unmerged branch tip. If that happens, delete the tag at once: `git push origin :refs/tags/vX.Y.Z`.
- [ ] For a suite fast path, the same flow with `openwop-conformance/vX.Y.Z`.
- [ ] Watch the run:
  ```bash
  gh run list --workflow=openwop-publish.yml --limit 1
  gh run view <id> --json jobs -q '.jobs[] | "\(.conclusion // .status)  \(.name)"'
  ```
  Expect `validate-tag`, `preflight`, `publish-spec-artifacts`, `publish-conformance` and `verify-installable` green, plus `remind-sdk-release` on a `v*` tag.

---

## Phase 7 — Verify the artifact, not the checkmark

A green workflow says npm accepted tarballs, not that your change is in them. Verify from an **empty directory**, never a checkout: inside this repo the peer resolves from the monorepo and hides a missing publish.

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install @openwop/openwop-conformance@X.Y.Z @openwop/spec-artifacts@X.Y.Z   # add --legacy-peer-deps on a peer conflict
npx openwop-conformance --help
grep -rn "<a distinctive string from this release>" node_modules/@openwop/ | head
```

- [ ] Both packages install at `X.Y.Z` and the distinctive string is present.
- [ ] If a host is waiting, tell it the exact installable version.
- [ ] GitHub release: `gh release create vX.Y.Z --verify-tag --notes-file <(awk '/^## \[X\.Y\.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md)`.

---

## Phase 8 — Public surfacing

- [ ] Re-measure hosts against the new suite where a release changes what they are judged on. Reference hosts live in `openwop-examples`; their bundles are checked in under `evidence/v2-host-bundles/`.
- [ ] `INTEROP-MATRIX.md`: update numbers with a suite-version citation; read counts from the bundles, never by hand.
- [ ] Site: if any `spec/v2/` prose changed, rebuild and deploy from `openwop-site`. It renders this repo's `main` but does not deploy on a push here.

---

## Lessons-learned catalog

Walk this on every release. Each row is a drift mode that has shipped.

| # | Drift mode | Detection | Fix |
|---|---|---|---|
| 1 | **Version sites disagree.** Bumping one manifest fails gate step 5. | `bash scripts/openwop-check-publish-metadata.sh` | Edit all of Phase 3 together. |
| 2 | **Suite published against a peer that does not exist.** Conformance shipped rc.20–rc.28 pinning a spec-artifacts version that was never published; no consumer could install them. | `verify-installable`, plus Phase 7 from an empty dir. | Both packages always ship from one tag at one version. |
| 3 | **Lockfile corrupted by a blanket `sed`** or rewritten by `npm install`. | `git diff --stat conformance/package-lock.json` shows more than 4 lines. | Restore from `origin/main`, re-apply the 4 line edits. |
| 4 | **`[Unreleased]` copied, not moved.** It grew to hundreds of KB. | `node scripts/check-changelog-shape.mjs` | Move the lines; `[Unreleased]` ends the release empty. |
| 5 | **Stale generated surface after a late edit.** | Gate step 4 / step 10 fails after the chain ran. | Run the regen chain once, after the last hand edit. |
| 6 | **Post-release PR re-stamps the corpus.** The regen chain moves `CORPUS-STAMP.json` `corpusCommit` off the published commit. | Gate step 5: "this tree is NOT what was published". | Restore the two stamped files on non-release PRs. |
| 7 | **Tagging the wrong commit.** A tag on an unmerged branch tip fires the publish workflow; `validate-tag` refuses it, but it should not get that far. | `git merge-base --is-ancestor vX.Y.Z origin/main` | Confirm MERGED and tag the merge commit. |
| 8 | **README "Published artifacts" line left at the old version.** | `grep -n "Published artifacts" README.md` | Phase 3 site 6. |
| 9 | **Verifying from a checkout.** The peer resolves locally and a missing publish looks fine. | — | Phase 7 from an empty directory. |
| 10 | **Post-merge-only workflows hide breakage.** `Conformance Soak` ran red on `main` for a month because it never runs on pull requests. | `gh run list --workflow=<name> --limit 20 --json conclusion` | Check at Phase 0, not after tagging. |
| 11 | **Merge race.** Another PR lands between your gate run and the merge, and the tag no longer matches what was checked. | `git rev-parse origin/main` before tagging. | Hold peer merges for the release window. |

---

## Workflow commands

| Command | Action |
|---|---|
| `phase 0` | Discovery + freeze (always start here) |
| `phase 1` | Invoke `/update-docs` |
| `phase 2` | Write the release notes |
| `phase 3` | Check or bump the version sites |
| `phase 4` | Regen chain + gate |
| `phase 5` | Base-vs-head host diff |
| `phase 6` | Merge, tag, push, watch |
| `phase 7` | Verify both packages from an empty directory |
| `phase 8` | Re-measure hosts, INTEROP-MATRIX, site |
| `dry run` | Walk Phase 0 → 4 without tagging; report what would change |
| `version-check` | Print every Phase 3 site and whether they agree |
| `lessons` | Print the lessons-learned catalog |
| `rollback` | Print the fix-forward recipe (`PUBLISHING.md` §"Rollback": publish a patch, `npm deprecate` both bad versions, never unpublish) |

---

## Quick reference

| Where | What |
|---|---|
| `PUBLISHING.md` | Tags, jobs, version sites, cutting a release, rollback |
| `.github/workflows/openwop-publish.yml` | Tag-triggered publish workflow |
| `CHANGELOG.md`, `conformance/CHANGELOG.md` | Release notes |
| `spec/v2/release.json` | The corpus tag the v2 artifacts derive from |
| `scripts/openwop-check-publish-metadata.sh` | Gate step 5: version constants, publish identity |
| `scripts/check-npm-pack-contents.sh` | Tarball contents + the conformance version assertion |
| `scripts/check-published-suite-identity.mjs` | Skip-if-identical / fail-if-different publish guard |
| `scripts/check-changelog-shape.mjs` | CHANGELOG shape |
| `evidence/v2-host-bundles/` | Host bundles to read numbers from |
| `openwop-sdks`, `openwop-examples`, `openwop-site` | Sibling repos with their own releases |

---

## Related skills

| Skill | Purpose |
|---|---|
| `/update-docs` | Phase 1: README, KNOWN-LIMITS, PROTOCOL-STATUS, INTEROP-MATRIX |
| `/update-conformance` | Before the cycle closes, if scenarios were added |
| `/code-review` | If anything new landed under `conformance/src/` |
| `/nfr` | Optional final spec-corpus sweep before tagging |
| `/pr` | The release PR |
| `/cleanup` | Pre-release: dead links, stale rows |
